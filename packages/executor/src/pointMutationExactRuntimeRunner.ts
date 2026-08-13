import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect } from "effect";

import {
  POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
  decodePointMutationExactRuntimeRequestV1Effect,
  type PointMutationExactRuntimeAuthV1,
  type PointMutationExactRuntimeRequestV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  decodePointMutationExactRuntimeHostResponseV2Effect,
  type PointMutationExactRuntimeHostFailureReasonV2,
  type PointMutationExactRuntimeHostResponseV2,
} from "flarex-protocol/point-mutation-exact-runtime-host";
import type {
  TransactionGrantInertAuthV1,
} from "flarex-protocol/transaction-grant";

import {
  makePointMutationJournalRpcSessionV1,
  runPointMutationRuntimeWithJournalSettlementV1,
  type PointMutationJournalRpcParentTargetV1,
} from "./pointMutationJournalRpc";
import type {
  PointMutationOccRuntimeNeutralRunnerInputV1,
  PointMutationOccRuntimeNeutralRunnerV1,
} from "./storedAttemptAuthentication";
import {
  PointMutationOccApplicationErrorV1,
  PointMutationOccUserCodeV1Error,
} from "./storedAttemptAuthentication/exactPointMutationExecutionOperations";

export type PointMutationExactRuntimeRunnerHostV1ErrorReason =
  | "requestProjectionInvalid"
  | "transportFailed"
  | "invalidHostResponse"
  | "sourceArtifactLoadFailed"
  | "readBoundaryFailed"
  | "callbackFailed"
  | "terminalFailed"
  | "timedOut"
  | Exclude<
    PointMutationExactRuntimeHostFailureReasonV2,
    "userCodeFailed"
  >;

export class PointMutationExactRuntimeRunnerHostV1Error
  extends Data.TaggedError("PointMutationExactRuntimeRunnerHostV1Error")<{
    readonly reason: PointMutationExactRuntimeRunnerHostV1ErrorReason;
    readonly cause?: unknown;
  }> {}

/**
 * The private named artifact-runtime entrypoint as observed by the executor.
 * Cloudflare supplies a `Service<...>` stub in production; this structural
 * port keeps construction and focused tests independent of an app Env type.
 */
export interface PointMutationExactRuntimeArtifactHostBindingV1 {
  readonly run: (
    input: PointMutationExactRuntimeRequestV1,
    journal: PointMutationJournalRpcParentTargetV1,
  ) => PromiseLike<unknown>;
}

export interface PointMutationExactRuntimeRunnerV1Config {
  readonly binding: PointMutationExactRuntimeArtifactHostBindingV1;
  /**
   * Cloudflare propagates remote defects through the same rejected-Promise
   * surface used by platform transport failures. Classify only failures whose
   * concrete host adapter can prove they are expected transport failures.
   * Every unclassified rejection remains a defect.
   */
  readonly isExpectedTransportFailure: (cause: unknown) => boolean;
}

export function makePointMutationExactRuntimeRunnerV1(
  config: PointMutationExactRuntimeRunnerV1Config,
): PointMutationOccRuntimeNeutralRunnerV1 {
  const run = Effect.fn("PointMutationExactRuntimeRunner.run")(
    function* (input: PointMutationOccRuntimeNeutralRunnerInputV1) {
      if (input.executionAuthorityGeneration !== "legacy_dynamic_worker_v1") {
        return yield* Effect.fail(
          new PointMutationExactRuntimeRunnerHostV1Error({
            reason: "requestProjectionInvalid",
          }),
        );
      }
      const request = yield* projectExactRuntimeRequestV1(input);
      const session = yield* Effect.sync(() =>
        makePointMutationJournalRpcSessionV1(input.journal)
      );
      return yield* runPointMutationRuntimeWithJournalSettlementV1(
        callArtifactHostV1(config, request, session.target),
        session.closeAndDrain,
      );
    },
  );
  return Object.freeze({ run });
}

const projectExactRuntimeRequestV1 = Effect.fn(
  "PointMutationExactRuntimeRunner.projectRequest",
)(function* (
  input: Extract<
    PointMutationOccRuntimeNeutralRunnerInputV1,
    { readonly executionAuthorityGeneration: "legacy_dynamic_worker_v1" }
  >,
): Effect.fn.Return<
  PointMutationExactRuntimeRequestV1,
  PointMutationExactRuntimeRunnerHostV1Error
> {
  const payload = input.verifiedGrant.evidence.payload;
  const candidate = {
    format: POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1,
    version: POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
    artifact: {
      runtime: payload.artifactRuntime,
      artifactId: payload.artifactId,
      sourcePackageHash: payload.sourcePackageHash,
      executionModule: payload.executionModule,
    },
    function: {
      path: input.functionMetadata.path,
      executionModule: input.functionMetadata.executionModule,
      kind: input.functionMetadata.kind,
      visibility: input.functionMetadata.visibility,
      argsValidator: input.functionMetadata.argsValidator,
      returnsValidator: input.functionMetadata.returnsValidator,
    },
    auth: projectExactRuntimeAuthV1(payload.auth),
    arguments: input.argumentsJson,
    argumentArraySemanticBytes: input.argumentArraySemanticBytes,
    tables: input.stableBindings.map((binding) => ({
      tableId: binding.tableId,
      logicalName: binding.logicalName,
    })),
    context: {
      executionId: input.context.executionId,
      logScopeId: input.context.logScopeId,
      randomSeed: copyBytes(input.context.randomSeed),
      executionTime: input.context.executionTime,
      initialCreationTimeCursor: input.context.initialCreationTimeCursor,
    },
  };
  return yield* decodePointMutationExactRuntimeRequestV1Effect(candidate).pipe(
    Effect.mapError((cause) =>
      new PointMutationExactRuntimeRunnerHostV1Error({
        reason: "requestProjectionInvalid",
        cause,
      })
    ),
  );
});

