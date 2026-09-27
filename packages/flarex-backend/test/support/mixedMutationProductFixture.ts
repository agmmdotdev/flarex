import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { Effect, Result, Schema } from "effect";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json } from
  "@flarex/persistence-postgres/internal/commerce-values";
import { CommitEnvelopeV1Schema, CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { requirePointMutationArgumentSemanticSizeV1 } from
  "flarex-protocol/point-mutation-start";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { encodeAdmittedFrameworkOperationV1Result } from
  "flarex-protocol/internal/admitted-framework-operation-v1";
import { selectApplicationMutationAdmission } from
  "../../../persistence-postgres/src/applicationMutationAdmission";
import { prepareLogicalRelationalAdmission } from
  "../../../persistence-postgres/src/logicalDocuments/relationalAdmission";
import { createApplicationMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1 } from
  "../../../persistence-postgres/src/transactionSessionActivation";
import { createStoredOccExecutionEvidenceLoaderV1 } from
  "../../../persistence-postgres/src/storedOccExecution";
import { createPointMutationExecutionClaimLivenessV1 } from
  "../../../persistence-postgres/src/transactionExecutionClaimLiveness";
import { createSessionJournalStorePersistenceV1 } from
  "../../../persistence-postgres/src/sessionJournalStore";
import { createStoredAttemptEvidenceLoaderV1 } from
  "../../../persistence-postgres/src/storedAttemptEvidence";
import { createStoredCommitAuthorityEvidenceLoaderV1 } from
  "../../../persistence-postgres/src/storedCommitAuthorityEvidence";
import { createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1, createPointMutationAttemptReplacementPortV1 } from
  "../../../persistence-postgres/src/pointCommitTransaction";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { createAppUniqueConstraintDefinitionPortV1 } from
  "../../../persistence-postgres/src/appUniqueConstraintCommitV1";
import { createAppUniqueConstraintSetEligibilityPortV1 } from
  "../../../persistence-postgres/src/appUniqueConstraintSetBuildV1";
import { createPointMutationJournalV1 } from
  "../../../executor/src/pointMutationJournal";
import { createPointMutationExecutionClaimVaultV1 } from
  "../../../executor/src/pointMutationExecutionClaim";
import { ApplicationPointMutationRunnerHostV1Error, createStoredPointCommitExecutorV1,
  createStoredPointMutationOccRerunExecutionV1 } from
  "../../../executor/src/storedAttemptAuthentication";
import type { PointMutationOccBoundJournalV1,
  PointMutationOccRuntimeNeutralRunnerInputV1,
  PointMutationOccRuntimeNeutralRunnerV1 } from
  "../../../executor/src/storedAttemptAuthentication";
import { createApplicationMutationGrantVerificationKernelV1 } from
  "../../../executor/src/applicationMutationGrantVerificationKernel";
import { createPointMutationSessionAttemptLoadingV1,
  createPointMutationSessionAttemptTerminalizationV1 } from
  "../../../executor/src/pointMutationSessionActivation";
import { decodePointMutationSessionAttemptSelectorV1 } from
  "../../../executor/src/pointMutationSessionAttemptSelector";
import { bindPointMutationOccJournal } from
  "../../../executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations";
import { issueSetupSeededSyscallValidatorProofV1 } from
  "../../../persistence-postgres/test/applicationRevisionSyscallValidatorTestSupport";
import { applicationMutationActivationFixture } from
  "../../../persistence-postgres/test/applicationMutationActivationFixture";
import { TEST_GRANT_RETENTION_POLICY_V1 } from
  "../../../persistence-postgres/test/transactionSessionActivationTestSupport";
import { logicalCurrencyFixture } from
  "../../../medusa-adapter/test/support/logical-currency-fixture";
import { prepareLogicalProductHost } from
  "../../../medusa-adapter/test/support/logical-product-fixture";
import { seedNativeProductAttemptGraph, runNativeStandaloneProductUpdate } from
  "../../../medusa-adapter/test/support/native-product-attempt-seed";
import { executePrivateProductAttemptOperation,
  preparePrivateProductAttempt, preparePrivateProductAttemptEventPolicy } from
  "@flarex/medusa-adapter/internal/product-attempt";
import { admittedCommerceEventGroup } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import {
  POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
  POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
  pointMutationExactRuntimeWorkerConfigurationSource,
  pointMutationExactRuntimeWorkerExecutionBridgeSource,
} from "../../src/artifactRuntime";
import { POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../../src/artifactRuntime/PointMutationExactRuntimeWorkerCore.generated";
import { POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1 } from
  "../../src/artifactRuntime/PointMutationRuntimeKernel.generated";
import { FUNCTION_API_CORE_MODULE_V1, FUNCTION_API_CORE_SOURCE_V1 } from
  "../../src/artifactRuntime/FunctionApiCore.generated";
import {
  APPLICATION_ERROR_PLATFORM_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
  applicationErrorPlatformSourceV1,
} from "../../src/artifactRuntime/ApplicationErrorExactRuntimeWorkerSource";

export interface MixedMutationProductFixtureHooks {
  readonly beforeNative?: (method: string) => Effect.Effect<void, CommerceTransactionError>;
  readonly afterNativeBeforeAck?: (method: string, result: Json) => Effect.Effect<void, CommerceTransactionError>;
  readonly afterStoreAckBeforeBridgeReply?: (method: string, result: Json) => void;
}
type CurrencyFixture = Awaited<ReturnType<typeof logicalCurrencyFixture>>;
type ProductFixture = Awaited<ReturnType<typeof prepareLogicalProductHost>>;
type ProductSeed = Awaited<ReturnType<typeof seedNativeProductAttemptGraph>>;
type Journal = ReturnType<typeof createPointMutationJournalV1>;
type BoundJournal = ReturnType<typeof bindPointMutationOccJournal>;
type CreatedActivation = Extract<Effect.Success<ReturnType<
  ReturnType<typeof createApplicationMutationSessionActivationPersistenceV1>["activateEffect"]
>>, { status: "created" }>;

export interface MixedMutationProductFixture {
  readonly currency: CurrencyFixture;
  readonly product: ProductFixture;
  readonly seed: ProductSeed["seed"];
  readonly baseline: ProductSeed["baseline"];
  readonly application: CurrencyFixture["application"];
  readonly active: Effect.Success<ReturnType<CurrencyFixture["application"]["activation"]["readActive"]>>;
  readonly activation: CreatedActivation;
  readonly prepared: Effect.Success<ReturnType<typeof prepareLogicalRelationalAdmission>>;
  readonly binding: Effect.Success<ReturnType<typeof preparePrivateProductAttempt>>;
  readonly eventPolicy: Effect.Success<ReturnType<typeof preparePrivateProductAttemptEventPolicy>>;
  readonly eventGroup: string;
  readonly journal: Journal;
  readonly store: ReturnType<typeof createSessionJournalStorePersistenceV1>;
  readonly executionClaims: ReturnType<typeof createPointMutationExecutionClaimVaultV1>;
  readonly attempt: Effect.Success<ReturnType<Journal["openAttempt"]>>;
  readonly bound: BoundJournal;
  readonly runAdmitted: NonNullable<BoundJournal["runAdmittedOperation"]>;
  readonly selector: ReturnType<typeof decodePointMutationSessionAttemptSelectorV1>;
  readonly schemaVersionId: CurrencyFixture["application"]["active"]["basis"]["schemaVersionId"];
  readonly logicalSchemaVersionId: CurrencyFixture["schemaVersionId"];
  readonly serviceTransactionDepth: number[];
  readonly pgTransactionObservations: Array<Readonly<{
    targetBackends: number; openTransactions: number;
  }>>;
  readonly nativeInvokeCount: Map<string, number>;
  readonly retryContexts: Array<PointMutationOccRuntimeNeutralRunnerInputV1["context"]>;
  readonly sqlByPhase: Map<string, number>;
  readonly hasSqlObserver: boolean;
  readonly bridgeFailures: string[];
  readonly runWorkerd: (source?: string,
    runnerInput?: PointMutationOccRuntimeNeutralRunnerInputV1) => Promise<unknown>;
  readonly getUpdateRequest: () => Parameters<NonNullable<BoundJournal["runAdmittedOperation"]>>[0] | undefined;
  readonly getOpenTransactionDepth: () => number;
  readonly getTransactionCounts: () => Readonly<{ beginCount: number; settleCount: number }>;
  readonly setSqlPhase: (phase: string) => void;
  readonly publisherOptions: Parameters<typeof createPointCommitPublisherPortV1>[1];
  readonly participantAuthority: ReturnType<Effect.Success<ReturnType<typeof prepareLogicalRelationalAdmission>>["createCommitAuthority"]>;
  readonly pointCommitPorts: CurrencyFixture["application"]["sessionAuthority"];
  readonly makePublisher: () => ReturnType<typeof createPointCommitPublisherPortV1>;
  readonly preparePublication: (returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) =>
    Promise<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>;
  readonly publish: (returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) =>
    Promise<Effect.Success<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>>;
  readonly replayPublication: () =>
    Promise<Effect.Success<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>>;
  readonly prepareOccPublication: (returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1]) =>
    Promise<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>;
  readonly retryWholeAttempt: (conflict: unknown) =>
    Promise<Effect.Success<ReturnType<ReturnType<typeof createStoredPointMutationOccRerunExecutionV1>[
      "executeAuthorizedPointMutationOccRerun"]>>>;
  readonly runStandaloneProductUpdate: (next: Readonly<{ title: string; handle: string }>) => Promise<Json>;
  readonly readCurrentProduct: () => Promise<Json>;
  readonly close: () => Promise<void>;
}

type MixedMutationProductFixtureInput = Readonly<{
  driver: "pglite" | "postgres"; suffix: string; hooks?: MixedMutationProductFixtureHooks;
}> & (Readonly<{ resource?: never; fixtureIdentity?: Readonly<{
  deploymentId: string; projectId: string; uuidOffset: number;
}> }> | Readonly<{ resource: CurrencyFixture["resource"]; fixtureIdentity: Readonly<{
  deploymentId: string; projectId: string; uuidOffset: number;
}> }>);

export async function createMixedMutationProductFixture(
  input: MixedMutationProductFixtureInput,
): Promise<MixedMutationProductFixture> {
  const cleanup: Array<() => Promise<void>> = [];
  const currency = await logicalCurrencyFixture(input.driver, close => cleanup.push(close),
    input.resource === undefined
      ? { includeProduct: true, ...(input.fixtureIdentity === undefined ? {} :
        { fixtureIdentity: input.fixtureIdentity }) }
      : { includeProduct: true, resource: input.resource, fixtureIdentity: input.fixtureIdentity });
  const product = await prepareLogicalProductHost(currency);
  await Effect.runPromise(product.host.initialize([]));
  await Effect.runPromise(product.host.close);
    const { seed, baseline } = await seedNativeProductAttemptGraph(currency, product, input.suffix);
    const application = currency.application;
    const active = await Effect.runPromise(application.activation.readActive());
    const schemaVersionId = application.active.basis.schemaVersionId;
    const logicalSchemaVersionId = currency.schemaVersionId;
    const applicationAdmission = await Effect.runPromise(selectApplicationMutationAdmission(
      active.selection, "users:create", { deploymentId: currency.deploymentId,
        controlDb: currency.control.drizzle, authority: application.authorityPorts,
        schema: application.schema }));
    const activationInput = await applicationMutationActivationFixture({ deploymentId: currency.deploymentId,
      selection: active.selection, executionAuthority: applicationAdmission.executionAuthority,
      requestKey: `mixed-product-${input.suffix}`, grantId: `mixed-product-${input.suffix}-grant` });
    const activation = await Effect.runPromise(createApplicationMutationSessionActivationPersistenceV1(
      application.sessionAuthority, { leaseDurationMilliseconds: 60_000 }).activateEffect(
      activationInput));
    if (activation.status !== "created") throw new Error("Expected fresh mixed attempt");
    const eventGroup = admittedCommerceEventGroup({
      scopeUuid: projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid,
      sessionId: activation.anchor.sessionId, attemptFence: activation.anchor.attemptFence,
    });
    const prepared = await Effect.runPromise(prepareLogicalRelationalAdmission({
      controlDb: currency.control.drizzle, authority: application.authorityPorts,
    }, application.uniqueConstraintEligibility, { deploymentId: currency.deploymentId,
      scopeId: application.authority.scopeId, schemaVersionId: logicalSchemaVersionId },
    product.hostInput.logicalStorage.source));
    const binding = await Effect.runPromise(preparePrivateProductAttempt());
    const revision = createHash("sha256").update("mixed-product-workerd-events").digest("hex");
    const eventPolicy = await Effect.runPromise(preparePrivateProductAttemptEventPolicy(binding, {
      producerRevision: revision, contractRevision: revision,
      subscribers: [{ id: "mixed-product-proof", revision }],
    }));
    const store = createSessionJournalStorePersistenceV1(application.sessionAuthority,
      { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        indexedQueries: application.indexedQueries });
    const executionClaims = createPointMutationExecutionClaimVaultV1();
    const pgTarget = currency.resource.kind === "postgres"
      ? Object.freeze({ control: currency.resource.control,
        applicationName: (await currency.resource.target.query<{ applicationName: string }>(
          'select current_setting(\'application_name\') as "applicationName"')).rows[0]?.applicationName })
      : undefined;
    if (pgTarget !== undefined && !pgTarget.applicationName)
      throw new Error("Missing target PostgreSQL application_name");
    const hasSqlObserver = currency.observeSql !== undefined;
    let sqlPhase = "prepare";
    const sqlByPhase = new Map<string, number>();
    let openTransactionDepth = 0;
    let beginCount = 0, settleCount = 0;
    currency.observeSql?.(sql => {
      sqlByPhase.set(sqlPhase, (sqlByPhase.get(sqlPhase) ?? 0) + 1);
      if (/^\s*begin\b/i.test(sql)) { openTransactionDepth += 1; beginCount += 1; }
      if (/^\s*(commit|rollback)\b/i.test(sql)) { openTransactionDepth -= 1; settleCount += 1; }
    });
    const serviceTransactionDepth: number[] = [];
    const pgTransactionObservations: Array<Readonly<{
      targetBackends: number; openTransactions: number;
    }>> = [];
    const nativeInvokeCount = new Map<string, number>();
    const retryContexts: Array<PointMutationOccRuntimeNeutralRunnerInputV1["context"]> = [];
    const journal = createPointMutationJournalV1(store, executionClaims.admission,
      issueSetupSeededSyscallValidatorProofV1({ scopeId: application.authority.scopeId,
        schemaVersionId, schemaManifest: applicationAdmission.schema.manifest }), {
        participant: "medusa.product",
        admission: { selection: prepared, application: active.selection,
          methods: ["update", "retrieve", "listByHandle"] },
        invoke: (borrowed, method, args) => Effect.gen(function* () {
          if (pgTarget !== undefined) {
            const reading = yield* Effect.tryPromise({
              try: () => pgTarget.control.query<{ targetBackends: number; openTransactions: number }>(
                `select count(*)::int as "targetBackends",
                        count(*) filter (where xact_start is not null)::int as "openTransactions"
                   from pg_stat_activity
                  where datname = current_database() and usename = current_user
                    and application_name = $1 and pid <> pg_backend_pid()`,
                [pgTarget.applicationName]),
              catch: cause => commerceError("resourceFailure", cause),
            });
            const observed = reading.rows[0];
            if (observed === undefined || observed.targetBackends < 1 ||
              observed.openTransactions !== 0)
              return yield* Effect.fail(commerceError("resourceFailure",
                new Error(`Product native callback overlapped target SQL transaction: ${JSON.stringify(observed)}`)));
            pgTransactionObservations.push(Object.freeze(observed));
          }
          serviceTransactionDepth.push(openTransactionDepth);
          nativeInvokeCount.set(method, (nativeInvokeCount.get(method) ?? 0) + 1);
          yield* input.hooks?.beforeNative?.(method) ?? Effect.void;
          const completed = yield* executePrivateProductAttemptOperation(binding, borrowed, method, args,
            eventPolicy);
          yield* input.hooks?.afterNativeBeforeAck?.(method, completed.result) ?? Effect.void;
          return completed;
        }),
      });
    const rawSelector = Object.freeze({
      deploymentId: String(activation.anchor.deploymentId),
      scopeId: String(activation.anchor.scopeId),
      sessionId: String(activation.anchor.sessionId),
      attemptFence: String(activation.anchor.attemptFence),
    });
    const selector = decodePointMutationSessionAttemptSelectorV1(rawSelector);
    const loaded = await Effect.runPromise(createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(application.sessionAuthority)).load(rawSelector));
    const claim = executionClaims.issuer.mint({ selector, observation: activation.executionClaim,
      mode: "execute" });
    const execution = Result.getOrThrow(executionClaims.admission.admit(claim, "execute"));
    const attempt = await Effect.runPromise(journal.openAttempt(loaded, execution));
    const bound = bindPointMutationOccJournal(journal, attempt);
    const runAdmitted = bound.runAdmittedOperation;
    if (runAdmitted === undefined) throw new Error("Missing bound admitted participant");
    let updateRequest: Parameters<typeof runAdmitted>[0] | undefined;
    const bridgeFailures: string[] = [];
    const makeBridge = (runtimeJournal: PointMutationOccBoundJournalV1) => {
      const tableHandles = new Map<string, Effect.Success<ReturnType<typeof bound.resolvePointTable>>>();
      return async (request: Request): Promise<Response> => {
      try {
        const message = await request.json() as Readonly<{ kind: string; tableName?: string;
          sequence?: string; operation?: Record<string, unknown>; frame?: unknown }>;
        let value: unknown;
        if (message.kind === "point") {
          sqlPhase = "application";
          if (typeof message.tableName !== "string" || message.operation === undefined ||
            typeof message.operation.syscallSequence !== "string") throw new Error("Invalid point bridge request");
          let table = tableHandles.get(message.tableName);
          if (table === undefined) {
            table = await Effect.runPromise(runtimeJournal.resolvePointTable(message.tableName));
            tableHandles.set(message.tableName, table);
          }
          const result = await Effect.runPromise(runtimeJournal.runPointOperation(table, {
            ...message.operation,
            syscallSequence: CommitSyscallSequenceV1Schema.make(
              BigInt(message.operation.syscallSequence)),
          }));
          if (result.kind !== "completed") throw new Error(`Point operation ${result.kind}`);
          value = result.outcome;
        } else if (message.kind === "admitted") {
          if (typeof message.sequence !== "string") throw new Error("Invalid admitted sequence");
          const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result(message.frame));
          sqlPhase = `product:${encoded.operation.operation}`;
          const admittedInput = {
            syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(message.sequence)),
            operation: encoded.operation, requestBytes: encoded.bytes,
            requestSha256: createHash("sha256").update(encoded.bytes).digest(),
          };
          if (encoded.operation.operation === "update") updateRequest = admittedInput;
          const runtimeAdmitted = runtimeJournal.runAdmittedOperation;
          if (runtimeAdmitted === undefined) throw new Error("Missing runtime admitted participant");
          const admittedValue = await Effect.runPromise(runtimeAdmitted(admittedInput));
          value = admittedValue;
          input.hooks?.afterStoreAckBeforeBridgeReply?.(encoded.operation.operation, admittedValue);
        } else throw new Error("Unsupported bridge request");
        return Response.json({ ok: true, value });
      } catch (cause) {
        bridgeFailures.push(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
        return Response.json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) },
          { status: 500 });
      }
    };
    };
  async function runWorkerd(source?: string,
    runnerInput?: PointMutationOccRuntimeNeutralRunnerInputV1): Promise<unknown> {
    const bridge = makeBridge(runnerInput?.journal ?? bound);
    const executionTime = runnerInput?.context.executionTime ?? Date.UTC(2026, 6, 24);
    const argumentsJson = runnerInput?.argumentsJson ?? activationInput.evidence.validatedArgsJson;
    const normalizedArguments = normalizeFlarexValueV1(argumentsJson);
    const runtimeTarget = applicationAdmission.executionAuthority.authority.runtimeTarget;
    const executionModule = runtimeTarget.executionModulePath;
    const request = JSON.stringify({ format: "flarex.point-mutation-exact-runtime", version: 1,
      artifact: { runtime: "dynamic-worker", artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourcePackageHash: "a".repeat(64), executionModule },
      function: { path: runtimeTarget.function.path, executionModule,
        kind: runtimeTarget.function.kind, visibility: runtimeTarget.function.visibility,
        argsValidator: runtimeTarget.function.args, returnsValidator: runtimeTarget.function.returns },
      auth: { kind: "anonymous" }, arguments: argumentsJson,
      argumentArraySemanticBytes: runnerInput?.argumentArraySemanticBytes ??
        requirePointMutationArgumentSemanticSizeV1(normalizedArguments.semanticSizeBytes),
      tables: runnerInput?.stableBindings.map(binding => ({ tableId: binding.tableId,
        logicalName: binding.logicalName })) ?? [{ tableId: 1, logicalName: "users" }],
      context: { executionId: runnerInput?.context.executionId ?? "mixed-product-1",
        logScopeId: runnerInput?.context.logScopeId ?? "mixed-product-log-1",
        randomSeed: Array.from(runnerInput?.context.randomSeed ?? new Uint8Array(32).fill(5)),
        executionTime, initialCreationTimeCursor:
          runnerInput?.context.initialCreationTimeCursor ?? executionTime },
    });
    const applicationSource = source ?? `export default { users: { create: { isMutation: true,
      isPublic: true, _handler: async (ctx) => {
        const id = await ctx.db.insert("users", { name: "before" });
        const updated = await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(seed.updateInput)});
        const pending = await ctx.privateMixed.call("medusa.product", "retrieve", ${JSON.stringify(seed.retrieveInput)});
        const listed = await ctx.privateMixed.call("medusa.product", "listByHandle", ${JSON.stringify(seed.listInput)});
        await ctx.db.patch(id, { name: pending.title });
        return { id, updated, pending, listed };
      },
    } } };`;
    const platformSource = applicationErrorPlatformSourceV1({
      runtimeKernelModulePath: `../${POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1}`,
      captureExportName: "capturePointMutationCoreApplicationErrorDataV1",
      captureProjectionExportName: "captureCoreApplicationErrorV1",
      invalid: { kind: "nativeError" },
    });
    const worker = new Miniflare({ compatibilityDate: "2026-06-18",
      serviceBindings: { MIXED_JOURNAL: bridge }, modules: [
        { type: "ESModule", path: "worker.js", contents: `${POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default { async fetch(_request, env) {
  const invoke = async (kind, payload) => {
    const response = await env.MIXED_JOURNAL.fetch("https://mixed-journal.test/", {
      method: "POST", body: JSON.stringify({ kind, ...payload }),
    });
    const answer = await response.json();
    if (!answer.ok) throw new Error(answer.error);
    return answer.value;
  };
  const journal = {
    resolvePointTable(tableName) { return {
      runPointOperation: operation => invoke("point", { tableName,
        operation: { ...operation, syscallSequence: String(operation.syscallSequence) } }),
    }; },
    runAdmittedFrameworkOperation: (sequence, frame) =>
      invoke("admitted", { sequence: String(sequence), frame }),
  };
  const input = ${request};
  input.context.randomSeed = new Uint8Array(input.context.randomSeed);
  try {
    const result = await Reflect.apply(FlarexPointMutationExactRuntimeV1.prototype.runPrivateMixed,
      {}, [input, journal]);
    return Response.json({ kind: "result", result });
  } catch (cause) {
    return Response.json({ kind: "error", name: cause?.name, message: cause?.message,
      cause: cause?.cause?.message });
  }
} };` },
        { type: "ESModule", path: POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
          contents: pointMutationExactRuntimeWorkerConfigurationSource({
            executionModule, moduleTime: executionTime,
            moduleRandomSeedHex: "a".repeat(64) }) },
        { type: "ESModule", path: POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
          contents: pointMutationExactRuntimeWorkerExecutionBridgeSource(executionModule) },
        { type: "ESModule", path: POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
          contents: POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1 },
        { type: "ESModule", path: FUNCTION_API_CORE_MODULE_V1,
          contents: FUNCTION_API_CORE_SOURCE_V1 },
        { type: "ESModule", path: APPLICATION_ERROR_PLATFORM_MODULE_V1,
          contents: platformSource },
        { type: "ESModule", path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
          contents: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1 },
        { type: "ESModule", path: executionModule, contents: applicationSource },
      ] });
    let workerd: unknown;
    try {
      const response = await worker.dispatchFetch("https://mixed-product.test/");
      workerd = await response.json();
    } finally { await worker.dispose(); }
    if (typeof workerd === "object" && workerd !== null && "kind" in workerd &&
      workerd.kind === "error") throw new Error(`Native Worker failed: ${JSON.stringify(workerd)}\n${bridgeFailures.join("\n")}`);
    return workerd;
  }
  const participantAuthority = prepared.createCommitAuthority(active.selection,
    "medusa.product", ["update", "retrieve", "listByHandle"]);
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(application.control.drizzle);
  const uniqueConstraintEligibility = createAppUniqueConstraintSetEligibilityPortV1({
    controlDb: application.control.drizzle, authority: application.authorityPorts,
  }, uniqueConstraints);
  const publisherOptions = Object.freeze({
    developerIndexes: application.developerIndexes,
    intrinsicCreationTimeIndexes: application.intrinsicCreationTimeIndexes,
    uniqueConstraints,
    uniqueConstraintEligibility,
    applicationRelations: application.applicationRelations,
    candidateSchemaWriteGuard: application.candidateSchemaWriteGuard,
    logicalParticipants: [participantAuthority],
    logicalParticipantEvents: [{ authority: participantAuthority,
      policy: eventPolicy.policy, selection: eventPolicy.selection }],
  });
  let publication: Readonly<{
    executor: ReturnType<typeof createStoredPointCommitExecutorV1>;
    finishing: Effect.Success<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["enterPointCommitFinishing"]>>;
  }> | undefined;
  let retryExecutor: ReturnType<typeof createStoredPointMutationOccRerunExecutionV1> | undefined;
  let retryContextOrdinal = 0;
  const retryRunner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
    run: (runnerInput: PointMutationOccRuntimeNeutralRunnerInputV1) =>
      runnerInput.executionAuthorityGeneration !== "application_v1"
      ? Effect.fail(new ApplicationPointMutationRunnerHostV1Error({ reason: "requestProjectionInvalid" }))
      : Effect.tryPromise({
        try: async () => {
          retryContexts.push(Object.freeze({ ...runnerInput.context,
            randomSeed: new Uint8Array(runnerInput.context.randomSeed),
            snapshotToken: Object.freeze({ ...runnerInput.context.snapshotToken }) }));
          const raw = await runWorkerd(undefined, runnerInput);
          const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
            result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
          return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
            success.result.result))).value;
        },
        catch: cause => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause }),
      }),
  });
  async function preparePublicationInternal(returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride: ReturnType<typeof createPointCommitPublisherPortV1> | undefined,
    withOccRetry: boolean) {
    sqlPhase = "seal";
    const envelope = await Effect.runPromise(journal.sealSuccessfulResult(attempt, returnedValue));
    const publisher = publisherOverride ?? createPointCommitPublisherPortV1(
      application.sessionAuthority, publisherOptions);
    const loader = createStoredAttemptEvidenceLoaderV1(application.sessionAuthority);
    const attemptLoading = createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(application.sessionAuthority));
    const common = {
      evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(application.sessionAuthority),
      applicationMutationGrantVerifier: createApplicationMutationGrantVerificationKernelV1({
        deploymentId: activationInput.deploymentId,
        keys: [activationInput.verificationKey],
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      }),
      logicalParticipants: [participantAuthority],
      pointCommit: publisher,
      pointCommitFinishing: createPointCommitFinishingTransitionPortV1(application.sessionAuthority),
    } as const;
    const occExecutor = withOccRetry
      ? createStoredPointMutationOccRerunExecutionV1(loader, {
        ...common,
        pointMutationAttemptReplacement: createPointMutationAttemptReplacementPortV1(
          application.sessionAuthority, { leaseDurationMilliseconds: 60_000 }),
        pointMutationOccRerun: {
          attemptLoading,
          executionEvidence: createStoredOccExecutionEvidenceLoaderV1(application.sessionAuthority),
          journal,
          terminalization: createPointMutationSessionAttemptTerminalizationV1(
            createPointMutationSessionAttemptTerminalizationPersistenceV1(application.sessionAuthority),
            executionClaims.admission),
          contextFactory: { make: () => Effect.sync(() => {
            retryContextOrdinal += 1;
            return Object.freeze({ executionId: `mixed-product-retry-${retryContextOrdinal}`,
              logScopeId: `mixed-product-retry-log-${retryContextOrdinal}`,
              randomSeed: new Uint8Array(32).fill(5 + retryContextOrdinal) });
          }) },
          runner: retryRunner,
          liveness: createPointMutationExecutionClaimLivenessV1(application.sessionAuthority, {
            claimDurationMilliseconds: 60_000,
            leaseRenewalDurationMilliseconds: 120_000,
            grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
          }),
          heartbeatIntervalMilliseconds: 20_000,
        },
      }, executionClaims)
      : undefined;
    if (occExecutor !== undefined) retryExecutor = occExecutor;
    const executor = occExecutor ?? createStoredPointCommitExecutorV1(loader, common, executionClaims);
    const loadedForCommit = await Effect.runPromise(createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(application.sessionAuthority)).load(rawSelector));
    const authority = await Effect.runPromise(executor.deriveAuthority(loadedForCommit, execution));
    const stored = await Effect.runPromise(executor.authenticate(authority,
      Schema.encodeSync(CommitEnvelopeV1Schema)(envelope)));
    const authenticated = await Effect.runPromise(executor.authenticateCommitAuthority(stored));
    const verified = await Effect.runPromise(executor.verifyCommitInput(authenticated));
    const planned = await Effect.runPromise(executor.planPointCommit(verified));
    sqlPhase = "finish";
    const finishing = await Effect.runPromise(executor.enterPointCommitFinishing(planned));
    publication = Object.freeze({ executor, finishing });
    sqlPhase = "publish";
    return executor.publishPointCommit(finishing);
  }
  async function preparePublication(returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) {
    return preparePublicationInternal(returnedValue, publisherOverride, false);
  }
  async function prepareOccPublication(returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1]) {
    return preparePublicationInternal(returnedValue, undefined, true);
  }
  async function retryWholeAttempt(conflict: unknown) {
    if (retryExecutor === undefined) throw new Error("Missing OCC retry owner");
    const authorized = await Effect.runPromise(retryExecutor.authorizePointMutationOccRerun(conflict));
    if (authorized.kind !== "authorized") throw new Error(`Unexpected OCC retry disposition: ${authorized.kind}`);
    return Effect.runPromise(retryExecutor.executeAuthorizedPointMutationOccRerun(authorized.rerun));
  }
  async function publish(returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) {
    return Effect.runPromise(await preparePublication(returnedValue, publisherOverride));
  }
  async function replayPublication() {
    if (publication === undefined) throw new Error("Missing authenticated finishing publication");
    sqlPhase = "publish-replay";
    return Effect.runPromise(publication.executor.publishPointCommit(publication.finishing));
  }
  async function readCurrentProduct(): Promise<Json> {
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.retrieve] }));
    try {
      const current = await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: seed.productId, config: { relations: ["options.values", "tags",
          "variants.options", "images", "categories"] },
      }));
      if (!isJsonObject(current)) throw new Error("Expected native Product document");
      return current;
    } finally { await Effect.runPromise(read.close); }
  }
  return { currency, product, seed, baseline, application, active, activation, prepared, binding,
    schemaVersionId, logicalSchemaVersionId,
    eventPolicy, eventGroup, store, executionClaims, journal, attempt, bound, runAdmitted, selector,
    serviceTransactionDepth, pgTransactionObservations, nativeInvokeCount, retryContexts, sqlByPhase,
    hasSqlObserver, bridgeFailures, runWorkerd,
    participantAuthority, publisherOptions, pointCommitPorts: application.sessionAuthority,
    makePublisher: () => createPointCommitPublisherPortV1(application.sessionAuthority, publisherOptions),
    preparePublication, publish, replayPublication, prepareOccPublication, retryWholeAttempt,
    runStandaloneProductUpdate: next => runNativeStandaloneProductUpdate(currency, product,
      `conflict-${input.suffix}`, { ...seed.updateInput,
        data: { ...seed.updateInput.data, title: next.title, handle: next.handle } }),
    readCurrentProduct,
    getUpdateRequest: () => updateRequest,
    getOpenTransactionDepth: () => openTransactionDepth,
    getTransactionCounts: () => ({ beginCount, settleCount }),
    setSqlPhase: (phase: string) => { sqlPhase = phase; },
    close: async () => { currency.observeSql?.(undefined); for (const close of cleanup.reverse()) await close(); },
  };
}
