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

/** Only data/setup/observation: production owners issue all authority and settle. */
export async function privatePermissionFixture(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing private permission namespace");
  const scope = await Effect.runPromise(Scope.make());
  const loader = new MiniflareApplicationAnalysisWorkerLoader();
  const initial = policyFixture();
  const policies = { ...initial, tables: [
    { logicalTableName: "audit", owner: "application-command" as const, policyId: "application.reference-permissions" as const },
    initial.tables[1]!, { logicalTableName: "users", owner: "application" as const },
  ] };
  const definition = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: { maximumModules: 1, maximumFunctions: 1, maximumIdentifierUtf8Bytes: 1024,
      maximumValidatorNodes: 32, maximumValidatorDepth: 8, maximumValidatorStringUtf8Bytes: 1024 },
    programInput: { format: "flarex.declarative-program/v1", version: 1, schema: { tables: [
      { logicalName: "audit", definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object",
        value: { policy: { fieldType: { type: "any" }, optional: false } } } } },
      { logicalName: "posts", definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object",
        value: { title: { fieldType: { type: "string" }, optional: false } } } } },
      { logicalName: "users", definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object",
        value: { name: { fieldType: { type: "string" }, optional: false } } } } },
    ], indexes: [] }, modules: [{ modulePath: "functions", functions: [{ exportName: "write", kind: "mutation",
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
  const control = await createMigratedPGlitePersistence();
  try {
    const initialManifest = await policyManifestFixture();
    const expected = await Effect.runPromise(verifyApplicationManifestV3({ ...initialManifest.manifest,
      sourceArtifact: source.sourceArtifact, schema: { ...initialManifest.manifest.schema, writePolicies: policies,
        writePolicySetSha256: hashPolicyFixture(policies),
        tables: [
          { ...initialManifest.manifest.schema.tables[0]!, placement: { kind: "partitionBy", field: "_id" }, validator: { type: "object", value: { policy: { fieldType: { type: "any" }, optional: false } } } },
          { ...initialManifest.manifest.schema.tables[1]!, placement: { kind: "partitionBy", field: "_id" } },
          { tableId: 3, name: "users", validator: { type: "object", value: { name: { fieldType: { type: "string" }, optional: false } } }, placement: { kind: "partitionBy", field: "_id" } },
        ],
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
    const publisher = createPointCommitPublisherPortV1(application.pointCommitAuthority, {
      ...application.servingOwners.materialization, uniqueConstraints, candidateSchemaWriteGuard,
      uniqueConstraintEligibility: application.servingOwners.uniqueConstraintEligibility,
    });
    const open = async () => {
      const entry = await Effect.runPromise(Scope.provide(store.prepareFiniteEntryEffect([]), scope));
      const evidence = await applicationMutationActivationEvidenceFixture({
        deploymentId: TransactionGrantDeploymentIdV1Schema.make(application.deploymentId), executionAuthority: prepared.executionAuthority,
        requestKey: randomUUID(), grantId: randomUUID(),
      });
      const activated = await Effect.runPromise(retained.use(host =>
        createApplicationMutationSessionActivationPersistenceV1(application.pointCommitAuthority,
          { leaseDurationMilliseconds: 240_000, randomUuid: randomUUID }).activateFiniteEffect({
          deploymentId: TransactionGrantDeploymentIdV1Schema.make(application.deploymentId), scopeId: evidence.scopeId, preparedAdmission: host.preparation,
          admissionContext: context, evidence: evidence.evidence,
        }, entry)));
      if (activated.activation.status !== "created" || activated.entry === undefined) throw new Error("Missing finite permission entry");
      const activation = activated.activation;
      const confirmed = Result.getOrThrow(store.confirmedFiniteEntryAttempt(activated.entry, entry));
      const validator = await Effect.runPromise(Scope.provide(deriveApplicationSyscallValidator({
        scopeId: application.authority.scopeId, schemaVersionId: confirmed.context.executionPin.schemaVersionId,
        schemaManifest: confirmed.schemaManifest,
      }), scope));
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
      const publish = async (value: unknown = null) => {
        const frozenAttempt = await Effect.runPromise(store.freezeFiniteRootEffect(confirmed.attempt,
          await Effect.runPromise(canonicalizeSuccessfulResultV1Effect(value))));
        const authority = relationAuthorityFromAnchor(activation.anchor,
          confirmed.context.executionPin.schemaVersionId, activation.executionClaim);
        return Effect.runPromise(publisher.publishFinite({ authorityPins: pointCommitAuthorityPinsFromStoredSessionV1(authority, session),
          session: pointCommitSessionFromStoredSessionV1(session, "running"), executionClaim: activation.executionClaim, frozenAttempt }));
      };
      return { attempt: confirmed.attempt, validator, principal, publish };
    };
    return { store, open, application, closePreparation: () => Effect.runPromise(retained.close), close: async () => {
      try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await loader.dispose(); }
    } };
  } catch (cause) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await loader.dispose();
    throw cause;
  }
}
