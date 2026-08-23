import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import {
  createApplicationMutationGrantVerificationKernelV1,
} from
  "@flarex/executor/internal/application-mutation-grant-verification-kernel";
import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "@flarex/executor/transaction-grant";
import {
  createApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationPersistence,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { selectApplicationMutationAdmission } from
  "@flarex/persistence-postgres/internal/application-mutation-admission";
import {
  ApplicationMutationSystemConfigurationError,
  ApplicationMutationSystem,
  type ApplicationMutationSystemLive,
  makeApplicationMutationSystemLayer,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  invokeStandardApplicationPointMutationV1,
} from "@flarex/standard-application-invocation/v1";
import { Effect, Result, Scope } from "effect";
import {
  APPLICATION_RUNTIME_HOST_IDENTITY,
} from "flarex-backend/artifact-runtime";
import type { ApplicationAnalysisSourceBundle } from
  "flarex-backend/internal/application-analysis-source-reader";
import {
  makeApplicationExecutionHost,
} from "flarex-backend/internal/application-execution-host";
import {
  makeApplicationMutationGrantIssuer,
} from "flarex-backend/internal/application-mutation-grant-issuer";
import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  type ApplicationMutationGrantVerificationKeyV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  encodeEdgeActionHostPolicyV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  APPLICATION_WORKER_RESULT_FORMAT_V1,
  APPLICATION_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/application-worker-v1";
import { makeGrantRetentionPolicyV1Result } from
  "flarex-protocol/grant-retention-policy";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationGrantIdV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

const COMPATIBILITY_DATE = "2026-06-14";
const RETENTION = Result.getOrThrow(makeGrantRetentionPolicyV1Result({
  maximumGrantLifetimeMilliseconds: 120_000,
  maximumFutureIssuedAtSkewMilliseconds: 30_000,
  maximumLiveSnapshotRetentionMilliseconds: 600_000,
}));

export interface ApplicationNativeMutationProof {
  readonly published: true;
  readonly exactReplay: true;
  readonly conflictingReuseRejected: true;
  readonly validationCaught: true;
  readonly concurrentDuplicateInProgress: true;
  readonly concurrentDuplicateReplay: true;
  readonly occConflictReran: true;
  readonly staleHeadRejected: true;
  readonly admittedHeadStayedPinned: true;
  readonly terminalJournalFailureDidNotCommit: true;
  readonly terminalFailureDidNotCommit: true;
  readonly candidateSchemaWriteGuard: ApplicationNativeMutationCandidateSchemaWriteGuardObservation;
  readonly freshWorkerLoads: number;
  readonly commitCount: number;
  readonly outcomeCount: number;
  readonly feedCount: number;
  readonly outboxCount: number;
}

export type ApplicationNativeMutationConfigurationObservation =
  | { readonly disposition: "accepted" }
  | {
    readonly disposition: "rejected";
    readonly errorTag: "ApplicationMutationSystemConfigurationError";
    readonly reason: ApplicationMutationSystemConfigurationError["reason"];
  };

export interface ApplicationNativeMutationCandidateSchemaWriteGuardObservation {
  readonly exact: ApplicationNativeMutationConfigurationObservation;
  readonly copied: ApplicationNativeMutationConfigurationObservation;
  readonly foreignAuthority: ApplicationNativeMutationConfigurationObservation;
  readonly missing: ApplicationNativeMutationConfigurationObservation;
}

export type ApplicationNativeMutationFixtureFactory = () => Promise<
  ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>
>;

export async function proveApplicationNativeMutation(
  createFixture: ApplicationNativeMutationFixtureFactory = () =>
    createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
    }),
): Promise<
  ApplicationNativeMutationProof
