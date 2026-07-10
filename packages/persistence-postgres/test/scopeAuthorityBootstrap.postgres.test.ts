import { setTimeout as delay } from "node:timers/promises";
import type { PoolClient } from "pg";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  createPostgresSharedScopeAuthorityBootstrapper,
  InvalidGeneratedScopeAuthorityIdError,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

const sharedLocator = {
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const;

const uuids = {
  scopeA: "30000000-0000-4000-8000-000000000001",
  epochA: "30000000-0000-4000-8000-000000000002",
  scopeB: "30000000-0000-4000-8000-000000000003",
  epochB: "30000000-0000-4000-8000-000000000004",
  scopeC: "30000000-0000-4000-8000-000000000005",
  epochC: "30000000-0000-4000-8000-000000000006",
} as const;

describePostgres("real Postgres shared scope authority bootstrap", () => {
  it("converges concurrent missing-clock repairs on one persisted epoch", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = ScopeIdSchema.make(`scope_${uuids.scopeA}`);
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_pg_bootstrap_repair",
        projectId: "project_pg_bootstrap_repair",
      });
      await persistence.insertScopeMetadata({
        scopeId,
        deploymentId: "deployment_pg_bootstrap_repair",
        physicalLocator: sharedLocator,
      });
      const first = bootstrapper(persistence, uuidSequence(uuids.epochA));
      const second = bootstrapper(persistence, uuidSequence(uuids.epochB));
      const frontier = await first.captureFrontier();

      const results = await runWithSerializedDeploymentLockProof(
        persistence,
        "clock",
        () => first.runBatch({ frontier, limit: 1 }),
        () => second.runBatch({ frontier, limit: 1 }),
      );

      const items = results.map((result) => result.items[0]);
      expect(items.map((item) => item?.status).sort()).toEqual([
        "already_provisioned",
        "repaired_missing_clock",
      ]);
      expect(new Set(items.map((item) => item?.clock.epoch)).size).toBe(1);
      await expect(persistence.getScopeClock(scopeId)).resolves.toEqual(
        items[0]?.clock,
      );
      await expect(first.verifyFrontier(frontier)).resolves.toMatchObject({
        status: "complete_through_frontier",
        counts: { deployments: 1n, completePairs: 1n },
      });
    });
  });

  it("converges two runners over the same missing-scope page", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_pg_bootstrap_page",
        projectId: "project_pg_bootstrap_page",
      });
      const first = bootstrapper(
        persistence,
        uuidSequence(uuids.scopeA, uuids.epochA),
      );
      const second = bootstrapper(
        persistence,
        uuidSequence(uuids.scopeB, uuids.epochB),
      );
      const frontier = await first.captureFrontier();

      const results = await runWithSerializedDeploymentLockProof(
        persistence,
        "scope",
        () => first.runBatch({ frontier, limit: 1 }),
        () => second.runBatch({ frontier, limit: 1 }),
      );

      const items = results.map((result) => result.items[0]);
      expect(items.map((item) => item?.status).sort()).toEqual([
        "already_provisioned",
        "created_scope_and_clock",
      ]);
      expect(new Set(items.map((item) => item?.scope.scopeId)).size).toBe(1);
      expect(new Set(items.map((item) => item?.clock.epoch)).size).toBe(1);
      await expect(authorityCounts(persistence)).resolves.toEqual({
        deployments: "1",
        scopes: "1",
        clocks: "1",
      });
    });
  });

  it("holds the deployment identity lock through scope and clock creation", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_pg_identity_lock",
        projectId: "project_pg_identity_lock",
      });
      const bootstrap = bootstrapper(
        persistence,
        uuidSequence(uuids.scopeA, uuids.epochA),
      );
      const frontier = await bootstrap.captureFrontier();
      const gateClient = await persistence.pool.connect();
      const updateClient = await persistence.pool.connect();
      let gateHeld = false;
      let pending: ReturnType<typeof bootstrap.runBatch> | undefined;
      let update: Promise<unknown> | undefined;
      try {
        const gatePid = await clientBackendPid(gateClient);
        await installInsertGate(persistence, "scope", gatePid);
        await gateClient.query(
          "select pg_advisory_lock($1::integer)",
          [gatePid],
        );
        gateHeld = true;
        pending = bootstrap.runBatch({ frontier, limit: 1 });
        const bootstrapPid = await waitForBlockedBy(persistence, gatePid);

        await updateClient.query("begin");
        const updatePid = await clientBackendPid(updateClient);
        update = updateClient.query(
          "update deployments set project_id = $2 where deployment_id = $1",
          ["deployment_pg_identity_lock", "project_pg_replacement"],
        );
        await waitForSpecificBlockedBy(
          persistence,
          updatePid,
          bootstrapPid,
        );

        await gateClient.query(
          "select pg_advisory_unlock($1::integer)",
          [gatePid],
        );
        gateHeld = false;
        await expect(pending).resolves.toMatchObject({
          status: "complete",
          items: [{ status: "created_scope_and_clock" }],
        });
        await update;
        await updateClient.query("rollback");
        update = undefined;
        await expect(
          persistence.getDeploymentMetadata("deployment_pg_identity_lock"),
        ).resolves.toMatchObject({ projectId: "project_pg_identity_lock" });
      } finally {
        if (gateHeld) {
          const gatePid = await clientBackendPid(gateClient);
          await gateClient
            .query("select pg_advisory_unlock($1::integer)", [gatePid])
            .catch(() => undefined);
        }
        await updateClient.query("rollback").catch(() => undefined);
        if (update !== undefined) {
          await Promise.allSettled([update]);
        }
        if (pending !== undefined) {
          await Promise.allSettled([pending]);
        }
        gateClient.release();
        updateClient.release();
      }
    });
  });

  it("detects a late commit behind an advanced lexical cursor", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_pg_frontier_b",
        projectId: "project_pg_frontier_b",
      });
      const lateClient = await persistence.pool.connect();
      try {
        await lateClient.query("begin");
        await lateClient.query(
          `
            insert into deployments (deployment_id, project_id)
            values ($1, $2)
          `,
          ["deployment_pg_frontier_a", "project_pg_frontier_a"],
        );
        const bootstrap = bootstrapper(
          persistence,
          uuidSequence(uuids.scopeA, uuids.epochA),
        );
        const frontier = await bootstrap.captureFrontier();
        const page = await bootstrap.runBatch({ frontier, limit: 1 });
        expect(page.status).toBe("complete");

        await lateClient.query("commit");

        await expect(bootstrap.verifyFrontier(frontier)).resolves.toMatchObject({
          status: "needs_bootstrap_pass",
          counts: { deployments: 2n, completePairs: 1n, missingScopes: 1n },
        });
      } catch (error) {
        await lateClient.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        lateClient.release();
      }
    });
  });

  it("rolls back only the current deployment when clock initialization fails", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_pg_bootstrap_rollback",
        projectId: "project_pg_bootstrap_rollback",
      });
      const bootstrap = bootstrapper(
        persistence,
        uuidSequence(uuids.scopeC, "invalid-epoch"),
      );
      const frontier = await bootstrap.captureFrontier();

      await expect(
        bootstrap.runBatch({ frontier, limit: 1 }),
      ).rejects.toBeInstanceOf(InvalidGeneratedScopeAuthorityIdError);
      await expect(
        persistence.getDeploymentMetadata("deployment_pg_bootstrap_rollback"),
      ).resolves.not.toBeNull();
      await expect(
        persistence.getScopeMetadataByDeploymentId(
          "deployment_pg_bootstrap_rollback",
        ),
      ).resolves.toBeNull();
      await expect(authorityCounts(persistence)).resolves.toEqual({
        deployments: "1",
        scopes: "0",
        clocks: "0",
      });
    });
  });
});

