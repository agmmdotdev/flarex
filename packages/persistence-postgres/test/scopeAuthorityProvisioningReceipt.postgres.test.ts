import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import {
  ScopeEpochSchema,
  ScopeIdSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  getScopeAuthorityProvisioningReceipt,
  publishScopeAuthorityReadyInTransaction,
  reserveScopeAuthorityProvisioningReceiptInTransaction,
} from "../src/scopeAuthorityProvisioningReceipt";
import type {
  ReserveSplitScopeAuthorityProvisioningReceiptResult,
  SplitScopeAuthorityProvisioningReceiptIdentity,
} from "../src/scopeAuthorityProvisioningReceiptTypes";
import type { SplitScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

const schemaLocator = {
  kind: "schema_per_scope",
  databaseKey: "primary",
  schemaName: "fx_receipt_pg",
} as const satisfies SplitScopePhysicalLocator;

const epochA = ScopeEpochSchema.make("epoch_receipt_pg_a");
const epochB = ScopeEpochSchema.make("epoch_receipt_pg_b");
const epochC = ScopeEpochSchema.make("epoch_receipt_pg_c");

describePostgres("real Postgres split scope provisioning receipts", () => {
  it("converges concurrent reservations on one persisted epoch winner", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = await insertSplitScope(
        persistence,
        "concurrent_reserve",
      );

      const results = await Promise.all([
        reserveReceipt(persistence, scopeId, epochA),
        reserveReceipt(persistence, scopeId, epochB),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "already_reserved",
        "created_reserved",
      ]);
      expect(
        new Set(results.map((result) => result.receipt.initialEpoch)).size,
      ).toBe(1);
      const winner = results[0]?.receipt;
      if (winner === undefined) {
        throw new Error("Concurrent reservation returned no winner.");
      }
      const responseLossRetry = await reserveReceipt(
        persistence,
        scopeId,
        epochC,
      );
      expect(responseLossRetry).toEqual({
        status: "already_reserved",
        receipt: winner,
      });
      await expect(receiptCount(persistence)).resolves.toBe("1");
    });
  });

  it("serializes exact ready CAS and scope placement mutation", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = await insertSplitScope(persistence, "ready_lock");
      const reserved = await reserveReceipt(persistence, scopeId, epochA);
      const expected = receiptIdentity(reserved.receipt);
      const advisoryKey = 93_121;
      await installReadyGate(persistence, advisoryKey);
      const gateClient = await persistence.pool.connect();
      const placementUpdateClient = await persistence.pool.connect();
      const firstPidReady = new Deferred<number>();
      const secondPidReady = new Deferred<number>();
      let gateHeld = false;
      let placementUpdateTransaction = false;

      try {
        await gateClient.query("select pg_advisory_lock($1)", [advisoryKey]);
        gateHeld = true;
        const firstPublish = persistence.drizzle.transaction(async (tx) => {
          try {
            firstPidReady.resolve(await backendPid(tx));
            return await publishScopeAuthorityReadyInTransaction(tx, {
              expected,
            });
          } catch (error) {
            firstPidReady.reject(error);
            throw error;
          }
        });
        void firstPublish.catch(() => undefined);
        const firstPid = await firstPidReady.promise;
        const gatedPid = await waitForAdvisoryWaiter(
          persistence,
          advisoryKey,
        );
        expect(gatedPid).toBe(firstPid);

        const secondPublish = persistence.drizzle.transaction(async (tx) => {
          try {
            secondPidReady.resolve(await backendPid(tx));
            return await publishScopeAuthorityReadyInTransaction(tx, {
              expected,
            });
          } catch (error) {
            secondPidReady.reject(error);
            throw error;
          }
        });
        void secondPublish.catch(() => undefined);
        const secondPid = await secondPidReady.promise;
        await expect(
          waitForBlockingPids(persistence, secondPid),
        ).resolves.toContain(firstPid);

        const placementUpdatePid = await beginPlacementUpdate(
          placementUpdateClient,
        );
        placementUpdateTransaction = true;
        const placementUpdate = placementUpdateClient.query(
          `
            update fx_control_scope
            set
              isolation_kind = 'database_per_scope',
              physical_locator_json = '{
                "kind": "database_per_scope",
                "databaseKey": "other-database",
                "schemaName": "public"
              }'::jsonb
            where id = $1
          `,
          [scopeId],
        );
        void placementUpdate.catch(() => undefined);
        await expect(
          waitForBlockingPids(persistence, placementUpdatePid),
        ).resolves.toContain(firstPid);

        await gateClient.query("select pg_advisory_unlock($1)", [advisoryKey]);
        gateHeld = false;
        const [first, second] = await Promise.all([
          firstPublish,
          secondPublish,
        ]);
        await placementUpdate;
        await placementUpdateClient.query("rollback");
        placementUpdateTransaction = false;

        expect([first.status, second.status].sort()).toEqual([
          "already_ready",
          "published_ready",
        ]);
        expect(first.receipt).toEqual(second.receipt);
        expect(first.receipt).toMatchObject({
          state: "ready",
          physicalLocator: schemaLocator,
          initialEpoch: epochA,
        });
        await expect(
          persistence.getScopeMetadata(scopeId),
        ).resolves.toMatchObject({ physicalLocator: schemaLocator });
      } finally {
        if (gateHeld) {
          await gateClient.query("select pg_advisory_unlock($1)", [
            advisoryKey,
          ]);
        }
        if (placementUpdateTransaction) {
          await placementUpdateClient.query("rollback");
        }
        gateClient.release();
        placementUpdateClient.release();
      }
    });
  });

  it("preserves a committed reservation across target failure and retry", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = await insertSplitScope(persistence, "target_failure");
      const reserved = await reserveReceipt(persistence, scopeId, epochA);

      await expect(
        Promise.reject(new Error("injected-located-target-failure")),
      ).rejects.toThrow("injected-located-target-failure");
      const retry = await reserveReceipt(persistence, scopeId, epochB);

      expect(retry).toEqual({
        status: "already_reserved",
        receipt: reserved.receipt,
      });
      await expect(
        getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
      ).resolves.toEqual(reserved.receipt);
      await expect(persistence.getScopeClock(scopeId)).resolves.toBeNull();
    });
  });
});