> {
  const fixture = await createFixture();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    fixture.deploymentId,
  );
  const loader = new ApplicationNativeWorkerLoader();
  const live = await makeApplicationNativeMutationTestLive(fixture, loader);
  const layer = makeApplicationMutationSystemLayer(live);
  const candidateSchemaWriteGuard:
    ApplicationNativeMutationCandidateSchemaWriteGuardObservation = Object.freeze({
      exact: Object.freeze({ disposition: "accepted" }),
      copied: observeApplicationMutationConfiguration(() =>
        makeApplicationMutationSystemLayer(Object.freeze({
          ...live,
          candidateSchemaWriteGuard: Object.freeze({
            ...live.candidateSchemaWriteGuard,
          }),
        }))
      ),
      foreignAuthority: observeApplicationMutationConfiguration(() =>
        makeApplicationMutationSystemLayer(Object.freeze({
          ...live,
          sessionAuthority: Object.freeze({ ...live.sessionAuthority }),
        }))
      ),
      missing: observeApplicationMutationConfiguration(() => {
        const {
          candidateSchemaWriteGuard: _omittedCandidateSchemaWriteGuard,
          ...missingCandidateGuardLive
        } = live;
        // @ts-expect-error Deliberately exercise a missing required capability.
        makeApplicationMutationSystemLayer(missingCandidateGuardLive);
      }),
    });
  const invoke = <A, E>(effect: Effect.Effect<
    A,
    E,
    ApplicationMutationSystem | Scope.Scope
  >) => runSystemTestEffectV1(
    Effect.scoped(effect.pipe(Effect.provide(layer))),
  );
  const create = TransactionFunctionPathV1Schema.make("users:create");
  const firstKey = TransactionRequestKeyV1Schema.make(
    "application-native:create:1",
  );
  const published = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Ada" },
    firstKey,
  ));
  if (published.disposition !== "published" || typeof published.value !== "string") {
    throw new Error("Application-native mutation was not published.");
  }
  const loadsAfterPublish = loader.loads;
  const replayed = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Ada" },
    firstKey,
  ));
  if (
    replayed.disposition !== "replayed" ||
    replayed.commitSeq !== published.commitSeq ||
    loader.loads !== loadsAfterPublish
  ) throw new Error("Application-native replay re-executed the Worker.");
  let conflictingReuseRejected = false;
  try {
    await invoke(invokeStandardApplicationPointMutationV1(
      create,
      { name: "Different" },
      firstKey,
    ));
  } catch (cause) {
    conflictingReuseRejected = failureTag(cause) ===
      "CommittedPointOutcomeRequestKeyReuseErrorV1";
  }
  if (!conflictingReuseRejected) {
    throw new Error("Application-native mutation accepted conflicting replay.");
  }
  loader.mode = "catchValidation";
  const caught = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Grace" },
    TransactionRequestKeyV1Schema.make("application-native:create:2"),
  ));
  if (caught.disposition !== "published" || loader.caughtValidation !== 1) {
    throw new Error("Application validation failure was not catchable.");
  }

  const duplicateBlock = loader.blockNextInvocation();
  const duplicateKey = TransactionRequestKeyV1Schema.make(
    "application-native:create:duplicate",
  );
  const duplicateFirst = invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Concurrent" },
    duplicateKey,
  ));
  await duplicateBlock.started;
  let concurrentDuplicateInProgress = false;
  let duplicateFailure: unknown;
  try {
    await invoke(invokeStandardApplicationPointMutationV1(
      create,
      { name: "Concurrent" },
      duplicateKey,
    ));
  } catch (cause) {
    duplicateFailure = cause;
    concurrentDuplicateInProgress = failureTag(cause) ===
        "ApplicationMutationOutcomeUnavailableError" &&
      failureReason(cause) === "inProgress";
  }
  if (!concurrentDuplicateInProgress) {
    throw new Error(
      `Concurrent Application duplicate was not in progress: ${failureTag(duplicateFailure)}/${failureReason(duplicateFailure)}.`,
    );
  }
  const duplicateLoads = loader.loads;
  duplicateBlock.release();
  const duplicatePublished = await duplicateFirst;
  const duplicateReplay = await invoke(
    invokeStandardApplicationPointMutationV1(
      create,
      { name: "Concurrent" },
      duplicateKey,
    ),
  );
  const concurrentDuplicateReplay =
    duplicatePublished.disposition === "published" &&
    duplicateReplay.disposition === "replayed" &&
    duplicateReplay.commitSeq === duplicatePublished.commitSeq &&
    loader.loads === duplicateLoads;
  if (!concurrentDuplicateReplay) {
    throw new Error("Concurrent Application duplicate did not replay.");
  }

  const conflictBlock = loader.blockNextInvocation();
  loader.conflictDocumentId = published.value;
  loader.persistentConflictArgumentName = "Conflict winner";
  const conflictReceiptStart = loader.requestReceipts.length;
  const conflictKey = TransactionRequestKeyV1Schema.make(
    "application-native:create:conflict",
  );
  const conflictAttempt = invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Conflict winner" },
    conflictKey,
  ));
  await conflictBlock.started;
  const loadsBeforeCompetitor = loader.loads;
  loader.mode = "patchDocument";
  const competitor = await invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Competing commit" },
    TransactionRequestKeyV1Schema.make(
      "application-native:create:competitor",
    ),
  ));
  if (competitor.disposition !== "published") {
    throw new Error("Application OCC competitor did not publish.");
  }
  conflictBlock.release();
  const conflictPublished = await conflictAttempt;
  const conflictReceipts = loader.requestReceipts.slice(conflictReceiptStart)
    .filter(receipt => receipt.argumentName === "Conflict winner");
  const occConflictReran = conflictPublished.disposition === "published" &&
    loader.loads === loadsBeforeCompetitor + 2 &&
    loader.conflictReads === 2 &&
    conflictReceipts.length === 2 &&
    conflictReceipts.every(receipt =>
      receipt.revisionId === fixture.active.basis.revisionId
    );
  if (!occConflictReran) {
    throw new Error("Application OCC conflict did not rerun in a fresh Worker.");
  }

  const headBlock = loader.blockNextInvocation();
  const headLoadStart = loader.loads;
  const pinnedRevisionId = fixture.active.basis.revisionId;
  const headAttempt = invoke(invokeStandardApplicationPointMutationV1(
    create,
    { name: "Pinned before head movement" },
    TransactionRequestKeyV1Schema.make(
      "application-native:create:pinned-head",
    ),
  ));
  await headBlock.started;
  const moved = await fixture.moveHead();
  if (moved.basis.revisionId === pinnedRevisionId) {
    throw new Error("Application-native fixture did not move the active head.");
  }
  let staleHeadRejected = false;
  try {
    await runSystemTestEffectV1(selectApplicationMutationAdmission(
      fixture.active.selection,
      create,
      {
        deploymentId,
        controlDb: fixture.control.drizzle,
        schema: fixture.schema,
        authority: fixture.authorityPorts,
      },
    ));
  } catch (cause) {
    staleHeadRejected = failureTag(cause) === "ApplicationActivationError" &&
      failureReason(cause) === "concurrentHead";
  }
  if (!staleHeadRejected) {
    throw new Error("Application admission accepted the stale active head.");
  }
  headBlock.release();
  const pinnedOutcome = await headAttempt;
  const headRevisionIds = loader.revisionIds.slice(headLoadStart);
  const admittedHeadStayedPinned = pinnedOutcome.disposition === "published" &&
    headRevisionIds.length >= 1 &&
    headRevisionIds.every(revisionId => revisionId === pinnedRevisionId);
  if (!admittedHeadStayedPinned) {
    throw new Error("Admitted Application execution followed the mutable head.");
  }

  const beforeJournalFailure = await durableCounts(fixture.target);
  loader.mode = "catchTerminalJournalFailure";
  let terminalJournalFailed = false;
  try {
    await invoke(invokeStandardApplicationPointMutationV1(
      create,
      { name: "Caught terminal journal failure" },
      TransactionRequestKeyV1Schema.make(
        "application-native:create:terminal-journal",
      ),
    ));
  } catch {
    terminalJournalFailed = true;
  }
  const afterJournalFailure = await durableCounts(fixture.target);
  const terminalJournalFailureDidNotCommit = terminalJournalFailed &&
    JSON.stringify(afterJournalFailure) === JSON.stringify(beforeJournalFailure);
  if (!terminalJournalFailureDidNotCommit) {
    throw new Error("Caught terminal journal failure changed durable commit state.");
  }

  const beforeFailure = afterJournalFailure;
  loader.mode = "terminalFailure";
  let terminalFailed = false;
  try {
    await invoke(invokeStandardApplicationPointMutationV1(
      create,
      { name: "Must not commit" },
      TransactionRequestKeyV1Schema.make("application-native:create:3"),
    ));
  } catch {
    terminalFailed = true;
  }
  const afterFailure = await durableCounts(fixture.target);
  const terminalFailureDidNotCommit = terminalFailed &&
    JSON.stringify(afterFailure) === JSON.stringify(beforeFailure);
  if (!terminalFailureDidNotCommit) {
    throw new Error("Application terminal failure changed durable commit state.");
  }
  return Object.freeze({
    published: true,
    exactReplay: true,
    conflictingReuseRejected: true,
    validationCaught: true,
    concurrentDuplicateInProgress: true,
    concurrentDuplicateReplay: true,
    occConflictReran: true,
    staleHeadRejected: true,
    admittedHeadStayedPinned: true,
    terminalJournalFailureDidNotCommit: true,
    terminalFailureDidNotCommit: true,
    candidateSchemaWriteGuard,
    freshWorkerLoads: loader.loads,
    commitCount: afterFailure.commits,
    outcomeCount: afterFailure.outcomes,
    feedCount: afterFailure.feed,
    outboxCount: afterFailure.outbox,
  });
}

