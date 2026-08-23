import {
  decodeAppDocumentIdentityV1Result,
} from "flarex-protocol/app-document-id";
import {
  encodeEdgeActionHostPolicyV1,
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  type EdgeActionHostPolicyFrameV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
  normalizeApplicationQueryArgumentsV1Effect,
  type ApplicationTransactionWorkerRequestV1,
} from "flarex-protocol/internal/application-worker-v1";
import {
  SchemaManifestAppTableNameSchema,
} from "flarex-protocol/schema-manifest";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type ApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  decodeExecutionIdentityEffect,
  type ExecutionIdentity,
} from "flarex-protocol/auth";
import {
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import {
  ApplicationExecutionHostError,
  type ApplicationExecutionHost,
} from "flarex-backend/internal/application-execution-host";
import {
  makeApplicationWorkerDefinition,
} from "flarex-backend/internal/application-worker-definition";
import type { ApplicationAnalysisSourceReader } from
  "flarex-backend/internal/application-analysis-source-reader";
import {
  openApplicationQuerySnapshot,
  readApplicationQueryIndex,
  readApplicationQueryPoint,
  revalidateApplicationQuerySnapshot,
  type ApplicationQueryBudget,
  type ApplicationQuerySnapshot,
  type ApplicationQuerySnapshotContext,
  type OpenApplicationQuerySnapshotError,
} from
  "@flarex/persistence-postgres/internal/application-query-snapshot";
import type {
  ApplicationActiveSelection,
  ApplicationActivationRepository,
} from "@flarex/persistence-postgres/internal/application-activation";
import {
  ScopeExecution,
  ScopeExecutionLive,
  type ScopeExecutionApi,
} from
  "@flarex/persistence-postgres/internal/scope-execution";
import {
  Context,
  Data,
  Effect,
  Layer,
  Result,
  Scope,
} from "effect";
import { RpcTarget } from "cloudflare:workers";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";

const QUERY_POLICY_ENCODING_BUDGET = Object.freeze({
  maximumOrigins: 1,
  maximumOriginBytes: 1,
  maximumCanonicalBytes: 16_384,
});

const QUERY_WORKER_POLICY = Object.freeze({
  identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  allowedOrigins: Object.freeze([]),
  cpuMilliseconds: 1,
  wallMilliseconds: 1,
  maximumSyscalls: 1,
  maximumOutboundRequests: 1,
  maximumConcurrentOutboundRequests: 1,
  maximumWorkerSubrequests: 1,
  maximumArgumentBytes: 1,
  maximumResultBytes: 1,
  maximumCallbackArgumentBytes: 1,
  maximumCallbackResultBytes: 1,
  maximumUrlBytes: 1,
  maximumMethodBytes: 1,
  maximumHeaderCount: 1,
  maximumHeaderBytes: 1,
  maximumStatusTextBytes: 1,
  maximumOutboundRequestBodyBytes: 1,
  maximumOutboundResponseBodyBytes: 1,
  maximumCumulativeOutboundBodyBytes: 1,
  cleanupDrainMilliseconds: 1,
  allowRunQuery: true,
  allowRunMutation: true,
  allowRunAction: false,
  allowRedirects: false,
  allowStreaming: false,
  allowAmbientCredentials: false,
  fixedInvocationTime: true,
  deterministicRandom: true,
  allowNondeterministicCrypto: false,
} as const satisfies EdgeActionHostPolicyFrameV1);

export interface ApplicationQueryExecutionContext {
  readonly executionId: string;
  readonly randomSeed: Uint8Array;
  readonly executionTime: number;
}

export interface ApplicationQuerySystemLive {
  readonly activation: Pick<
    ApplicationActivationRepository<unknown, unknown>,
    "readActive"
  >;
  readonly snapshot: ApplicationQuerySnapshotContext;
  readonly snapshotBudget: ApplicationQueryBudget;
  readonly source: ApplicationAnalysisSourceReader;
  readonly host: Pick<ApplicationExecutionHost, "runTransaction">;
  readonly executionContextFactory: () => ApplicationQueryExecutionContext;
}

export interface ApplicationSelectionQueryLive {
  readonly snapshot: ApplicationQuerySnapshotContext;
  readonly snapshotBudget: ApplicationQueryBudget;
  readonly source: ApplicationAnalysisSourceReader;
  readonly host: Pick<ApplicationExecutionHost, "runTransaction">;
  readonly executionContextFactory: () => ApplicationQueryExecutionContext;
}

/**
 * Current selection-bound query execution core. It accepts one issuer-owned
 * opaque selection and exposes no activation choice, mutation, or Action
 * capability. Identity is required because this port does not own an
 * authentication or anonymous-default policy.
 */
export interface ApplicationSelectionQueryPort<
  QueryFailure,
  QueryResult = CanonicalFlarexRuntimeValueV1,
> {
  readonly runQuery: (
    selection: ApplicationActiveSelection,
    functionRef: string,
    argumentsValue: CanonicalFlarexRuntimeValueV1,
    identity: ExecutionIdentity,
  ) => Effect.Effect<QueryResult, QueryFailure, Scope.Scope>;
}

export class ApplicationQueryInputError extends Data.TaggedError(
  "ApplicationQueryInputError",
)<{
  readonly reason: "invalidFunction" | "invalidArguments" | "invalidIdentity";
  readonly cause?: unknown;
}> {}

export class ApplicationQueryCompositionError extends Data.TaggedError(
  "ApplicationQueryCompositionError",
)<{
  readonly reason:
    | "invalidExecutionContext"
    | "invalidTarget"
    | "sourceReadFailed"
    | "workerDefinitionFailed";
  readonly cause?: unknown;
}> {}

export type InvokeApplicationQueryError =
  | Effect.Error<ReturnType<ApplicationQuerySystemLive["activation"]["readActive"]>>
  | ApplicationQueryInputError
  | InvokeApplicationSelectionQueryError;

export type InvokeApplicationSelectionQueryError =
  | OpenApplicationQuerySnapshotError
  | ApplicationQueryInputError
  | ApplicationQueryCompositionError
  | ApplicationExecutionHostError;

export interface ApplicationQuerySystemApi {
  readonly selectionQuery: ApplicationSelectionQueryPort<
    InvokeApplicationSelectionQueryError
  >;
  readonly invoke: (
    functionRef: string,
    args: unknown,
    identity?: ExecutionIdentity,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    InvokeApplicationQueryError,
    Scope.Scope
  >;
}

export class ApplicationQuerySystem extends Context.Service<
  ApplicationQuerySystem,
  ApplicationQuerySystemApi
>()("flarex/standard-application-invocation/ApplicationQuerySystem") {}

export const invokeApplicationQuery = Effect.fn(
  "ApplicationQuery.invoke",
)(function* (
  functionRef: string,
  args: unknown,
  identity: ExecutionIdentity = ANONYMOUS_IDENTITY,
): Effect.fn.Return<
  CanonicalFlarexRuntimeValueV1,
  InvokeApplicationQueryError,
  ApplicationQuerySystem | Scope.Scope
> {
  const system = yield* ApplicationQuerySystem;
  return yield* system.invoke(functionRef, args, identity);
});

export function makeApplicationQuerySystemLayer(
  live: ApplicationQuerySystemLive,
): Layer.Layer<ApplicationQuerySystem> {
  const captured = captureLive(live);
  return Layer.effect(
    ApplicationQuerySystem,
    Effect.gen(function* () {
      const selectionQuery = yield* makeApplicationSelectionQueryPort(captured);
      return ApplicationQuerySystem.of({
        selectionQuery,
        invoke: makeInvoke(captured.activation, selectionQuery),
      });
    }),
  ).pipe(Layer.provide(ScopeExecutionLive));
}

function captureLive(live: ApplicationQuerySystemLive): ApplicationQuerySystemLive {
  const activationOwner = live.activation;
  const readActive = activationOwner.readActive;
  const selectionLive = captureSelectionLive(live);
  return Object.freeze({
    activation: Object.freeze({
      readActive: () => readActive.call(activationOwner),
    }),
    ...selectionLive,
  });
}

export const makeApplicationSelectionQueryPort = Effect.fn(
  "ApplicationSelectionQueryPort.make",
)(function* (live: ApplicationSelectionQueryLive) {
  const captured = captureSelectionLive(live);
  const scopeExecution = yield* ScopeExecution;
  const policy = yield* queryWorkerPolicy;
  return Object.freeze({
    runQuery: makeSelectionInvoke(captured, policy, scopeExecution),
  }) satisfies ApplicationSelectionQueryPort<InvokeApplicationSelectionQueryError>;
});

function captureSelectionLive(
  live: ApplicationSelectionQueryLive,
): ApplicationSelectionQueryLive {
  const sourceOwner = live.source;
  const sourceRead = sourceOwner.read;
  const hostOwner = live.host;
  const runTransaction = hostOwner.runTransaction;
  const source: ApplicationSelectionQueryLive["source"] = Object.freeze({
    read: (
      rootSha256: Parameters<
        ApplicationSelectionQueryLive["source"]["read"]
      >[0],
    ) => sourceRead.call(sourceOwner, rootSha256),
  });
  const host: ApplicationSelectionQueryLive["host"] = Object.freeze({
    runTransaction: (
      input: Parameters<
        ApplicationSelectionQueryLive["host"]["runTransaction"]
      >[0],
    ) => runTransaction.call(hostOwner, input),
  });
  return Object.freeze({
    snapshot: live.snapshot,
    snapshotBudget: Object.freeze({ ...live.snapshotBudget }),
    source,
    host,
    executionContextFactory: live.executionContextFactory,
  });
}

function makeInvoke(
  activation: ApplicationQuerySystemLive["activation"],
  selectionQuery: ApplicationSelectionQueryPort<
    InvokeApplicationSelectionQueryError
  >,
): ApplicationQuerySystemApi["invoke"] {
  return Effect.fn("ApplicationQuerySystem.invoke")(function* (
    functionRef,
    args,
    identity = ANONYMOUS_IDENTITY,
  ) {
    if (typeof functionRef !== "string" || functionRef.trim().length === 0) {
      return yield* new ApplicationQueryInputError({ reason: "invalidFunction" });
    }
    const normalizedArguments = yield* normalizeApplicationQueryArgumentsV1Effect(
      args,
    ).pipe(Effect.mapError(cause => new ApplicationQueryInputError({
        reason: "invalidArguments",
        cause,
      })));
    const auth = yield* decodeExecutionIdentityEffect(identity).pipe(
      Effect.mapError(cause => new ApplicationQueryInputError({
        reason: "invalidIdentity",
        cause,
      })),
    );
    const active = yield* activation.readActive();
    return yield* selectionQuery.runQuery(
      active.selection,
      functionRef,
      normalizedArguments.value,
      auth,
    );
  });
}

function makeSelectionInvoke(
  live: ApplicationSelectionQueryLive,
  policy: QueryWorkerPolicy,
  scopeExecution: ScopeExecutionApi,
): ApplicationSelectionQueryPort<
  InvokeApplicationSelectionQueryError
>["runQuery"] {
  return Effect.fn("ApplicationSelectionQueryPort.runQuery")(function* (
    selection,
    functionRef,
    argumentsValue,
    identity,
  ) {
    if (typeof functionRef !== "string" || functionRef.trim().length === 0) {
      return yield* new ApplicationQueryInputError({ reason: "invalidFunction" });
    }
    const normalizedArguments = yield* normalizeApplicationQueryArgumentsV1Effect(
      argumentsValue,
    ).pipe(Effect.mapError(cause => new ApplicationQueryInputError({
        reason: "invalidArguments",
        cause,
      })));
    const auth = yield* decodeExecutionIdentityEffect(identity).pipe(
      Effect.mapError(cause => new ApplicationQueryInputError({
        reason: "invalidIdentity",
        cause,
      })),
    );
    const opened = yield* openApplicationQuerySnapshot(
      selection,
      functionRef,
      live.snapshotBudget,
      live.snapshot,
    ).pipe(Effect.provideService(ScopeExecution, scopeExecution));
    const target = yield* Effect.fromResult(
      canonicalizeApplicationRuntimeTargetV1(runtimeTarget(opened.metadata)).pipe(
        Result.mapError(cause => new ApplicationQueryCompositionError({
          reason: "invalidTarget",
          cause,
        })),
      ),
    );
    const source = yield* live.source.read(
      target.target.sourceArtifactRootSha256,
    ).pipe(Effect.mapError(cause => new ApplicationQueryCompositionError({
      reason: "sourceReadFailed",
      cause,
    })));
    const definition = yield* Effect.try({
      try: () => makeApplicationWorkerDefinition({
        source,
        target: target.target,
        manifest: opened.metadata.basis.manifest,
        hostPolicy: policy.frame,
        hostPolicySha256: policy.sha256,
        compatibilityDate: opened.metadata.basis.compatibilityDate,
      }),
      catch: cause => new ApplicationQueryCompositionError({
        reason: "workerDefinitionFailed",
        cause,
      }),
    });
    const execution = yield* Effect.try({
      try: () => live.executionContextFactory(),
      catch: cause => new ApplicationQueryCompositionError({
        reason: "invalidExecutionContext",
        cause,
      }),
    });
    const request: ApplicationTransactionWorkerRequestV1 = {
      format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
      version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
      target: target.target,
      auth,
      arguments: normalizedArguments.value,
      argumentSemanticBytes: normalizedArguments.semanticSizeBytes,
      tables: opened.metadata.tables.map(table => Object.freeze({
        tableId: table.tableId,
        logicalName: SchemaManifestAppTableNameSchema.make(table.logicalName),
      })),
      context: {
        mode: "query",
        executionId: execution.executionId,
        randomSeed: execution.randomSeed,
        executionTime: execution.executionTime,
        snapshotCommitSeq: opened.metadata.snapshotToken.commitSeq,
      },
    };
    return yield* live.host.runTransaction({
      definition,
      request,
      capability: new ApplicationQueryRpcCapability(opened.snapshot),
    });
  });
}

function runtimeTarget(
  metadata: import("@flarex/persistence-postgres/internal/application-query-snapshot")
    .ApplicationQuerySnapshotMetadata,
): ApplicationRuntimeTargetV1 {
  const basis = metadata.basis;
  return {
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: basis.authority.scopeId,
    revisionId: basis.revisionId,
    candidateId: basis.candidateId,
    analysisId: basis.analysisId,
    sourceArtifactRootSha256: encodeBytesToLowercaseHex(
      basis.sourceArtifactRootSha256,
    ),
    manifestSha256: encodeBytesToLowercaseHex(basis.manifestSha256),
    schemaSha256: encodeBytesToLowercaseHex(basis.applicationSchemaSha256),
    functionCatalogSha256: encodeBytesToLowercaseHex(
      basis.functionCatalogSha256,
    ),
    publicationSha256: encodeBytesToLowercaseHex(basis.publicationSha256),
    executionModulePath: basis.manifest.sourceArtifact.executionModulePath,
    function: metadata.function,
  };
}

class ApplicationQueryRpcCapability extends RpcTarget {
  constructor(private readonly snapshot: ApplicationQuerySnapshot) {
    super();
  }

  revalidate() {
    return Effect.runPromise(revalidateApplicationQuerySnapshot(this.snapshot));
  }

  readPointDocument(tableName: string, documentId: string) {
    return Effect.runPromise(Effect.fromResult(
      decodeAppDocumentIdentityV1Result(documentId),
    ).pipe(Effect.flatMap(identity =>
      readApplicationQueryPoint(this.snapshot, tableName, identity.id)
    )));
  }

  queryIndexRange(
    tableName: string,
    indexDescriptor: unknown,
    bounds: unknown,
    limit: number,
  ) {
    return Effect.runPromise(readApplicationQueryIndex(
      this.snapshot,
      tableName,
      indexDescriptor,
      bounds,
      limit,
    ));
  }
}

const queryWorkerPolicy = Effect.suspend(() => {
  const encoded = encodeEdgeActionHostPolicyV1(
    QUERY_WORKER_POLICY,
    QUERY_POLICY_ENCODING_BUDGET,
  ).pipe(Result.getOrThrow);
  return Effect.promise(() => crypto.subtle.digest(
    "SHA-256",
    encoded.canonicalBytes.slice().buffer,
  )).pipe(Effect.map(buffer => Object.freeze({
    frame: encoded.frame,
    sha256: new Uint8Array(buffer),
  })));
});

type QueryWorkerPolicy = Effect.Success<typeof queryWorkerPolicy>;

const ANONYMOUS_IDENTITY = Object.freeze({ kind: "anonymous" as const });
