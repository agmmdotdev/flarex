import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect, Exit } from "effect";

import {
  POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
  decodePointMutationExactRuntimeRequestV1Effect,
  type PointMutationExactRuntimeAuthV1,
  type PointMutationExactRuntimeRequestV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  decodePointMutationExactRuntimeHostResponseV1Effect,
  type PointMutationExactRuntimeHostFailureReasonV1,
  type PointMutationExactRuntimeHostResponseV1,
} from "flarex-protocol/point-mutation-exact-runtime-host";
import type {
  TransactionGrantInertAuthV1,
} from "flarex-protocol/transaction-grant";

import type {
  PointMutationJournalBoundaryV1Error,
} from "./pointMutationJournal";
import {
  makePointMutationJournalRpcSessionV1,
  type PointMutationJournalRpcParentTargetV1,
  type PointMutationJournalRpcSessionV1,
} from "./pointMutationJournalRpc";
import type {
  PointMutationOccRuntimeNeutralRunnerInputV1,
  PointMutationOccRuntimeNeutralRunnerV1,
} from "./storedAttemptAuthentication";
import {
  PointMutationOccUserCodeV1Error,
} from "./storedAttemptAuthentication/exactPointMutationExecutionOperations";

export type PointMutationExactRuntimeRunnerHostV1ErrorReason =
  | "requestProjectionInvalid"
  | "transportFailed"
  | "invalidHostResponse"
  | Exclude<
    PointMutationExactRuntimeHostFailureReasonV1,
    "userCodeFailed"
  >;

export class PointMutationExactRuntimeRunnerHostV1Error
  extends Data.TaggedError("PointMutationExactRuntimeRunnerHostV1Error")<{
    readonly reason: PointMutationExactRuntimeRunnerHostV1ErrorReason;
    readonly cause?: unknown;
  }> {}

type PointMutationExactRuntimeCallV1Error =
  | PointMutationExactRuntimeRunnerHostV1Error
  | PointMutationOccUserCodeV1Error;

type PointMutationExactRuntimeRunnerV1Error =
  | PointMutationExactRuntimeCallV1Error
  | PointMutationJournalBoundaryV1Error;

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
      const request = yield* projectExactRuntimeRequestV1(input);
      const session = yield* Effect.sync(() =>
        makePointMutationJournalRpcSessionV1(input.journal)
      );
      return yield* runWithJournalSettlementV1(
        config,
        request,
        session,
      );
    },
  );
  return Object.freeze({ run });
}

const projectExactRuntimeRequestV1 = Effect.fn(
  "PointMutationExactRuntimeRunner.projectRequest",
)(function* (
  input: PointMutationOccRuntimeNeutralRunnerInputV1,
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

const runWithJournalSettlementV1 = Effect.fn(
  "PointMutationExactRuntimeRunner.runWithJournalSettlement",
)(function* (
  config: PointMutationExactRuntimeRunnerV1Config,
  request: PointMutationExactRuntimeRequestV1,
  session: PointMutationJournalRpcSessionV1,
): Effect.fn.Return<
  unknown,
  PointMutationExactRuntimeRunnerV1Error
> {
  return yield* Effect.uninterruptible(
    callArtifactHostV1(config, request, session.target).pipe(
      Effect.exit,
      Effect.flatMap((hostExit) =>
        session.closeAndDrain.pipe(
          Effect.exit,
          Effect.flatMap((journalExit) =>
            resolveRunnerExitsV1(hostExit, journalExit)
          ),
        )
      ),
    ),
  );
});

function resolveRunnerExitsV1(
  hostExit: Exit.Exit<unknown, PointMutationExactRuntimeCallV1Error>,
  journalExit: Exit.Exit<void, PointMutationJournalBoundaryV1Error>,
): Effect.Effect<unknown, PointMutationExactRuntimeRunnerV1Error> {
  if (Exit.isFailure(journalExit)) {
    return Effect.failCause(journalExit.cause);
  }
  return Exit.isSuccess(hostExit)
    ? Effect.succeed(hostExit.value)
    : Effect.failCause(hostExit.cause);
}

const callArtifactHostV1 = Effect.fn(
  "PointMutationExactRuntimeRunner.callArtifactHost",
)(function* (
  config: PointMutationExactRuntimeRunnerV1Config,
  request: PointMutationExactRuntimeRequestV1,
  journal: PointMutationJournalRpcParentTargetV1,
): Effect.fn.Return<
  unknown,
  PointMutationExactRuntimeRunnerHostV1Error | PointMutationOccUserCodeV1Error
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
      decodeOwnedHostResponseV1(rawResponse).pipe(
        Effect.flatMap(classifyHostResponseV1),
      ),
    disposeRpcValueEffect,
  );
});

const decodeOwnedHostResponseV1 = Effect.fn(
  "PointMutationExactRuntimeRunner.decodeHostResponse",
)(function* (
  rawResponse: unknown,
): Effect.fn.Return<
  PointMutationExactRuntimeHostResponseV1,
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
  return yield* decodePointMutationExactRuntimeHostResponseV1Effect(
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

function classifyHostResponseV1(
  response: PointMutationExactRuntimeHostResponseV1,
): Effect.Effect<
  unknown,
  PointMutationExactRuntimeRunnerHostV1Error | PointMutationOccUserCodeV1Error
> {
  if (response.kind === "success") {
    return Effect.succeed(response.result.value);
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