function observeApplicationMutationConfiguration(
  configure: () => unknown,
): ApplicationNativeMutationConfigurationObservation {
  try {
    configure();
    return Object.freeze({ disposition: "accepted" });
  } catch (cause: unknown) {
    if (!(cause instanceof ApplicationMutationSystemConfigurationError)) {
      throw cause;
    }
    return Object.freeze({
      disposition: "rejected",
      errorTag: cause._tag,
      reason: cause.reason,
    });
  }
}

export async function makeApplicationNativeMutationTestLayer(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  loader: WorkerLoader,
  options: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
  }> = {},
) {
  return makeApplicationMutationSystemLayer(
    await makeApplicationNativeMutationTestLive(fixture, loader, options),
  );
}

async function makeApplicationNativeMutationTestLive(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  loader: WorkerLoader,
  options: Readonly<{
    readonly source?: ApplicationMutationSystemLive["applicationRunner"]["source"];
    readonly onExecution?: () => void;
    readonly afterRuntime?: () => Effect.Effect<void, never>;
  }> = {},
): Promise<ApplicationMutationSystemLive> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    fixture.deploymentId,
  );
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    false,
    ["sign", "verify"],
  );
  if (!("privateKey" in keyPair) || !("publicKey" in keyPair)) {
    throw new Error("Application-native proof requires an Ed25519 key pair.");
  }
  const now = Date.now();
  const applicationKeyId = TransactionGrantKeyIdV1Schema.make(
    "application-native-mutation-key",
  );
  const applicationKey = Object.freeze({
    kid: applicationKeyId,
    purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
    state: "active",
    issuedAtInclusiveEpochMilliseconds: now - 60_000,
    verificationEndsAtExclusiveEpochMilliseconds: now + 3_600_000,
    publicKey: keyPair.publicKey,
  }) satisfies ApplicationMutationGrantVerificationKeyV1;
  let grantSequence = 0;
  const grantIssuer = makeApplicationMutationGrantIssuer({
    deploymentId,
    grantRetentionPolicy: RETENTION,
    signer: {
      ...applicationKey,
      sign: bytes => Effect.promise(async () => new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          keyPair.privateKey,
          copyBytesToArrayBuffer(bytes),
        ),
      )),
    },
    runtime: {
      currentTimeMillis: Effect.sync(Date.now),
      nextGrantId: Effect.sync(() => {
        grantSequence += 1;
        return TransactionAuthorizationGrantIdV1Schema.make(
          `application-native-grant-${grantSequence}`,
        );
      }),
    },
  });
  const applicationGrantVerifier =
    createApplicationMutationGrantVerificationKernelV1({
      deploymentId,
      grantRetentionPolicy: RETENTION,
      keys: [applicationKey],
    });
  const legacyGrantVerifier = createTransactionGrantVerifierV1({
    clock: { now: () => new Date() },
    verificationKeyNamespace:
      createTransactionGrantVerificationKeyNamespaceV1({
        deploymentId,
        keys: [{
          state: "active",
          kid: TransactionGrantKeyIdV1Schema.make(
            "application-native-retained-legacy-key",
          ),
          purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
          issuedAtInclusiveEpochMilliseconds: now - 60_000,
          verificationEndsAtExclusiveEpochMilliseconds: now + 3_600_000,
          verify: async () => false,
        }],
      }),
    grantRetentionPolicy: RETENTION,
  });
  const hostPolicy = applicationHostPolicy();
  const policyBytes = Result.getOrThrow(encodeEdgeActionHostPolicyV1(
    hostPolicy,
    {
      maximumOrigins: 1_024,
      maximumOriginBytes: 8_192,
      maximumCanonicalBytes: 1_048_576,
    },
  )).canonicalBytes;
  const hostPolicySha256 = await sha256(policyBytes);
  const baseHost = makeApplicationExecutionHost(loader);
  const afterRuntime = options.afterRuntime;
  const host: ApplicationMutationSystemLive["applicationRunner"]["host"] =
    afterRuntime === undefined
      ? baseHost
      : Object.freeze({
        runTransaction: (
          input: Parameters<typeof baseHost.runTransaction>[0],
        ) => baseHost.runTransaction(input).pipe(
          Effect.ensuring(afterRuntime()),
        ),
        runAction: baseHost.runAction,
      });
  let uuidSequence = 0;
  let executionSequence = 0;
  return Object.freeze({
    deploymentId,
    activation: fixture.activation,
    admission: {
      deploymentId,
      controlDb: fixture.control.drizzle,
      schema: fixture.schema,
      authority: fixture.authorityPorts,
    },
    currentEpochAuthority: fixture.currentEpochAuthority,
    grantIssuer,
    applicationGrantVerifier,
    legacyGrantVerifier,
    legacyFunctionMetadata: {
      load: () => Effect.die("Application authority must not load legacy metadata."),
    },
    sessionAuthority: fixture.sessionAuthority,
    candidateSchemaWriteGuard: fixture.candidateSchemaWriteGuard,
    intrinsicCreationTimeIndexes: fixture.intrinsicCreationTimeIndexes,
    developerIndexes: fixture.developerIndexes,
    indexedQueries: fixture.indexedQueries,
    grantRetentionPolicy: RETENTION,
    applicationRunner: {
      source: options.source ?? Object.freeze({
        read: (rootSha256: string) => rootSha256 ===
            fixture.source.sourceArtifact.rootSha256
          ? Effect.succeed(
            fixture.source satisfies ApplicationAnalysisSourceBundle,
          )
          : Effect.die("Application-native proof requested the wrong source root."),
      }),
      host,
      hostPolicy,
      hostPolicySha256,
      sha256: (bytes: Uint8Array) => Effect.promise(() => sha256(bytes)),
    },
    randomUuid: () => {
      uuidSequence += 1;
      return `35000000-0000-4000-8000-${uuidSequence.toString().padStart(12, "0")}`;
    },
    executionContextFactory: {
      make: () => Effect.sync(() => {
        executionSequence += 1;
        options.onExecution?.();
        return Object.freeze({
          executionId: `application-native-execution-${executionSequence}`,
          logScopeId: `application-native-log-${executionSequence}`,
          randomSeed: new Uint8Array(32).fill(executionSequence),
        });
      }),
    },
    leaseDurationMilliseconds: 600_000,
    claimDurationMilliseconds: 600_000,
    leaseRenewalDurationMilliseconds: 600_000,
    heartbeatIntervalMilliseconds: 200_000,
  } satisfies ApplicationMutationSystemLive);
}