async function insertSplitScope(
  persistence: PostgresFlarexPersistence,
  suffix: string,
): Promise<ScopeId> {
  const deploymentId = `deployment_receipt_pg_${suffix}`;
  const scopeId = ScopeIdSchema.make(`scope_receipt_pg_${suffix}`);
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_receipt_pg_${suffix}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: schemaLocator,
  });
  return scopeId;
}

async function reserveReceipt(
  persistence: PostgresFlarexPersistence,
  scopeId: ScopeId,
  candidateInitialEpoch: ScopeEpoch,
): Promise<ReserveSplitScopeAuthorityProvisioningReceiptResult> {
  return persistence.drizzle.transaction((tx) =>
    reserveScopeAuthorityProvisioningReceiptInTransaction(tx, {
      scopeId,
      physicalLocator: schemaLocator,
      candidateInitialEpoch,
    }),
  );
}

function receiptIdentity(
  receipt: SplitScopeAuthorityProvisioningReceiptIdentity,
): SplitScopeAuthorityProvisioningReceiptIdentity {
  return {
    scopeId: receipt.scopeId,
    protocolVersion: receipt.protocolVersion,
    physicalLocator: receipt.physicalLocator,
    initialEpoch: receipt.initialEpoch,
  };
}

async function receiptCount(
  persistence: Pick<PostgresFlarexPersistence, "query">,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(
    "select count(*)::text as count from fx_control_scope_provisioning",
  );
  const count = result.rows[0]?.count;
  if (count === undefined) {
    throw new Error("Receipt count query returned no row.");
  }
  return count;
}

async function installReadyGate(
  persistence: Pick<PostgresFlarexPersistence, "query">,
  advisoryKey: number,
): Promise<void> {
  await persistence.query(`
    create function flarex_receipt_ready_test_gate()
    returns trigger
    language plpgsql
    as $function$
    begin
      perform pg_advisory_xact_lock(${advisoryKey});
      return new;
    end
    $function$;

    create trigger flarex_receipt_ready_test_gate
    before update on fx_control_scope_provisioning
    for each row execute function flarex_receipt_ready_test_gate();
  `);
}

async function beginPlacementUpdate(
  client: PoolClient,
): Promise<number> {
  await client.query("begin");
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid()::integer as pid",
  );
  const pid = result.rows[0]?.pid;
  if (pid === undefined) {
    await client.query("rollback");
    throw new Error("Placement update connection returned no backend PID.");
  }
  return pid;
}

async function backendPid(
  tx: Parameters<typeof publishScopeAuthorityReadyInTransaction>[0],
): Promise<number> {
  const result = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid()::int as pid`,
  );
  if (typeof result !== "object" || result === null) {
    throw new Error("Postgres returned an invalid backend PID result.");
  }
  const rows = Reflect.get(result, "rows");
  if (!Array.isArray(rows)) {
    throw new Error("Postgres returned an invalid backend PID row set.");
  }
  const firstRow: unknown = rows[0];
  if (typeof firstRow !== "object" || firstRow === null) {
    throw new Error("Postgres did not return a backend PID.");
  }
  const pid = Reflect.get(firstRow, "pid");
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error("Postgres returned an invalid backend PID.");
  }
  return pid;
}

async function waitForAdvisoryWaiter(
  persistence: Pick<PostgresFlarexPersistence, "query">,
  advisoryKey: number,
): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await persistence.query<{ pid: number }>(
      `
        select pid::integer as pid
        from pg_locks
        where locktype = 'advisory'
          and granted = false
          and classid = 0::oid
          and objid = $1::integer::oid
          and objsubid = 1
        order by pid
        limit 1
      `,
      [advisoryKey],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await delay(10);
  }
  throw new Error("Ready publisher did not reach the advisory gate.");
}

async function waitForBlockingPids(
  persistence: Pick<PostgresFlarexPersistence, "query">,
  blockedPid: number,
): Promise<readonly number[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await persistence.query<{ blockers: number[] }>(
      "select pg_blocking_pids($1::integer) as blockers",
      [blockedPid],
    );
    const blockers = result.rows[0]?.blockers ?? [];
    if (blockers.length > 0) return blockers;
    await delay(10);
  }
  throw new Error(`Backend ${blockedPid} was not blocked by readiness CAS.`);
}

class Deferred<Value> {
  readonly promise: Promise<Value>;
  private resolvePromise: ((value: Value) => void) | null = null;
  private rejectPromise: ((error: unknown) => void) | null = null;

  constructor() {
    this.promise = new Promise<Value>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(value: Value): void {
    const resolve = this.resolvePromise;
    if (resolve === null) return;
    this.resolvePromise = null;
    this.rejectPromise = null;
    resolve(value);
  }

  reject(error: unknown): void {
    const reject = this.rejectPromise;
    if (reject === null) return;
    this.resolvePromise = null;
    this.rejectPromise = null;
    reject(error);
  }
}
