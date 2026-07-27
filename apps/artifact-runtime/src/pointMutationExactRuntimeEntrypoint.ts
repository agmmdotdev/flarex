import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect } from "effect";
import {
  loadPointMutationExactRuntimeWorkerDefinitionV1Effect,
  type PointMutationExactRuntimeHostV1Error,
  type PointMutationExactRuntimeWorkerDefinitionV1,
} from "flarex-backend/artifact-runtime";
import {
  R2BackendExecutionArtifactStore,
  type R2BucketLike,
} from "flarex-backend/artifact-store";
import {
  decodePointMutationExactRuntimeRequestV1Effect,
  decodePointMutationExactRuntimeResultV1Effect,
  POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1,
  type PointMutationExactRuntimeRequestV1,
  type PointMutationExactRuntimeResultV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
  type PointMutationExactRuntimeHostFailureReasonV1,
  type PointMutationExactRuntimeHostResponseV1,
} from "flarex-protocol/point-mutation-exact-runtime-host";

const DEFAULT_EXACT_RUNTIME_COMPATIBILITY_DATE = "2026-06-14";

interface ReceivedRpcStub {
  readonly [Symbol.dispose]?: () => void;
}

export interface ExactRuntimeJournalTableRpcStubV1 extends ReceivedRpcStub {
  readonly runPointOperation: (
    operation: unknown,
  ) => unknown | PromiseLike<unknown>;
}

export interface ExactRuntimeJournalRpcStubV1 extends ReceivedRpcStub {
  readonly resolvePointTable: (
    tableName: unknown,
  ) =>
    | ExactRuntimeJournalTableRpcStubV1
    | PromiseLike<ExactRuntimeJournalTableRpcStubV1>;
}

interface ExactRuntimeDynamicWorkerEntrypointV1
  extends Rpc.WorkerEntrypointBranded {
  readonly run: (
    input: PointMutationExactRuntimeRequestV1,
    journal: ExactRuntimeJournalRpcStubV1,
  ) => Promise<unknown>;
}

export interface PointMutationExactRuntimeArtifactHostEnvV1 {
  readonly ARTIFACTS: R2BucketLike;
  readonly LOADER?: WorkerLoader;
  readonly FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE?: string;
}

type ArtifactHostExpectedError =
  | PointMutationExactRuntimeHostV1Error
  | Readonly<{
      readonly _tag: "ArtifactHostExpectedError";
      readonly reason: PointMutationExactRuntimeHostFailureReasonV1;
    }>;

export async function runPointMutationExactRuntimeArtifactHostV1(
  env: PointMutationExactRuntimeArtifactHostEnvV1,
  input: unknown,
  journal: ExactRuntimeJournalRpcStubV1,
): Promise<PointMutationExactRuntimeHostResponseV1> {
  return await Effect.runPromise(
    pointMutationExactRuntimeArtifactHostEffect(env, input, journal).pipe(
      Effect.catch((error: ArtifactHostExpectedError) =>
        Effect.succeed(failureResponse(reasonForExpectedError(error)))
      ),
      Effect.ensuring(disposeRpcStubEffect(journal)),
    ),
  );
}

export class FlarexPointMutationExactRuntimeArtifactHostV1
  extends WorkerEntrypoint<PointMutationExactRuntimeArtifactHostEnvV1> {
  run(
    input: unknown,
    journal: ExactRuntimeJournalRpcStubV1,
  ): Promise<PointMutationExactRuntimeHostResponseV1> {
    return runPointMutationExactRuntimeArtifactHostV1(
      this.env,
      input,
      journal,
    );
  }
}