type ApplicationJournalCapability = Readonly<{
  readPointDocument: (table: string, documentId: string) => Promise<unknown>;
  insertPointDocument: (table: string, value: unknown) => Promise<unknown>;
  patchPointDocument: (documentId: string, value: unknown) => Promise<void>;
}>;

class ApplicationNativeWorkerLoader implements WorkerLoader {
  loads = 0;
  caughtValidation = 0;
  mode:
    | "success"
    | "catchValidation"
    | "catchTerminalJournalFailure"
    | "terminalFailure"
    | "readThenInsert"
    | "patchDocument" = "success";
  conflictDocumentId: string | undefined;
  persistentConflictArgumentName: string | undefined;
  conflictReads = 0;
  readonly revisionIds: string[] = [];
  readonly requestReceipts: Array<Readonly<{
    readonly argumentName: string;
    readonly revisionId: string;
  }>> = [];
  private nextBlock: InvocationBlock | undefined;

  blockNextInvocation(): Readonly<{
    readonly started: Promise<void>;
    readonly release: () => void;
  }> {
    if (this.nextBlock !== undefined) {
      throw new Error("Application-native Worker block is already armed.");
    }
    const started = deferred<void>();
    const released = deferred<void>();
    this.nextBlock = Object.freeze({ started, released });
    return Object.freeze({
      started: started.promise,
      release: () => released.resolve(undefined),
    });
  }

