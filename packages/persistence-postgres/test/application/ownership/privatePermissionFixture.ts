import { randomUUID, createHash } from "node:crypto";
import { Effect, Exit, Result, Scope } from "effect";
import { prepareStandardApplicationDefinitionV1 } from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { produceInternalStandardApplicationSourceWithWritePolicies } from "@flarex/standard-application-definition/internal/write-policy-source";
import { sourceBundleFromProduced, makeStandardApplicationCurrentAnalysisV1, MiniflareApplicationAnalysisWorkerLoader } from
  "../../../../system-test/support/standardApplicationCurrentAnalysisHarness";
import { verifyApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { relationReadinessFixture, prepareReadinessEvidence } from "../relations/applicationRelationReadinessFixture";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { createSessionJournalStorePersistence } from "../../../src/execution/sessionJournalStore";
import { prepareFiniteApplicationMutationAdmission, readPreparedFiniteApplicationMutationInputs } from "../../../src/application/applicationMutationAdmission";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { createApplicationMutationSessionActivationPersistenceV1 } from "../../../src/execution/session/activation";
import { applicationMutationActivationEvidenceFixture } from "../applicationMutationActivationFixture";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { createPointCommitPublisherPortV1 } from "../../../src/commit/point/construction";
import { createAppUniqueConstraintDefinitionPortV1 } from "../../../src/storage/unique/appUniqueConstraintCommitV1";
import { deriveApplicationSyscallValidator } from "../../../src/application/revision/applicationRevisionSyscallValidatorV1";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { relationAuthorityFromAnchor } from "../../commit/point/support/relations";
import { pointCommitAuthorityPinsFromStoredSessionV1, pointCommitSessionFromStoredSessionV1 } from "../../commit/point/support/commandEvidence";
import type { StoredTransactionSessionScalarsV1 } from "flarex-protocol/transaction-session";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../../execution/session/support/activationEvidence";
import { policyFixture, policyManifestFixture, hashPolicyFixture } from "./applicationWritePolicyFixture";
import { snapshotApplicationExecutionAuthorityJson } from "../../../src/application/applicationExecutionAuthoritySnapshot";
import { prepareFiniteAppSchemaCandidateWriteGuardPortEffect } from "../../../src/storage/catalog/appSchemaCandidateValidation";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import type { CompiledPayloadCollections } from "../../../../payload-adapter/src/collections";
import type { SessionJournalStorePersistence } from "../../../src/execution/journal/contracts";
import type { PreparedFiniteApplicationMutationAdmission } from "../../../src/application/applicationMutationAdmission";
import type { CurrentApplicationFiniteEntry } from "../../../src/application/activation/contracts";
import { requireScopeAuthorizationRevocationEpochInTransactionEffect } from "../../../src/scope/scopeClock";

/** Only data/setup/observation: production owners issue all authority and settle. */
export async function privatePermissionFixture(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  payload?: CompiledPayloadCollections, controlPersistence?: PGliteFlarexPersistence) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing private permission namespace");
  const scope = await Effect.runPromise(Scope.make());
  const loader = new MiniflareApplicationAnalysisWorkerLoader();
  const initial = payload?.schemaDefinition.writePolicies ?? policyFixture();
  const payloadPolicy = initial.tables.find(table => table.owner === "payload" && table.logicalTableName === "posts");
  const payloadTable = payload?.logicalDefinition.tables.find(table => table.logicalName === "posts");
  if (payloadPolicy === undefined || payload !== undefined && (payloadTable === undefined || payload.configuration.tables.length !== 1))
    throw new Error("Permission fixture requires one native posts collection");
  const posts = payloadTable?.definition ?? { kind: "appDocument" as const, definitionVersion: 1 as const,
    documentType: { type: "object" as const, value: { title: { fieldType: { type: "string" as const }, optional: false } } } };
  const policies = { ...initial, tables: [
    { logicalTableName: "audit", owner: "application-command" as const, policyId: "application.reference-permissions" as const },
    payloadPolicy, { logicalTableName: "users", owner: "application" as const },
  ] };
  const definition = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: { maximumModules: 1, maximumFunctions: 1, maximumIdentifierUtf8Bytes: 1024,
      maximumValidatorNodes: 32, maximumValidatorDepth: 8, maximumValidatorStringUtf8Bytes: 1024 },
    programInput: { format: "flarex.declarative-program/v1", version: 1, schema: { tables: [
      { logicalName: "audit", definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object",
        value: { policy: { fieldType: { type: "any" }, optional: false } } } } },
      { logicalName: "posts", definition: posts },
      { logicalName: "users", definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object",
        value: { name: { fieldType: { type: "string" }, optional: false } } } } },
    ], indexes: payload?.logicalDefinition.indexes ?? [] }, modules: [{ modulePath: "functions", functions: [{ exportName: "write", kind: "mutation",
      visibility: "public", argsValidator: { type: "any" }, returnsValidator: null }] }] },
    materializationBudgetInput: { maximumModules: 1, maximumEntryBindings: 1, maximumSourceBytes: 4096,
      maximumSourceMapBytes: 0, maximumBytesMaterialized: 16384, maximumSemanticRecords: 32,
      maximumSemanticRecordBytes: 8192, maximumSemanticStreamBytes: 32768 },
    graphInput: { modules: [{ path: "functions.js", roles: ["function", "execution"],
      sourceBytes: new TextEncoder().encode("export const write = async () => null;\n"), sourceMapBytes: null }],
      functionEntries: [{ logicalModulePath: "functions", artifactModulePath: "functions.js" }],
      executionPath: "functions.js", schemaPath: null, authPath: null },
  }));
  const source = await sourceBundleFromProduced(Result.getOrThrow(
    produceInternalStandardApplicationSourceWithWritePolicies(definition, policies)));
  const control = controlPersistence ?? await createMigratedPGlitePersistence();
  try {
    const initialManifest = await policyManifestFixture();
    const expected = await Effect.runPromise(verifyApplicationManifestV3({ ...initialManifest.manifest,
      sourceArtifact: source.sourceArtifact, schema: { ...initialManifest.manifest.schema, writePolicies: policies,
        writePolicySetSha256: hashPolicyFixture(policies),
        tables: [
          { ...initialManifest.manifest.schema.tables[0]!, placement: { kind: "partitionBy", field: "_id" }, validator: { type: "object", value: { policy: { fieldType: { type: "any" }, optional: false } } } },
          { ...initialManifest.manifest.schema.tables[1]!, validator: posts.documentType, placement: { kind: "partitionBy", field: "_id" } },
          { tableId: 3, name: "users", validator: { type: "object", value: { name: { fieldType: { type: "string" }, optional: false } } }, placement: { kind: "partitionBy", field: "_id" } },
        ], indexes: (payload?.logicalDefinition.indexes ?? []).map((index, position) => ({ indexId: position + 1,
          tableId: 2, name: index.descriptor, fields: index.fields })),
      },
    }));
    const application = await relationReadinessFixture({ persistence, controlPersistence: control, writePolicy: true, bindingAdmission: true,
      physicalLocator: { kind: "database_per_scope", databaseKey: "private_permissions", schemaName },
      cmsManifest: { manifest: expected.manifest, manifestSha256: createHash("sha256").update(expected.canonicalBytes).digest("hex") },
      analysis: makeStandardApplicationCurrentAnalysisV1(source, loader, "private-permissions"),
    });
    await prepareReadinessEvidence(application);
    const ready = await Effect.runPromise(application.fold.settle(application.input));
    if (ready.status !== "ready") throw new Error("Permission source did not become ready");
    await Effect.runPromise(application.relationActivation.activate({ revisionId: application.input.revisionId, expectedActiveHead: null }));
    const context = Object.freeze({ deploymentId: application.deploymentId, controlDb: control.drizzle,
      authority: application.authorityPorts, schema: application.servingOwners.schema,
      relationSchema: application.foldContext.schema });
    const retained = await Effect.runPromise(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle),
      Effect.gen(function* () {
        const preparation = yield* prepareFiniteApplicationMutationAdmission(application.relationActivation, "functions:write", context);
        const candidateSchemaWriteGuard = yield* prepareFiniteAppSchemaCandidateWriteGuardPortEffect({
          candidateValidation: application.candidateValidation, pointCommitAuthority: application.pointCommitAuthority,
        }, { deploymentId: application.deploymentId, scopeId: application.authority.scopeId, profile: "fullArtifactProof" });
        return Object.freeze({ preparation, candidateSchemaWriteGuard });
      })));
    await Effect.runPromise(Scope.addFinalizer(scope, retained.close));
    const prepared = await Effect.runPromise(retained.use(host => Effect.fromResult(
      readPreparedFiniteApplicationMutationInputs(host.preparation, context))));
    const store = createSessionJournalStorePersistence(application.pointCommitAuthority,
      { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1, randomUuid: randomUUID });
    const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(control.drizzle);
    const candidateSchemaWriteGuard = await Effect.runPromise(retained.use(host => Effect.succeed(host.candidateSchemaWriteGuard)));
    const publisherOptions = {
      ...application.servingOwners.materialization, uniqueConstraints, candidateSchemaWriteGuard,
      uniqueConstraintEligibility: application.servingOwners.uniqueConstraintEligibility,
    };
    type PublisherOptions = NonNullable<Parameters<typeof createPointCommitPublisherPortV1>[1]>;
    const makePublisher = (options: Pick<PublisherOptions, "logicalOperationProfiles" | "afterTransactionStep"> = {}) =>
      createPointCommitPublisherPortV1(application.pointCommitAuthority, { ...publisherOptions, ...options });
    const prepareEvidence = () => Effect.tryPromise({ try: async () => {
      const authorizationRevocationEpoch = await persistence.drizzle.transaction(tx => Effect.runPromise(
        requireScopeAuthorizationRevocationEpochInTransactionEffect(tx, application.authority.scopeId)));
      return applicationMutationActivationEvidenceFixture({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(application.deploymentId), executionAuthority: prepared.executionAuthority,
      authorizationRevocationEpoch,
      requestKey: randomUUID(), grantId: randomUUID(),
    }); }, catch: cause => new Error("Permission fixture grant construction failed", { cause }) });
    const openEffect = Effect.fn("PrivatePermissionFixture.open")(function* (options: Readonly<{
      participants?: Parameters<SessionJournalStorePersistence["prepareFiniteEntryEffect"]>[0];
      preparedAdmission?: PreparedFiniteApplicationMutationAdmission;
      currentEntry?: CurrentApplicationFiniteEntry;
    }> = {}) {
      const entry = yield* Scope.provide(store.prepareFiniteEntryEffect(options.participants ?? []), scope);
      const evidence = yield* prepareEvidence();
      const activated = yield* retained.use(host =>
        createApplicationMutationSessionActivationPersistenceV1(application.pointCommitAuthority,
          { leaseDurationMilliseconds: 240_000, randomUuid: randomUUID }).activateFiniteEffect({
          deploymentId: TransactionGrantDeploymentIdV1Schema.make(application.deploymentId), scopeId: evidence.scopeId, preparedAdmission: options.preparedAdmission ?? host.preparation,
          admissionContext: context, evidence: evidence.evidence,
          ...(options.currentEntry === undefined ? {} : { currentEntry: options.currentEntry }),
        }, entry));
      if (activated.activation.status !== "created" || activated.entry === undefined) throw new Error("Missing finite permission entry");
      const activation = activated.activation;
      const confirmed = Result.getOrThrow(store.confirmedFiniteEntryAttempt(activated.entry, entry));
      const validator = yield* Scope.provide(deriveApplicationSyscallValidator({
        scopeId: application.authority.scopeId, schemaVersionId: confirmed.context.executionPin.schemaVersionId,
        schemaManifest: confirmed.schemaManifest,
      }), scope);
      const principal = Object.freeze({ scopeId: application.authority.scopeId, principalDigest: confirmed.context.principalDigest });
      const row = confirmed.context.session;
      if (row.lifecycle !== "running" || row.validatedArgsCanonicalBytes === null || row.authorizationGrantCanonicalBytes === null ||
        row.applicationExecutionAuthorityJson === null || row.applicationExecutionAuthorityCanonicalBytes === null ||
        row.applicationExecutionAuthoritySha256 === null) throw new Error("Missing finite entry session data");
      // Scalar projection of genuine entry data only; the real publisher authenticates it.
      const session: StoredTransactionSessionScalarsV1 = {
        lifecycle: row.lifecycle, executionAuthorityGeneration: "application_v1",
        applicationExecutionAuthorityJson: snapshotApplicationExecutionAuthorityJson(row.applicationExecutionAuthorityJson),
        applicationExecutionAuthorityCanonicalBytes: row.applicationExecutionAuthorityCanonicalBytes,
        applicationExecutionAuthoritySha256: row.applicationExecutionAuthoritySha256,
        storageGeneration: row.storageGeneration, storageGenerationFence: row.storageGenerationFence,
        functionPath: row.functionPath, functionKind: row.functionKind, schemaVersionId: row.schemaVersionId,
        policyVersion: row.policyVersion, identityAccessPolicySha256: row.identityAccessPolicySha256,
        validatedArgsValueCodecVersion: row.validatedArgsValueCodecVersion,
        validatedArgsCanonicalByteLength: row.validatedArgsCanonicalBytes.byteLength, validatedArgsSha256: row.validatedArgsSha256,
        authorizationGrantId: row.authorizationGrantId, authorizationGrantValueCodecVersion: row.authorizationGrantValueCodecVersion,
        authorizationGrantCanonicalByteLength: row.authorizationGrantCanonicalBytes.byteLength, authorizationGrantSha256: row.authorizationGrantSha256,
        authorizationRevocationEpoch: row.authorizationRevocationEpoch, authorizationGrantExpiresAtMilliseconds: row.authorizationGrantExpiresAt.getTime(),
        requestKey: row.requestKey, requestSha256: row.requestSha256, protocolVersion: row.protocolVersion,
        hardExpiresAtMilliseconds: row.hardExpiresAt.getTime(), createdAtMilliseconds: row.createdAt.getTime(), updatedAtMilliseconds: row.updatedAt.getTime(),
      };
      const preparePublication = async (value: unknown = null,
        options: Pick<PublisherOptions, "logicalOperationProfiles" | "afterTransactionStep"> = {}) => {
        const frozenAttempt = await Effect.runPromise(store.freezeFiniteRootEffect(confirmed.attempt,
          await Effect.runPromise(canonicalizeSuccessfulResultV1Effect(value))));
        const authority = relationAuthorityFromAnchor(activation.anchor,
          confirmed.context.executionPin.schemaVersionId, activation.executionClaim);
        const selectedPublisher = makePublisher(options);
        const command = { authorityPins: pointCommitAuthorityPinsFromStoredSessionV1(authority, session),
          session: pointCommitSessionFromStoredSessionV1(session, "running"), executionClaim: activation.executionClaim, frozenAttempt };
        return { command, publish: selectedPublisher.publishFinite(command), resolve: selectedPublisher.resolveFinite(command) };
      };
      const publish = async (value: unknown = null, logicalOperationProfiles?: PublisherOptions["logicalOperationProfiles"]) =>
        Effect.runPromise((await preparePublication(value, logicalOperationProfiles === undefined ? {} : { logicalOperationProfiles })).publish);
      return { attempt: confirmed.attempt, validator, principal, publish, preparePublication, admissions: confirmed.admissions,
        applicationSelection: confirmed.applicationSelection };
    });
    const open = (options?: Parameters<typeof openEffect>[0]) => Effect.runPromise(openEffect(options));
    return { store, open, openEffect, application, control, context, prepared, publisherOptions, makePublisher, prepareEvidence,
      scope, closePreparation: () => Effect.runPromise(retained.close), close: async () => {
      try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await loader.dispose(); }
    } };
  } catch (cause) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await loader.dispose();
    throw cause;
  }
}