function bootstrapper(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
) {
  return createPostgresSharedScopeAuthorityBootstrapper(persistence, {
    physicalLocator: sharedLocator,
    randomUuid,
  });
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("UUID test sequence was exhausted.");
    }
    index += 1;
    return value;
  };
}

async function runWithSerializedDeploymentLockProof<Result>(
  persistence: PostgresFlarexPersistence,
  gateTarget: InsertGateTarget,
  startFirst: () => Promise<Result>,
  startSecond: () => Promise<Result>,
): Promise<[Result, Result]> {
  const gateClient = await persistence.pool.connect();
  let gateHeld = false;
  let gatePid: number | undefined;
  let first: Promise<Result> | undefined;
  let second: Promise<Result> | undefined;
  try {
    gatePid = await clientBackendPid(gateClient);
    await installInsertGate(persistence, gateTarget, gatePid);
    await gateClient.query(
      "select pg_advisory_lock($1::integer)",
      [gatePid],
    );
    gateHeld = true;
    first = startFirst();
    const firstPid = await waitForBlockedBy(persistence, gatePid);
    second = startSecond();
    await waitForBlockedBy(persistence, firstPid);
    await gateClient.query(
      "select pg_advisory_unlock($1::integer)",
      [gatePid],
    );
    gateHeld = false;
    return await Promise.all([first, second]);
  } finally {
    if (gateHeld && gatePid !== undefined) {
      await gateClient
        .query("select pg_advisory_unlock($1::integer)", [gatePid])
        .catch(() => undefined);
    }
    const pending = [first, second].filter(
      (promise): promise is Promise<Result> => promise !== undefined,
    );
    await Promise.allSettled(pending);
    gateClient.release();
  }
}