  takeBlock(): InvocationBlock | undefined {
    const block = this.nextBlock;
    this.nextBlock = undefined;
    return block;
  }

  get(): WorkerStub {
    throw new Error("Application-native proof forbids cached Worker loading.");
  }

  load(): WorkerStub {
    this.loads += 1;
    return new ApplicationNativeWorkerStub(this);
  }
}

class ApplicationNativeWorkerStub implements WorkerStub {
  constructor(private readonly owner: ApplicationNativeWorkerLoader) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    const owner = this.owner;
    return {
      run: async (request: unknown, capability: unknown) => {
        const argumentName = readArgumentName(request);
        const revisionId = readTargetRevisionId(request);
        const mode = argumentName === owner.persistentConflictArgumentName
          ? "readThenInsert"
          : owner.mode;
        if (argumentName !== owner.persistentConflictArgumentName) {
          owner.mode = "success";
        }
        owner.revisionIds.push(revisionId);
        owner.requestReceipts.push(Object.freeze({ argumentName, revisionId }));
        const journal = requireJournalCapability(capability);
        const conflictDocumentId = owner.conflictDocumentId;
        if (mode === "readThenInsert") {
          if (conflictDocumentId === undefined) {
            throw new Error("Application OCC proof has no conflict document.");
          }
          await journal.readPointDocument("users", conflictDocumentId);
          owner.conflictReads += 1;
        }
        const block = owner.takeBlock();
        if (block !== undefined) {
          block.started.resolve(undefined);
          await block.released.promise;
        }
        if (mode === "terminalFailure") {
          throw Object.assign(new Error("application terminal failure"), {
            name: "ApplicationWorkerUserCodeV1Error",
          });
        }
        const name = argumentName;
        if (mode === "catchValidation") {
          try {
            await journal.insertPointDocument("users", { name: 42 });
          } catch {
            owner.caughtValidation += 1;
          }
        }
        if (mode === "catchTerminalJournalFailure") {
          try {
            await journal.insertPointDocument("missing_table", { name });
          } catch {
            return rpcResult("application caught terminal journal failure");
          }
          throw new Error("Application journal unexpectedly accepted an unknown table.");
        }
        if (mode === "patchDocument") {
          if (conflictDocumentId === undefined) {
            throw new Error("Application OCC competitor has no document.");
          }
          await journal.patchPointDocument(conflictDocumentId, { name });
          return rpcResult(conflictDocumentId);
        }
        const documentId = await journal.insertPointDocument("users", { name });
        return rpcResult(documentId);
      },
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application-native proof does not load Durable Objects.");
  }
}

