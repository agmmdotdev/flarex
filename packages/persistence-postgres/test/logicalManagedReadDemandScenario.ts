import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect } from "vitest";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import type { PreparedInstallation } from "../src/installationLifecycle";
import type { TrustedScopeAuthority } from "../src/scopeAuthorityResolution";
import type { LogicalStorageReadDemand } from "../src/logicalDocuments/model";
import type { LogicalWhere } from "../src/logicalDocuments/query";
import { prepareLogicalReadMetadata, type LogicalSourceReadPin } from "../src/logicalReadMetadata";
import { prepareLogicalReadDemand } from "../src/logicalStorageReadiness";
import { prepareLogicalReadMechanics } from "../src/logicalDocuments/workingSet";
import { makePreparedHostRuntime, retainPreparedHost } from "../src/preparedHostRuntime";
import { runEffectTransaction } from "../src/effectTransaction";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../src/scopeClock";
import { fxSystemIndexBuildStates } from "../src/schema";

/** Real protected metadata issuance and the existing target readiness owner.
 * The native managed host tests own the separate accepting-batch proof. */
export const logicalManagedReadDemandScenario = Effect.fn("LogicalManagedReadDemand.scenario")(function* (
  input: Readonly<{ controlDb: FlarexMetadataDatabase; controlInstallation: PreparedInstallation;
    targetDb: FlarexMetadataDatabase; ownerDb: FlarexMetadataDatabase; deploymentId: string; scopeId: ScopeId;
    schemaVersionId: CatalogSchemaVersionId; authority: TrustedScopeAuthority; source: LogicalSourceReadPin;
    tableName: string; otherTableName: string; where: LogicalWhere }>,
) {
  yield* Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 16_777_216 });
    const retained = yield* retainPreparedHost(runtime, Effect.gen(function* () {
      const metadata = yield* prepareLogicalReadMetadata(input.controlDb, input, input.source, input.controlInstallation);
      const table = yield* metadata.table(input.tableName);
      const other = yield* metadata.table(input.otherTableName);
      const index = yield* metadata.selectIndex(input.tableName, input.where);
      if (index === null || table.tableId === other.tableId) return yield* Effect.die("Missing real demand fixture paths");
      const demand = yield* prepareLogicalReadDemand(metadata);
      return { metadata, table, other, index, demand };
    }));
    yield* Effect.acquireUseRelease(Effect.succeed(retained), retained => retained.use(prepared => Effect.gen(function* () {
      const inspect = (demand: LogicalStorageReadDemand) => runEffectTransaction(
        work => input.targetDb.transaction(work), "Managed metadata demand owner witness", (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, input.scopeId);
          return yield* prepared.demand.inspectDemand(tx, input.authority, clock, demand);
        }), cause => new Error("Managed metadata demand owner transaction", { cause }));
      const indexDemand = { kind: "index" as const, tableId: prepared.table.tableId,
        indexDefinitionId: prepared.index.indexDefinitionId };
      expect(yield* inspect(indexDemand)).toMatchObject({ status: "ready", readiness: "queryRequired" });
      expect(yield* Effect.result(inspect({ ...indexDemand, tableId: prepared.other.tableId })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidComposition" } });
      let getterEntered = false;
      const copied = Object.defineProperty({ ...prepared.metadata }, "root", { get() {
        getterEntered = true;
        throw new Error("Unissued preparation must not inspect caller properties");
      } });
      for (const attempted of [yield* Effect.result(prepareLogicalReadDemand(copied)),
        yield* Effect.result(prepareLogicalReadMechanics(copied))])
        expect(attempted)
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidComposition" } });
      expect(getterEntered).toBe(false);
      const predicate = and(eq(fxSystemIndexBuildStates.scopeId, input.scopeId),
        eq(fxSystemIndexBuildStates.indexDefinitionId, prepared.index.indexDefinitionId));
      const [original] = yield* runDrizzleStatementEffect(input.targetDb.select().from(fxSystemIndexBuildStates).where(predicate),
        cause => new Error("Capture actual index lifecycle", { cause }));
      if (original === undefined) return yield* Effect.die("Missing selected index build");
      expect(original.lifecycle).toBe("enabled");
      yield* Effect.acquireUseRelease(runDrizzleStatementEffect(input.ownerDb.update(fxSystemIndexBuildStates)
        .set({ lifecycle: "retiring", maintenanceActivationSequence: null, })
        .where(predicate), cause => new Error("Retire actual selected index", { cause })), () => Effect.gen(function* () {
          expect(yield* inspect({ kind: "rows", tableId: prepared.table.tableId }))
            .toMatchObject({ status: "ready", readiness: "queryRequired" });
          expect(yield* inspect(indexDemand)).toMatchObject({ status: "not_ready", kind: "index",
            indexDefinitionId: prepared.index.indexDefinitionId, lifecycle: "retiring" });
        }), () => runDrizzleStatementEffect(input.ownerDb.update(fxSystemIndexBuildStates).set(original).where(predicate),
          cause => new Error("Restore actual selected index", { cause })));
    })), retained => retained.close);
  }));
});