const pointMutationExactRuntimeArtifactHostEffect = Effect.fn(
  "PointMutationExactRuntimeArtifactHost.run",
)(function* (
  env: PointMutationExactRuntimeArtifactHostEnvV1,
  input: unknown,
  journal: ExactRuntimeJournalRpcStubV1,
): Effect.fn.Return<
  PointMutationExactRuntimeHostResponseV1,
  ArtifactHostExpectedError
> {
  const request = yield* decodePointMutationExactRuntimeRequestV1Effect(
    input,
  ).pipe(
    Effect.mapError(() => expectedError("invalidRequest")),
  );
  const loader = yield* env.LOADER === undefined
    ? Effect.fail(expectedError("workerLoadFailed"))
    : Effect.succeed(env.LOADER);
  const store = new R2BackendExecutionArtifactStore(env.ARTIFACTS);
  const loaded = yield* loadPointMutationExactRuntimeWorkerDefinitionV1Effect({
    store,
    artifact: request.artifact,
    compatibilityDate:
      env.FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE ??
        DEFAULT_EXACT_RUNTIME_COMPATIBILITY_DATE,
  });
  const entrypoint = yield* Effect.try({
    try: () => {
      const worker = loader.load(workerCode(loaded.definition));
      return worker.getEntrypoint<ExactRuntimeDynamicWorkerEntrypointV1>(
        POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1,
      );
    },
    catch: () => expectedError("workerLoadFailed"),
  });
  const decodedResult = yield* Effect.acquireUseRelease(
    Effect.succeed(entrypoint),
    (stub) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => stub.run(request, journal),
          catch: (cause) => cause,
        }).pipe(
          Effect.catch((cause: unknown) => {
            const reason = dynamicWorkerFailureReason(cause);
            return reason === undefined
              ? Effect.die(cause)
              : Effect.fail(expectedError(reason));
          }),
        ),
        (rpcResult) =>
          decodePointMutationExactRuntimeResultV1Effect(
            detachRpcResultObject(rpcResult),
          ).pipe(
            Effect.mapError(() => expectedError("invalidResult")),
          ),
        (rpcResult) => disposeRpcValueEffect(rpcResult),
      ),
    (stub) => disposeRpcStubEffect(stub),
  );
  return successResponse(decodedResult);
});

function workerCode(
  definition: PointMutationExactRuntimeWorkerDefinitionV1,
): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: definition.compatibilityDate,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    globalOutbound: definition.globalOutbound,
  };
}

function expectedError(
  reason: PointMutationExactRuntimeHostFailureReasonV1,
): ArtifactHostExpectedError {
  return Object.freeze({
    _tag: "ArtifactHostExpectedError",
    reason,
  });
}

function reasonForExpectedError(
  error: ArtifactHostExpectedError,
): PointMutationExactRuntimeHostFailureReasonV1 {
  if (error._tag === "PointMutationExactRuntimeHostV1Error") {
    return error.issue.reason;
  }
  return error.reason;
}

function dynamicWorkerFailureReason(
  cause: unknown,
): PointMutationExactRuntimeHostFailureReasonV1 | undefined {
  if (!isErrorLike(cause)) return undefined;
  switch (cause.name) {
    case "PointMutationExactRuntimeUserCodeV1Error":
      return "userCodeFailed";
    case "PointMutationExactRuntimeJournalBoundaryV1Error":
      return "journalBoundaryFailed";
    case "PointMutationExactRuntimeInvalidRequestV1Error":
      return "invalidRequest";
    case "PointMutationExactRuntimeWorkerDefinitionV1Error":
      return "workerDefinitionFailed";
    default:
      return undefined;
  }
}

function isErrorLike(
  value: unknown,
): value is Readonly<{ readonly name: string }> {
  return value !== null &&
    typeof value === "object" &&
    typeof Reflect.get(value, "name") === "string";
}

function successResponse(
  result: PointMutationExactRuntimeResultV1,
): PointMutationExactRuntimeHostResponseV1 {
  return Object.freeze({
    format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
    version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
    kind: "success",
    result,
  });
}

function failureResponse(
  reason: PointMutationExactRuntimeHostFailureReasonV1,
): PointMutationExactRuntimeHostResponseV1 {
  return Object.freeze({
    format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
    version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
    kind: "failure",
    reason,
  });
}

function disposeRpcStubEffect(
  stub: object,
): Effect.Effect<void> {
  return disposeRpcValueEffect(stub);
}

function disposeRpcValueEffect(
  value: unknown,
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (
      value === null ||
      (typeof value !== "object" && typeof value !== "function")
    ) {
      return;
    }
    const dispose = Reflect.get(value, Symbol.dispose);
    if (typeof dispose === "function") {
      Reflect.apply(dispose, value, []);
    }
  });
}

function detachRpcResultObject(value: unknown): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return value;
  }
  const detached: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (key === Symbol.dispose) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(
        "Exact-runtime RPC result must contain only data properties.",
      );
    }
    Object.defineProperty(detached, key, descriptor);
  }
  return detached;
}