function requireJournalCapability(value: unknown): ApplicationJournalCapability {
  if (value === null || typeof value !== "object") {
    throw new Error("Application-native Worker received no journal capability.");
  }
  const method = Reflect.get(value, "insertPointDocument");
  const read = Reflect.get(value, "readPointDocument");
  const patch = Reflect.get(value, "patchPointDocument");
  if (
    typeof method !== "function" ||
    typeof read !== "function" ||
    typeof patch !== "function"
  ) {
    throw new Error("Application-native Worker received an invalid journal capability.");
  }
  return Object.freeze({
    readPointDocument: (table, documentId) => Reflect.apply(
      read,
      value,
      [table, documentId],
    ) as Promise<unknown>,
    insertPointDocument: (table, document) => Reflect.apply(
      method,
      value,
      [table, document],
    ) as Promise<unknown>,
    patchPointDocument: (documentId, document) => Reflect.apply(
      patch,
      value,
      [documentId, document],
    ) as Promise<void>,
  });
}

function rpcResult(value: unknown): object {
  const result = {
    format: APPLICATION_WORKER_RESULT_FORMAT_V1,
    version: APPLICATION_WORKER_RESULT_VERSION_V1,
    value,
  };
  Object.defineProperty(result, Symbol.dispose, { value: () => undefined });
  return result;
}

