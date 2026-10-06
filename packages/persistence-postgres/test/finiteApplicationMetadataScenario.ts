import { createHash, randomUUID } from "node:crypto";
import { Effect, Exit, Result, Scope, Tracer } from "effect";
import { expect, vi } from "vitest";
import { PglitePreparedQuery } from "drizzle-orm/pglite";
import { verifyApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { createMixedMutationPerformanceTrace } from "./mixedMutationPerformanceTrace";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { captureFiniteApplicationMetadata, inspectFiniteApplicationMetadata, prepareRetainedApplicationBindingSelection,
  readCapturedFiniteApplicationMetadata, type AcceptedApplicationBinding, type FiniteApplicationMetadata } from "../src/applicationActivation";
import { prepareFiniteApplicationMutationAdmission, readPreparedFiniteApplicationMutationInputs,
  withPreparedFiniteApplicationMutationAdmissionInTransaction } from "../src/applicationMutationAdmission";
import { withApplicationBindingEvidenceInTransaction } from "../src/applicationBindingProjection";
import { retainPreparedHost } from "../src/preparedHostRuntime";
import { createSessionJournalStorePersistence } from "../src/sessionJournalStore";
import { createApplicationMutationSessionActivationPersistenceV1 } from "../src/transactionSessionActivation";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { payloadScalarFields, payloadScalarConfiguration } from "../../payload-adapter/src/testing/profiles";
import { policyManifestFixture } from "./applicationWritePolicyFixture";
import { preparePayloadRelationSuccessor } from "./payloadRelationFixture";
import { deriveApplicationSyscallValidator } from "../src/applicationRevisionSyscallValidatorV1";
import { fxControlSchemaVersionUniqueConstraintSets } from "../src/schema";
import { and, eq } from "drizzle-orm";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import type { cmsHostFixture } from "./cmsHostFixture";
import { relationReadinessFixture, prepareReadinessEvidence } from "./applicationRelationReadinessFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { preparedHostTestRuntime } from "./preparedHostRuntimeTestSupport";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "./transactionSessionActivationTestSupport";
import { applicationMutationActivationEvidenceFixture } from "./applicationMutationActivationFixture";
import { createApplicationNativeMutationMixedFixture } from "./fixtures/applicationNativeMutationTestFixture";
import type { FiniteEntryAttemptKernelContext } from "../src/transactionSessionAttemptKernel";
import type { ApplicationActivationTargetProfile } from "../src/applicationReadiness";
import { captureFiniteApplicationAttemptMetadata, prepareFiniteAttemptMetadataProjection,
  type FiniteApplicationStorageDemand } from "../src/logicalDocuments/sourceAdmission";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { prepareStandardApplicationDefinitionV1 } from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { produceStandardApplicationCurrentSourceBundleV1, makeStandardApplicationCurrentAnalysisV1,
  MiniflareApplicationAnalysisWorkerLoader } from "../../system-test/support/standardApplicationCurrentAnalysisHarness";

/** A genuine selected legacy entry keeps its original metadata while fresh ownership changes. */
export async function finiteApplicationMetadataScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  options: Readonly<{ ownershipSuccessor?: true; controlPersistence?: PGliteFlarexPersistence | PostgresFlarexPersistence;
    activationProfile?: ApplicationActivationTargetProfile;
    sessionTargetOptions?: NonNullable<Parameters<typeof cmsHostFixture>[1]>["sessionTargetOptions"];
    afterMetadata?: (entry: Readonly<{ context: FiniteEntryAttemptKernelContext;
      finiteApplicationReadDemand: FiniteApplicationStorageDemand;
      authorityPorts: Awaited<ReturnType<typeof createApplicationNativeMutationMixedFixture>>["authorityPorts"];
      sessionAuthority: Awaited<ReturnType<typeof createApplicationNativeMutationMixedFixture>>["sessionAuthority"];
    }>) => Promise<void> }> = {}) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing actual schema");
  const control = options.controlPersistence ?? await createMigratedPGlitePersistence();
  const physicalLocator = { kind: "database_per_scope" as const, databaseKey: "finite_metadata_target", schemaName };
  const source = await produceStandardApplicationCurrentSourceBundleV1(Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: { maximumModules: 1, maximumFunctions: 1, maximumIdentifierUtf8Bytes: 1024,
      maximumValidatorNodes: 32, maximumValidatorDepth: 8, maximumValidatorStringUtf8Bytes: 1024 },
    programInput: { format: "flarex.declarative-program/v1", version: 1,
      schema: { tables: [{ logicalName: "audit", definition: { kind: "appDocument", definitionVersion: 1,
        documentType: { type: "object", value: { title: { fieldType: { type: "string" }, optional: false } } } } }], indexes: [] },
      modules: [{ modulePath: "functions", functions: [{ exportName: "write", kind: "mutation", visibility: "public",
        argsValidator: { type: "any" }, returnsValidator: null }] }] },
    materializationBudgetInput: { maximumModules: 1, maximumEntryBindings: 1, maximumSourceBytes: 4096,
      maximumSourceMapBytes: 0, maximumBytesMaterialized: 16384, maximumSemanticRecords: 16,
      maximumSemanticRecordBytes: 4096, maximumSemanticStreamBytes: 16384 },
    graphInput: { modules: [{ path: "functions.js", roles: ["function", "execution"],
      sourceBytes: new TextEncoder().encode('export const write = async (ctx, args) => ctx.db.insert("audit", { title: args.title });\n'),
      sourceMapBytes: null }], functionEntries: [{ logicalModulePath: "functions", artifactModulePath: "functions.js" }],
      executionPath: "functions.js", schemaPath: null, authPath: null },
  })));
  const loader = new MiniflareApplicationAnalysisWorkerLoader();
  const scope = await runEffect(Scope.make());
  let closeHost: Effect.Effect<void> = Effect.void;
  try {
    const application = await createApplicationNativeMutationMixedFixture({ runtimeHostIdentity: "flarex.test/finite-metadata",
      compatibilityDate: "2026-08-25", includeTask: false, physicalLocator,
      ...(options.activationProfile === undefined ? {} : { activationProfile: options.activationProfile }),
      ...(options.sessionTargetOptions?.managedInstallation === undefined ? {} : { managedInstallation: options.sessionTargetOptions.managedInstallation }),
      analysis: makeStandardApplicationCurrentAnalysisV1(source, loader, "finite-metadata") }, { control, target: persistence });
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(application.deploymentId);
    const context = Object.freeze({ deploymentId: application.deploymentId, controlDb: control.drizzle,
      authority: application.authorityPorts, schema: application.schema });
    const retained = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle),
      prepareFiniteApplicationMutationAdmission(application.activation, "functions:write", context).pipe(
        Effect.map(preparation => Object.freeze({ preparation })))));
    closeHost = retained.close;
    const prepared = await runEffect(retained.use(host => Effect.fromResult(readPreparedFiniteApplicationMutationInputs(host.preparation, context))));
    let uuidCalls = 0;
    const store = createSessionJournalStorePersistence(application.sessionAuthority,
      { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1, randomUuid: () => { uuidCalls++; return randomUUID(); } });
    const entry = await runEffect(Scope.provide(store.prepareFiniteEntryEffect([]), scope));
    const evidence = await applicationMutationActivationEvidenceFixture({ deploymentId, executionAuthority: prepared.executionAuthority,
      requestKey: randomUUID(), grantId: randomUUID() });
    const activated = await runEffect(retained.use(host => createApplicationMutationSessionActivationPersistenceV1(application.sessionAuthority,
      { leaseDurationMilliseconds: 240_000, randomUuid: randomUUID }).activateFiniteEffect({ deploymentId, scopeId: evidence.scopeId,
      preparedAdmission: host.preparation, admissionContext: context, evidence: evidence.evidence }, entry)));
    if (activated.activation.status !== "created" || activated.entry === undefined) throw new Error("Expected confirmed finite entry");
    const confirmed = Result.getOrThrow(store.confirmedFiniteEntryAttempt(activated.entry, entry));
    const root = confirmed.attempt;
    const anchor = activated.activation.anchor;
    const captureAuthority = options.afterMetadata === undefined ? undefined :
      await runEffect(resolveLocatedTrustedScopeAuthorityEffect(deploymentId, application.authorityPorts));
    const bindingHost = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle),
      prepareRetainedApplicationBindingSelection(application.activation).pipe(Effect.map(selection => ({ selection })))));
    try {
      const selection = await runEffect(bindingHost.use(host => Effect.succeed(host.selection)));
      let metadata: FiniteApplicationMetadata | undefined;
      let accepted: AcceptedApplicationBinding | undefined;
      let finiteApplicationReadDemand: FiniteApplicationStorageDemand | undefined;
      await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
        const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, anchor.scopeId);
        yield* withApplicationBindingEvidenceInTransaction(selection, tx, clock, (_evidence, binding) => Effect.gen(function* () {
          accepted = binding;
          metadata = yield* Effect.fromResult(captureFiniteApplicationMetadata(binding, selection, tx, clock, root, anchor.snapshotToken.commitSeq));
        }));
        if (accepted === undefined) return yield* Effect.die("Missing entry issuer");
        expect(Result.isFailure(captureFiniteApplicationMetadata(accepted, selection, tx, clock, root, anchor.snapshotToken.commitSeq))).toBe(true);
        if (captureAuthority !== undefined) yield* retained.use(host =>
          withPreparedFiniteApplicationMutationAdmissionInTransaction(host.preparation, context, tx, clock,
          (admission, binding) => Effect.gen(function* () {
            const captureMetadata = yield* Effect.fromResult(captureFiniteApplicationAttemptMetadata(binding, admission.selection, root,
              tx, clock, captureAuthority.authority, { scopeId: anchor.scopeId, sessionId: anchor.sessionId,
                attemptFence: anchor.attemptFence, principalDigest: confirmed.context.principalDigest,
                executionProfile: "finiteRoot", snapshotCommitSeq: anchor.snapshotToken.commitSeq,
                schemaVersionId: confirmed.context.executionPin.schemaVersionId }, clock.lastMetadataSequence));
            yield* prepareFiniteAttemptMetadataProjection(captureMetadata, root, tx);
            finiteApplicationReadDemand = { metadata: captureMetadata, root, demand: { kind: "clock" } };
          })));
      })));
      if (metadata === undefined) throw new Error("Missing immutable metadata");
      const selector = inspectFiniteApplicationMetadata(metadata, root);
      if (selector === null) throw new Error("Missing reservation selector");
      const detached = Result.getOrThrow(readCapturedFiniteApplicationMetadata(metadata, root));
      detached.basis.headSha256.fill(0); detached.basis.activationSha256.fill(0);
      expect(inspectFiniteApplicationMetadata(metadata, root)).toEqual(selector);
      for (const [input, attempt] of [[new Proxy(metadata, {}), root], [metadata, new Proxy(root, {})]] as const)
        expect(Result.isFailure(readCapturedFiniteApplicationMetadata(input, attempt))).toBe(true);
      const spans: string[] = [];
      const tracer = Tracer.make({ span(span) { spans.push(span.name); return new Tracer.NativeSpan(span); } });
      const first = await runEffect(Effect.fromResult(readCapturedFiniteApplicationMetadata(metadata, root)).pipe(Effect.provideService(Tracer.Tracer, tracer)));
      expect(first.basis.deploymentId).toBe(deploymentId);
      expect(inspectFiniteApplicationMetadata(metadata, root)?.schemaVersionId).toBe(prepared.basis.schemaVersionId);
      expect(spans).not.toContain("ApplicationActivation.readLegacyTransaction");
      if (options.ownershipSuccessor) {
        const prior = await runEffect(application.activation.readActive());
        const policy = await policyManifestFixture(undefined, true, payloadScalarFields, payloadScalarConfiguration);
        const originalAudit = prior.basis.manifest.schema.tables.find(table => table.name === "audit");
        if (originalAudit === undefined) throw new Error("Missing original audit schema");
        const managedManifest = await runEffect(verifyApplicationManifestV3({ ...policy.manifest,
          functions: prior.basis.manifest.functions,
          schema: { ...policy.manifest.schema, tables: policy.manifest.schema.tables.map(table => table.name === "audit" ? originalAudit : table) } }));
        const managed = await relationReadinessFixture({ persistence, controlPersistence: control, physicalLocator,
          writePolicy: true, cmsIndexes: true, bindingAdmission: true,
          ...(options.activationProfile === undefined ? {} : { activationProfile: options.activationProfile }),
          fixtureIdentity: { deploymentId: application.deploymentId, projectId: "project_application_native_mutation", uuidOffset: 10_000 },
          ...(options.sessionTargetOptions === undefined ? {} : { sessionTargetOptions: options.sessionTargetOptions }),
          cmsFields: payloadScalarFields, cmsManifest: { manifest: managedManifest.manifest,
            manifestSha256: createHash("sha256").update(managedManifest.canonicalBytes).digest("hex") } });
        await prepareReadinessEvidence(managed);
        await runEffect(managed.fold.settle(managed.input));
        await runEffect(managed.relationActivation.activate({ revisionId: managed.input.revisionId, expectedActiveHead: prior.expectedActiveHead }));
        const active = await runEffect(managed.relationActivation.readActive());
        const next = await preparePayloadRelationSuccessor(managed);
        await runEffect(next.relationActivation.activate({ revisionId: next.input.revisionId, expectedActiveHead: active.expectedActiveHead }));
        expect(control.drizzle).not.toBe(persistence.drizzle);
        expect(await persistence.drizzle.select().from(fxControlSchemaVersionUniqueConstraintSets)
          .where(eq(fxControlSchemaVersionUniqueConstraintSets.schemaVersionId, next.relation.binding.schemaVersionId))).toHaveLength(0);
        const audit = await runEffect(store.resolvePointTableEffect(root, "audit"));
        const validator = await runEffect(Scope.provide(deriveApplicationSyscallValidator({ scopeId: anchor.scopeId,
          schemaVersionId: prepared.basis.schemaVersionId, schemaManifest: confirmed.schemaManifest }), scope));
        const beforeUuid = uuidCalls;
        // PGlite's transaction client owns query(), so observe real prepared-query
        // execution rather than the distinct outer client's query method.
        const controlQueries = "pool" in control ? undefined : vi.spyOn(PglitePreparedQuery.prototype, "execute");
        const trace = "pool" in control && "pool" in persistence ? createMixedMutationPerformanceTrace({ controlPool: control.pool, targetPool: persistence.pool }) : undefined;
        try {
          const write = () => runEffect(store.runPointOperationEffect(audit, { kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
            fields: { title: "original unmanaged write" } }, validator));
          expect(await (trace === undefined ? write() : trace.withInvocation({ id: "finite-ownership", mode: "recon" }, write)))
            .toMatchObject({ kind: "completed", outcome: { kind: "inserted" } });
          expect(uuidCalls).toBe(beforeUuid + 1);
          if (controlQueries !== undefined) expect(controlQueries.mock.instances.some(query =>
            query instanceof PglitePreparedQuery && query.getQuery().sql.includes("fx_read_application_ownership_unique_closure"))).toBe(true);
          if (trace !== undefined) expect(trace.records().flatMap(record => record.dispatches).some(dispatch =>
            dispatch.outcome === "ok" && dispatch.template?.includes("fx_read_application_ownership_unique_closure"))).toBe(true);
        } finally { controlQueries?.mockRestore(); trace?.close(); }
        const closureIdentity = and(eq(fxControlSchemaVersionUniqueConstraintSets.deploymentId, application.deploymentId),
          eq(fxControlSchemaVersionUniqueConstraintSets.schemaVersionId, next.relation.binding.schemaVersionId));
        const [closure] = await control.drizzle.select().from(fxControlSchemaVersionUniqueConstraintSets).where(closureIdentity);
        if (closure === undefined) throw new Error("Missing genuine control closure");
        try {
          // Deliberate control-owner corruption: the original finite anchor and admission remain untouched.
          await control.drizzle.update(fxControlSchemaVersionUniqueConstraintSets).set({ definitionSetSha256: new Uint8Array(32) }).where(closureIdentity);
          const beforeRejectedUuid = uuidCalls;
          expect(await runEffectFailure(store.runPointOperationEffect(audit, { kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
            fields: { title: "corrupt closure must refuse" } }, validator))).toMatchObject({ _tag: "SessionJournalPersistenceV1Error",
              cause: { _tag: "FiniteStorageCaptureError", reason: "storedCorruption" } });
          expect(uuidCalls).toBe(beforeRejectedUuid);
        } finally {
          await control.drizzle.update(fxControlSchemaVersionUniqueConstraintSets).set({ definitionSetSha256: closure.definitionSetSha256 }).where(closureIdentity);
        }
      }
      if (options.afterMetadata !== undefined) {
        if (finiteApplicationReadDemand === undefined) throw new Error("Missing genuine finite clock demand");
        await options.afterMetadata({ context: confirmed.context, finiteApplicationReadDemand,
          authorityPorts: application.authorityPorts, sessionAuthority: application.sessionAuthority });
      }
      await runEffect(bindingHost.close);
      expect(Result.isFailure(readCapturedFiniteApplicationMetadata(metadata, root))).toBe(true);
    } finally { await runEffect(bindingHost.close); }
  } finally { await runEffect(closeHost); await runEffect(Scope.close(scope, Exit.succeed(undefined))); await loader.dispose(); }
}
