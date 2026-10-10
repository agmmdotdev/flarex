import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../support/postgresHelpers";
import { legacyWriterExclusionScenario } from "./legacyWriterExclusionScenario";
import {
  createApplicationNativeMutationPostgresFixture,
} from "../application/applicationNativeMutationTestFixture";
import {
  relationReadinessFixture,
  prepareReadinessEvidence,
} from "../application/relations/applicationRelationReadinessFixture";
import { runEffect } from "../support/effectTestRuntime";
import {
  makeApplicationActivationRepository,
} from "../../src/application/activation/repository";
import { lockScopeClockForUpdateInTransactionEffect } from "../../src/scope/scopeClock";
import { validateApplicationWriteOwnershipForCommit } from "../../src/application/ownership/Commit";

describe.skipIf(postgresUrl === null)("legacy writer exclusion (ordinary PostgreSQL)", () => {
  it("excludes legacy writes under active contract 1", () => withTemporaryPostgresPersistencePair(async (control, target) => {
    expect((await target.query<{ rolsuper: boolean }>("select rolsuper from pg_roles where rolname = current_user")).rows[0]?.rolsuper).toBe(false);
    const fixture = await createApplicationNativeMutationPostgresFixture({ runtimeHostIdentity: "legacy-exclusion", compatibilityDate: "2026-09-19" }, { control, target });
    await legacyWriterExclusionScenario({ target, ports: fixture.sessionAuthority, deploymentId: fixture.deploymentId,
      scopeId: fixture.authority.scopeId, schemaVersionId: fixture.schemaAuthority.schemaVersionId });
  }), 90_000);

  it("orders legacy refusal after contract 2 activation and preserves prior replay", () => withTemporaryPostgresPersistencePair(async (_control, target) => {
    const fixture = await relationReadinessFixture({ persistence: target });
    await legacyWriterExclusionScenario({ target, ports: fixture.pointCommitAuthority, deploymentId: fixture.deploymentId,
      scopeId: fixture.authority.scopeId, schemaVersionId: fixture.relation.binding.schemaVersionId }, async () => {
      await prepareReadinessEvidence(fixture);
      expect(await runEffect(fixture.fold.settle(fixture.input))).toMatchObject({ status: "ready" });
      const entered = barrier<void>();
      const release = barrier<void>();
      const waiterPid = barrier<number>();
      const activationOwner = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
        readiness: fixture.legacyReadiness, relationReadiness: fixture.fold, authority: fixture.authorityPorts,
        faultAfter: async point => { if (point === "headWritten") { entered.resolve(); await release.promise; } } });
      const activation = Promise.allSettled([runEffect(activationOwner.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }))]);
      let waiter: Promise<PromiseSettledResult<void>[]> | undefined;
      try {
        await Promise.race([entered.promise, activation.then(() => { throw new Error("Activation missed barrier"); })]);
        waiter = Promise.allSettled([target.drizzle.transaction(async tx => {
          const pid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]?.pid;
          if (!pid) throw new Error("Missing writer PID");
          waiterPid.resolve(pid);
          await runEffect(Effect.gen(function* () {
            yield* lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId);
            yield* validateApplicationWriteOwnershipForCommit(tx, { scopeId: fixture.authority.scopeId,
              generation: "legacy_dynamic_worker_v1", authenticatedAttemptedTables: null, materialTables: [] });
          }));
        })]);
        const pid = await Promise.race([waiterPid.promise, waiter.then(() => { throw new Error("Writer missed PID barrier"); })]);
        await expect.poll(async () => (await target.query<{ blocked: boolean }>("select cardinality(pg_blocking_pids($1)) > 0 as blocked", [pid])).rows[0]?.blocked).toBe(true);
      } finally {
        release.resolve();
        await Promise.all([activation, waiter]);
      }
      expect(await activation).toMatchObject([{ status: "fulfilled", value: { status: "activated" } }]);
      expect(await waiter).toMatchObject([{ status: "rejected", reason: { reason: "writeDenied" } }]);
    });
  }), 90_000);
});

function barrier<Value>() {
  let resolve: (value: Value) => void = () => { throw new Error("Barrier not initialized"); };
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}