function projectExactRuntimeAuthV1(
  auth: TransactionGrantInertAuthV1,
): PointMutationExactRuntimeAuthV1 | TransactionGrantInertAuthV1 {
  switch (auth.kind) {
    case "anonymous":
      return { kind: "anonymous" };
    case "verifiedBearer":
      return {
        kind: "user",
        user: {
          ...structuredClone(auth.claims),
          tokenIdentifier: `${auth.issuer}|${auth.subject}`,
          subject: auth.subject,
          issuer: auth.issuer,
        },
      };
    case "trustedDev":
      // The authenticated V1 point-mutation policy rejects trustedDev. Keep
      // this unsupported spelling so the strict request decoder fails closed
      // if upstream authority verification ever regresses.
      return { ...auth };
  }
}

const callArtifactHostV1 = Effect.fn(
  "PointMutationExactRuntimeRunner.callArtifactHost",
)(function* (
  config: PointMutationExactRuntimeRunnerV1Config,
  request: PointMutationExactRuntimeRequestV1,
  journal: PointMutationJournalRpcParentTargetV1,
): Effect.fn.Return<
  unknown,
  | PointMutationExactRuntimeRunnerHostV1Error
  | PointMutationOccApplicationErrorV1
  | PointMutationOccUserCodeV1Error
> {
  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      // Workers RPC exposes no cancellation signal. Keep this wait
      // uninterruptible so a requested interruption cannot detach a remote
      // Worker that still holds the live journal capability. The enclosing
      // mask re-emits the pending interruption after the RPC settles and the
      // journal graph has been closed and drained.
      try: () => Promise.resolve(config.binding.run(request, journal)),
      catch: (cause): unknown => cause,
    }).pipe(
      Effect.catch((cause: unknown) =>
        config.isExpectedTransportFailure(cause)
          ? Effect.fail(
            new PointMutationExactRuntimeRunnerHostV1Error({
              reason: "transportFailed",
              cause,
            }),
          )
          : Effect.die(cause)
      ),
    ),
    (rawResponse) =>
      decodeOwnedHostResponseV2(rawResponse).pipe(
        Effect.flatMap(classifyHostResponseV2),
      ),
    disposeRpcValueEffect,
  );
});

const decodeOwnedHostResponseV2 = Effect.fn(
  "PointMutationExactRuntimeRunner.decodeHostResponse",
)(function* (
  rawResponse: unknown,
): Effect.fn.Return<
  PointMutationExactRuntimeHostResponseV2,
  PointMutationExactRuntimeRunnerHostV1Error
> {
  const detached = yield* Effect.try({
    try: () => detachRpcResultObject(rawResponse),
    catch: (cause) =>
      new PointMutationExactRuntimeRunnerHostV1Error({
        reason: "invalidHostResponse",
        cause,
      }),
  });
  return yield* decodePointMutationExactRuntimeHostResponseV2Effect(
    detached,
  ).pipe(
    Effect.mapError((cause) =>
      new PointMutationExactRuntimeRunnerHostV1Error({
        reason: "invalidHostResponse",
        cause,
      })
    ),
  );
});

function classifyHostResponseV2(
  response: PointMutationExactRuntimeHostResponseV2,
): Effect.Effect<
  unknown,
  | PointMutationExactRuntimeRunnerHostV1Error
  | PointMutationOccApplicationErrorV1
  | PointMutationOccUserCodeV1Error
> {
  if (response.kind === "success") {
    return Effect.succeed(response.result.value);
  }
  if (response.kind === "applicationError") {
    return Effect.fail(
      new PointMutationOccApplicationErrorV1(
        response.error.data !== undefined
          ? {
            code: response.error.code,
            message: response.error.message,
            data: response.error.data,
          }
          : {
            code: response.error.code,
            message: response.error.message,
          },
      ),
    );
  }
  if (response.reason === "userCodeFailed") {
    return Effect.fail(
      new PointMutationOccUserCodeV1Error({
        cause: remoteUserCodeFailure(),
      }),
    );
  }
  return Effect.fail(
    new PointMutationExactRuntimeRunnerHostV1Error({
      reason: response.reason,
    }),
  );
}

function remoteUserCodeFailure(): Error {
  const error = new Error("Exact point-mutation user code failed.");
  Object.defineProperty(error, "stack", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  return error;
}

function disposeRpcValueEffect(value: unknown): Effect.Effect<void> {
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
        "Exact-runtime host RPC response must contain only data properties.",
      );
    }
    Object.defineProperty(detached, key, descriptor);
  }
  return detached;
}
