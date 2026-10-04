import { and, eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { prepareStandardApplicationDefinitionV1 } from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { produceStandardApplicationSource } from "@flarex/standard-application-definition/application-source";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { APPLICATION_EXECUTION_METADATA_OWNER } from "../../persistence-postgres/src/finiteMetadataDependencies";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/pointCommitErrors";
import { readStoredFiniteMetadataReservation } from "../../persistence-postgres/src/finiteMetadataReservation";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { fxAppRowRevisions, fxSystemCommits, fxSystemMetadataContractObservations,
  fxSystemScopeExecutionAuthorities, fxSystemSnapshotLeases, fxSystemTransactionSessions } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { admittedCommerceEventGroup } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { MiniflareApplicationAnalysisWorkerLoader, makeStandardApplicationCurrentAnalysisV1,
  sourceBundleFromProduced } from "../../system-test/support/standardApplicationCurrentAnalysisHarness";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { rebindMixedMutationApplication } from "./support/mixedMutationApplicationRebinding";

const WorkerSuccess = Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) });
const ReturnedIds = Schema.Struct({ id: Schema.String, created: Schema.Struct({ id: Schema.String }) });
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

/** A genuine analyzer-owned program with the original global schema and function
 * contracts. Only executable source changes; exact original publication is restored. */
async function changedExecutableSource(fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>) {
  const manifest = fixture.active.basis.manifest;
  const prepared = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: { maximumModules: 1, maximumFunctions: 8, maximumIdentifierUtf8Bytes: 1024,
      maximumValidatorNodes: 128, maximumValidatorDepth: 16, maximumValidatorStringUtf8Bytes: 1024 },
    programInput: { format: "flarex.declarative-program/v1", version: 1,
      schema: { tables: manifest.schema.tables.map(table => {
        if (table.validator.type !== "object") throw new Error("Metadata ABA fixture requires genuine object table validators");
        return { logicalName: table.name,
          definition: { kind: "appDocument", definitionVersion: 1, documentType: table.validator } };
      }), indexes: manifest.schema.indexes.map(index => {
        const table = manifest.schema.tables.find(member => member.tableId === index.tableId);
        if (table === undefined) throw new Error("Metadata ABA fixture index has no genuine table declaration");
        return { tableLogicalName: table.name, descriptor: index.name, fields: index.fields,
          ...(index.decimalFields === undefined ? {} : { decimalFields: index.decimalFields }) };
      }) },
      modules: [{ modulePath: "users", functions: manifest.functions.map(fn => ({ exportName: fn.exportName,
        kind: fn.kind, visibility: fn.visibility, argsValidator: fn.args, returnsValidator: fn.returns })) }] },
    materializationBudgetInput: { maximumModules: 1, maximumEntryBindings: 8, maximumSourceBytes: 8192,
      maximumSourceMapBytes: 0, maximumBytesMaterialized: 65536, maximumSemanticRecords: 64,
      maximumSemanticRecordBytes: 8192, maximumSemanticStreamBytes: 65536 },
    graphInput: { modules: [{ path: "functions/users.js", roles: ["function", "execution"],
      sourceBytes: new TextEncoder().encode(["// genuinely changed executable for metadata ABA",
        ...manifest.functions.map(fn => `export async function ${fn.exportName}(_ctx, args) { return args; }`)].join("\n")),
      sourceMapBytes: null }], functionEntries: [{ logicalModulePath: "users", artifactModulePath: "functions/users.js" }],
      executionPath: "functions/users.js", schemaPath: null, authPath: null },
  }));
  const produced = Result.getOrThrow(produceStandardApplicationSource(prepared));
  // Author the fixture's original global placement using the real schema API.
  // The existing bundle owner hashes these actual bytes before the real analyzer.
  return sourceBundleFromProduced({ ...produced, modules: produced.modules.map(module => {
    if (module.path !== produced.schemaPath) return module;
    const schemaSource = new TextDecoder("utf-8", { fatal: true }).decode(module.sourceBytes);
    return { ...module, sourceBytes: new TextEncoder().encode(schemaSource.replaceAll("definePartitionTable", "defineGlobalTable")) };
  }) });
}