function readArgumentName(request: unknown): string {
  if (request === null || typeof request !== "object") {
    throw new Error("Application-native Worker received an invalid request.");
  }
  const argumentsValue = Reflect.get(request, "arguments");
  if (argumentsValue === null || typeof argumentsValue !== "object") {
    throw new Error("Application-native Worker received invalid arguments.");
  }
  const name = Reflect.get(argumentsValue, "name");
  if (typeof name !== "string") {
    throw new Error("Application-native Worker received no name.");
  }
  return name;
}

function readTargetRevisionId(request: unknown): string {
  if (request === null || typeof request !== "object") {
    throw new Error("Application-native Worker received an invalid request.");
  }
  const target = Reflect.get(request, "target");
  if (target === null || typeof target !== "object") {
    throw new Error("Application-native Worker received no runtime target.");
  }
  const revisionId = Reflect.get(target, "revisionId");
  if (typeof revisionId !== "string") {
    throw new Error("Application-native Worker received no revision identity.");
  }
  return revisionId;
}

function applicationHostPolicy() {
  return Object.freeze({
    identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
    callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
    allowedOrigins: Object.freeze([]),
    cpuMilliseconds: 1_000,
    wallMilliseconds: 30_000,
    maximumSyscalls: 64,
    maximumOutboundRequests: 16,
    maximumConcurrentOutboundRequests: 4,
    maximumWorkerSubrequests: 64,
    maximumArgumentBytes: 1_048_576,
    maximumResultBytes: 1_048_576,
    maximumCallbackArgumentBytes: 1_048_576,
    maximumCallbackResultBytes: 1_048_576,
    maximumUrlBytes: 8_192,
    maximumMethodBytes: 32,
    maximumHeaderCount: 128,
    maximumHeaderBytes: 65_536,
    maximumStatusTextBytes: 1_024,
    maximumOutboundRequestBodyBytes: 1_048_576,
    maximumOutboundResponseBodyBytes: 8_388_608,
    maximumCumulativeOutboundBodyBytes: 16_777_216,
    cleanupDrainMilliseconds: 5_000,
    allowRunQuery: true,
    allowRunMutation: true,
    allowRunAction: false,
    allowRedirects: false,
    allowStreaming: false,
    allowAmbientCredentials: false,
    fixedInvocationTime: true,
    deterministicRandom: true,
    allowNondeterministicCrypto: false,
  });
}

async function durableCounts(persistence: ApplicationNativeMutationPersistence) {
  const result = await persistence.query<{
    commits: string;
    outcomes: string;
    feed: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_commit_app_row_change) as feed,
    (select count(*)::text from fx_system_outbox) as outbox`);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Application-native counts are missing.");
  return Object.freeze({
    commits: Number(row.commits),
    outcomes: Number(row.outcomes),
    feed: Number(row.feed),
    outbox: Number(row.outbox),
  });
}

function failureTag(cause: unknown): string | undefined {
  return cause !== null && typeof cause === "object" &&
      typeof Reflect.get(cause, "_tag") === "string"
    ? Reflect.get(cause, "_tag") as string
    : undefined;
}

function failureReason(cause: unknown): string | undefined {
  if (cause === null || typeof cause !== "object") return undefined;
  const direct = Reflect.get(cause, "reason");
  if (typeof direct === "string") return direct;
  const issue = Reflect.get(cause, "issue");
  if (issue === null || typeof issue !== "object") return undefined;
  const nested = Reflect.get(issue, "reason");
  return typeof nested === "string" ? nested : undefined;
}

interface Deferred<A> {
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
}

interface InvocationBlock {
  readonly started: Deferred<void>;
  readonly released: Deferred<void>;
}

function deferred<A>(): Deferred<A> {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>(accept => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  ));
}