type InsertGateTarget = "clock" | "scope";

async function installInsertGate(
  persistence: PostgresFlarexPersistence,
  target: InsertGateTarget,
  advisoryKey: number,
): Promise<void> {
  switch (target) {
    case "clock":
      await persistence.exec(`
        create function block_bootstrap_clock_insert()
        returns trigger
        language plpgsql
        as $$
        begin
          perform pg_advisory_xact_lock(${advisoryKey});
          return new;
        end;
        $$;
        create trigger block_bootstrap_clock_insert_trigger
        before insert on fx_system_scope_clock
        for each row execute function block_bootstrap_clock_insert();
      `);
      return;
    case "scope":
      await persistence.exec(`
        create function block_bootstrap_scope_insert()
        returns trigger
        language plpgsql
        as $$
        begin
          perform pg_advisory_xact_lock(${advisoryKey});
          return new;
        end;
        $$;
        create trigger block_bootstrap_scope_insert_trigger
        before insert on fx_control_scope
        for each row execute function block_bootstrap_scope_insert();
      `);
      return;
  }
}

async function clientBackendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error("PostgreSQL returned an invalid backend PID.");
  }
  return pid;
}

async function waitForBlockedBy(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ pid: number }>(
      `
      select pid::int as pid
      from pg_stat_activity
      where wait_event_type = 'Lock'
        and $1 = any(pg_blocking_pids(pid))
      order by pid
      limit 1
      `,
      [blockerPid],
    );
    const pid = result.rows[0]?.pid;
    if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) {
      return pid;
    }
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for a PostgreSQL backend to block on ${blockerPid}.`,
  );
}

async function waitForSpecificBlockedBy(
  persistence: PostgresFlarexPersistence,
  waiterPid: number,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: boolean }>(
      `
        select exists (
          select 1
          from pg_stat_activity
          where pid = $1
            and wait_event_type = 'Lock'
            and $2 = any(pg_blocking_pids(pid))
        ) as blocked
      `,
      [waiterPid, blockerPid],
    );
    if (result.rows[0]?.blocked === true) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for PostgreSQL backend ${waiterPid} to block on ${blockerPid}.`,
  );
}

async function authorityCounts(
  persistence: Pick<PostgresFlarexPersistence, "query">,
): Promise<{
  readonly deployments: string;
  readonly scopes: string;
  readonly clocks: string;
}> {
  const result = await persistence.query<{
    deployments: string;
    scopes: string;
    clocks: string;
  }>(`
    select
      (select count(*)::text from deployments) as deployments,
      (select count(*)::text from fx_control_scope) as scopes,
      (select count(*)::text from fx_system_scope_clock) as clocks
  `);
  const counts = result.rows[0];
  if (counts === undefined) {
    throw new Error("Authority count query returned no row.");
  }
  return counts;
}