describe.each(drivers)("whole Worker metadata ABA retry on %s", driver => {
  it("reruns the root once at the same data snapshot after restoring the exact signed pins", async () => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let freshReservation: Effect.Success<ReturnType<typeof readStoredFiniteMetadataReservation>> | undefined;
    fixture = await createMixedMutationProductFixture({ driver,
      suffix: `metadata-aba-retry-${driver}`, payloadProfile: "success", hooks: {
        afterProductBorrow: method => method !== "update" || fixture.retryContexts.length === 0 ? Effect.void : Effect.tryPromise({
          try: async () => {
            const [lease] = await fixture.currency.persistence.drizzle.select().from(fxSystemSnapshotLeases)
              .where(eq(fxSystemSnapshotLeases.sessionId, fixture.activation.anchor.sessionId));
            if (lease === undefined) throw new Error("Missing fresh real entry reservation");
            freshReservation = await Effect.runPromise(readStoredFiniteMetadataReservation(lease));
          }, catch: cause => commerceError("resourceFailure", cause),
        }),
      } });
    const loader = new MiniflareApplicationAnalysisWorkerLoader();
    try {
      const { application, currency } = fixture;
      const scopeId = fixture.activation.anchor.scopeId;
      const sessionId = fixture.activation.anchor.sessionId;
      const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
      const originalActive = await Effect.runPromise(application.activation.readActive());
      const beforeClock = await currency.persistence.getScopeClock(scopeId);
      if (beforeClock === null) throw new Error("Missing initial real scope clock");
      const authorityFields = { epoch: fxSystemScopeExecutionAuthorities.epoch,
        revocation: fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch };
      const authorityBefore = await currency.persistence.drizzle.select(authorityFields).from(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
      const pinnedFields = { schemaVersionId: fxSystemTransactionSessions.schemaVersionId,
        functionPath: fxSystemTransactionSessions.functionPath, functionKind: fxSystemTransactionSessions.functionKind,
        executionModule: fxSystemTransactionSessions.executionModule, sourcePackageHash: fxSystemTransactionSessions.sourcePackageHash,
        grantSha256: fxSystemTransactionSessions.authorizationGrantSha256, requestSha256: fxSystemTransactionSessions.requestSha256 };
      const pinsBefore = await currency.persistence.drizzle.select(pinnedFields).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
      const headersBefore = await currency.persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid));
      const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const originalValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      const originalIds = Schema.decodeUnknownSync(ReturnedIds)(originalValue);
      const publication = await fixture.prepareOccPublication(originalValue);
      const [originalLease] = await currency.persistence.drizzle.select().from(fxSystemSnapshotLeases)
        .where(eq(fxSystemSnapshotLeases.sessionId, sessionId));
      if (originalLease?.metadataWatermark == null) throw new Error("Missing original authenticated metadata reservation");
      const initialMetadataWatermark = originalLease.metadataWatermark;
      expect(fixture.payload?.runtimeHistory.map(runtime => runtime.observations.hookRuns())).toEqual([1]);

      const changedSource = await changedExecutableSource(fixture);
      const changed = await application.registerRevision({ requestKey: `metadata-aba-changed-${driver}`,
        analysis: makeStandardApplicationCurrentAnalysisV1(changedSource, loader, `metadata-aba-${driver}`) });
      expect(changed.manifest.schema.tables.map(table => ({ name: table.name, validator: table.validator })))
        .toEqual(originalActive.basis.manifest.schema.tables.map(table => ({ name: table.name, validator: table.validator })));
      expect(changed.manifest.schema.indexes).toEqual(originalActive.basis.manifest.schema.indexes);
      const functionContracts = (functions: typeof changed.manifest.functions) => functions.map(fn => ({ path: fn.path,
        kind: fn.kind, visibility: fn.visibility, args: fn.args, returns: fn.returns }));
      expect(functionContracts(changed.manifest.functions)).toEqual(functionContracts(originalActive.basis.manifest.functions));
      expect(changed.manifest.schema).toEqual(originalActive.basis.manifest.schema);
      const unchangedSchema = await application.preparePublishedSchema(changed.manifest);
      expect(unchangedSchema.schemaVersionId).toBe(originalActive.basis.schemaVersionId);
      const ready = await Effect.runPromise(application.readiness.settle({ deploymentId: currency.deploymentId,
        scopeId, revisionId: changed.publication.revisionId }));
      expect(ready.status).toBe("ready");
      expect(await Effect.runPromise(application.activation.activate({ revisionId: changed.publication.revisionId,
        expectedActiveHead: originalActive.expectedActiveHead }))).toMatchObject({ status: "activated", disposition: "inserted" });
      const changedActive = await Effect.runPromise(application.activation.readActive());
      expect(changedActive.basis.manifest.sourceArtifact.rootSha256).not.toBe(originalActive.basis.manifest.sourceArtifact.rootSha256);
      expect(await Effect.runPromise(application.activation.activate({ revisionId: originalActive.basis.revisionId,
        expectedActiveHead: changedActive.expectedActiveHead }))).toMatchObject({ status: "activated", disposition: "inserted" });
      const restored = await Effect.runPromise(application.activation.readActive());
      expect(restored.basis.revisionId).toBe(originalActive.basis.revisionId);
      expect(restored.basis.schemaVersionId).toBe(originalActive.basis.schemaVersionId);
      expect(restored.basis.manifest.sourceArtifact.rootSha256).toBe(originalActive.basis.manifest.sourceArtifact.rootSha256);
      const rebound = await rebindMixedMutationApplication(fixture, `metadata-aba-rebind-${driver}`);
      const afterMetadataClock = await currency.persistence.getScopeClock(scopeId);
      if (afterMetadataClock === null) throw new Error("Missing restored real scope clock");
      expect(afterMetadataClock.lastCommitSeq).toBe(beforeClock.lastCommitSeq);
      expect(afterMetadataClock.lastMetadataSequence).toBeGreaterThan(initialMetadataWatermark);
      expect(await currency.persistence.drizzle.select(authorityFields).from(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId))).toEqual(authorityBefore);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)))
        .toEqual(headersBefore);
      const executionFacts = await currency.persistence.drizzle.select().from(fxSystemMetadataContractObservations).where(and(
        eq(fxSystemMetadataContractObservations.scopeId, scopeId),
        eq(fxSystemMetadataContractObservations.namespace, APPLICATION_EXECUTION_METADATA_OWNER.namespace),
        eq(fxSystemMetadataContractObservations.ownerKey, APPLICATION_EXECUTION_METADATA_OWNER.ownerKey)));
      expect(executionFacts.some(fact => fact.present && fact.lastChangedMetadataSequence > initialMetadataWatermark)).toBe(true);

      const conflict = await Effect.runPromise(publication).then(() => null, cause => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      if (!(conflict instanceof PointCommitConflictV1Error) || conflict.conflict.kind !== "metadata")
        throw new Error("Expected genuine metadata publication conflict", { cause: conflict });
      expect(conflict.snapshotCommitSeq).toBe(conflict.currentCommitSeq);
      expect(conflict.conflict.capturedMetadataWatermark).toBe(initialMetadataWatermark);
      expect(conflict.conflict.lastChangedMetadataSequence).toBeGreaterThan(initialMetadataWatermark);
      expect(await fixture.retryWholeAttempt(conflict)).toMatchObject({ kind: "published" });
      expect(fixture.retryContexts).toHaveLength(1);
      const fresh = fixture.retryContexts[0];
      if (fresh === undefined) throw new Error("Missing whole-root retry context");
      expect(fresh.snapshotToken).toEqual(fixture.activation.anchor.snapshotToken);
      expect(fresh.attemptFence).toBe(fixture.activation.anchor.attemptFence + 1n);
      expect(fixture.payload?.runtimeHistory.map(runtime => runtime.observations.hookRuns())).toEqual([1, 1]);
      expect(fixture.nativeInvokeCount.get("update")).toBe(2);
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(2);
      const freshIds = Schema.decodeUnknownSync(ReturnedIds)(fixture.retryReturnedValues[0]);
      expect(freshIds.id).not.toBe(originalIds.id);
      expect(freshIds.created.id).not.toBe(originalIds.created.id);
      for (const id of [freshIds.id, freshIds.created.id]) {
        const identity = decodeAppDocumentIdentityV1(id);
        const rows = await currency.persistence.drizzle.select().from(fxAppRowRevisions).where(and(
          eq(fxAppRowRevisions.scopeUuid, scopeUuid), eq(fxAppRowRevisions.tableId, identity.tableId)));
        expect(rows).toHaveLength(1);
      }
      const freshGroup = admittedCommerceEventGroup({ scopeUuid, sessionId, attemptFence: fresh.attemptFence });
      const events = await currency.persistence.drizzle.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      expect(events.filter(event => event.envelope.group === freshGroup)).toHaveLength(1);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)))
        .toHaveLength(headersBefore.length + 1);
      if (freshReservation === undefined) throw new Error("Fresh Worker did not observe its authentic entry reservation");
      expect(freshReservation.metadataWatermark).toBeGreaterThan(initialMetadataWatermark);
      expect(freshReservation.metadataWatermark).toBeGreaterThanOrEqual(conflict.conflict.lastChangedMetadataSequence);
      expect(freshReservation.attemptFence).toBe(fresh.attemptFence);
      expect(freshReservation.schemaVersionId).toBe(originalActive.basis.schemaVersionId);
      expect(await currency.persistence.drizzle.select(pinnedFields).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId))).toEqual(pinsBefore);
      expect(await rebound.readCurrentProduct()).toMatchObject({ id: fixture.seed.productId, title: fixture.seed.newTitle });
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } finally { try { await loader.dispose(); } finally { await fixture.close(); } }
  }, 240_000);
});
