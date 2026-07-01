import { Context, Effect, Layer } from "effect";
import type {
  AbandonPushRequest,
  ActiveDeploymentStatus,
  ExecutionArtifactRef,
  FinishPushResponse,
  PushSourcePackage,
  PushStatus,
} from "../types";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "./Runtime";
import {
  DeploymentPushStore,
  type AbandonPushStoreInput,
  type DeploymentSqlError,
  type FinishPushStoreInput,
  type StartAnalyzedPushStoreInput,
} from "./Store";
import type { StartAnalyzedPushServiceInput } from "./Validation";
import {
  DeploymentActiveDeploymentInvalidError,
  DeploymentActiveDeploymentNotFoundError,
  DeploymentArtifactRefError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
  DeploymentStoredPushMissingError,
  DeploymentValidationError,
} from "./Errors";

export type StartAnalyzedPushInput = StartAnalyzedPushServiceInput;

export interface DeploymentPushReader {
  getPush(pushId: string): Effect.Effect<
    PushStatus | null,
    DeploymentSqlError | DeploymentValidationError
  >;
}

export interface DeploymentActiveDeploymentReader {
  getActiveDeployment(): Effect.Effect<
    ActiveDeploymentStatus | null,
    DeploymentActiveDeploymentInvalidError | DeploymentSqlError | DeploymentValidationError
  >;
}

export interface DeploymentArtifactResolver {
  executionArtifactRefForSourcePackage(
    sourcePackage: PushSourcePackage,
  ): Effect.Effect<ExecutionArtifactRef, DeploymentArtifactRefError>;
}

export interface DeploymentClockReader {
  readonly currentTimeMillis: Effect.Effect<number>;
}

export interface DeploymentIdReader {
  readonly pushId: Effect.Effect<string>;
}

export interface DeploymentServiceApi {
  getActiveDeployment(): Effect.Effect<
    ActiveDeploymentStatus,
    | DeploymentActiveDeploymentInvalidError
    | DeploymentActiveDeploymentNotFoundError
    | DeploymentSqlError
    | DeploymentValidationError
  >;
  getPush(pushId: string): Effect.Effect<
    PushStatus,
    DeploymentPushNotFoundError | DeploymentSqlError | DeploymentValidationError
  >;
  startAnalyzedPush(input: StartAnalyzedPushInput): Effect.Effect<
    PushStatus,
    DeploymentSqlError | DeploymentStoredPushMissingError | DeploymentValidationError
  >;
  finishPush(pushId: string): Effect.Effect<
    FinishPushResponse,
    | DeploymentArtifactRefError
    | DeploymentPushNotFoundError
    | DeploymentSqlError
    | DeploymentStoredPushMissingError
    | DeploymentValidationError
  >;
  abandonPush(pushId: string, request: AbandonPushRequest): Effect.Effect<
    PushStatus,
    | DeploymentPushNotFoundError
    | DeploymentPushInvalidStateError
    | DeploymentSqlError
    | DeploymentStoredPushMissingError
    | DeploymentValidationError
  >;
}

export const requireDeploymentPush = Effect.fn("DeploymentService.requireDeploymentPush")(
  function* (
    store: DeploymentPushReader,
    pushId: string,
  ): Effect.fn.Return<
    PushStatus,
    DeploymentPushNotFoundError | DeploymentSqlError | DeploymentValidationError
  > {
    const status = yield* store.getPush(pushId);
    if (status === null) {
      return yield* Effect.fail(new DeploymentPushNotFoundError({ pushId }));
    }
    return status;
  },
);

export const requireActiveDeployment = Effect.fn("DeploymentService.requireActiveDeployment")(
  function* (
    store: DeploymentActiveDeploymentReader,
  ): Effect.fn.Return<
    ActiveDeploymentStatus,
    | DeploymentActiveDeploymentInvalidError
    | DeploymentActiveDeploymentNotFoundError
    | DeploymentSqlError
    | DeploymentValidationError
  > {
    const active = yield* store.getActiveDeployment();
    if (active === null) {
      return yield* Effect.fail(new DeploymentActiveDeploymentNotFoundError());
    }
    return active;
  },
);

export const deploymentExecutionArtifactRefForPush = Effect.fn(
  "DeploymentService.deploymentExecutionArtifactRefForPush",
)(function* (
  artifacts: DeploymentArtifactResolver,
  status: PushStatus,
): Effect.fn.Return<ExecutionArtifactRef, DeploymentArtifactRefError> {
  return yield* artifacts.executionArtifactRefForSourcePackage(status.sourcePackage);
});

export const startAnalyzedDeploymentPushStoreInput = Effect.fn(
  "DeploymentService.startAnalyzedDeploymentPushStoreInput",
)(function* (
  ids: DeploymentIdReader,
  clock: DeploymentClockReader,
  input: StartAnalyzedPushInput,
): Effect.fn.Return<StartAnalyzedPushStoreInput> {
  const now = yield* clock.currentTimeMillis;
  const pushId = yield* ids.pushId;
  if ("analysis" in input) {
    return {
      pushId,
      now,
      sourcePackage: input.sourcePackage,
      analysis: input.analysis,
      codegenAnalysis: input.codegenAnalysis,
      diagnostics: input.diagnostics,
    };
  }
  return {
    pushId,
    now,
    sourcePackage: input.sourcePackage,
    error: input.error,
    diagnostics: input.diagnostics,
  };
});

export const finishDeploymentPushStoreInput = Effect.fn(
  "DeploymentService.finishDeploymentPushStoreInput",
)(function* (
  store: DeploymentPushReader,
  artifacts: DeploymentArtifactResolver,
  clock: DeploymentClockReader,
  pushId: string,
): Effect.fn.Return<
  FinishPushStoreInput,
  | DeploymentArtifactRefError
  | DeploymentPushNotFoundError
  | DeploymentSqlError
  | DeploymentValidationError
> {
  const preflight = yield* requireDeploymentPush(store, pushId);
  const executionArtifactRef = yield* deploymentExecutionArtifactRefForPush(artifacts, preflight);
  const now = yield* clock.currentTimeMillis;
  return {
    pushId,
    now,
    executionArtifactRef,
  };
});

export const abandonDeploymentPushStoreInput = Effect.fn(
  "DeploymentService.abandonDeploymentPushStoreInput",
)(function* (
  store: DeploymentPushReader,
  clock: DeploymentClockReader,
  pushId: string,
  request: AbandonPushRequest,
): Effect.fn.Return<
  AbandonPushStoreInput,
  | DeploymentPushInvalidStateError
  | DeploymentPushNotFoundError
  | DeploymentSqlError
  | DeploymentValidationError
> {
  const status = yield* requireDeploymentPush(store, pushId);
  yield* ensureDeploymentPushCanBeAbandoned(status);
  const now = yield* clock.currentTimeMillis;
  const reason = yield* normalizeDeploymentAbandonReason(request);
  return {
    pushId,
    now,
    reason,
  };
});

export const ensureDeploymentPushCanBeAbandoned = Effect.fn(
  "DeploymentService.ensureDeploymentPushCanBeAbandoned",
)(function* (
  status: PushStatus,
): Effect.fn.Return<void, DeploymentPushInvalidStateError> {
  if (status.state !== "pending" && status.state !== "analyzed") {
    return yield* Effect.fail(new DeploymentPushInvalidStateError({
      action: "abandon",
      pushId: status.pushId,
      state: status.state,
    }));
  }
});

export const normalizeDeploymentAbandonReason = Effect.fn(
  "DeploymentService.normalizeDeploymentAbandonReason",
)(function* (
  request: AbandonPushRequest,
): Effect.fn.Return<string> {
  return typeof request.reason === "string" && request.reason.length > 0
    ? request.reason.slice(0, 1000)
    : "Push abandoned before activation.";
});

export class DeploymentService extends Context.Service<DeploymentService, DeploymentServiceApi>()(
  "flarex-backend/deployment/DeploymentService",
) {
  static readonly layer = Layer.effect(
    DeploymentService,
    Effect.gen(function* () {
      const clock = yield* DeploymentClock;
      const ids = yield* DeploymentIds;
      const artifacts = yield* DeploymentArtifacts;
      const store = yield* DeploymentPushStore;

      const getActiveDeployment = Effect.fn("DeploymentService.getActiveDeployment")(
        function* (): Effect.fn.Return<
          ActiveDeploymentStatus,
          | DeploymentActiveDeploymentInvalidError
          | DeploymentActiveDeploymentNotFoundError
          | DeploymentSqlError
          | DeploymentValidationError
        > {
          return yield* requireActiveDeployment(store);
        },
      );

      const getPush = Effect.fn("DeploymentService.getPush")(
        function* (
          pushId: string,
        ): Effect.fn.Return<PushStatus, DeploymentPushNotFoundError | DeploymentSqlError | DeploymentValidationError> {
          return yield* requireDeploymentPush(store, pushId);
        },
      );

      const startAnalyzedPush = Effect.fn("DeploymentService.startAnalyzedPush")(
        function* (
          input: StartAnalyzedPushInput,
        ): Effect.fn.Return<PushStatus, DeploymentSqlError | DeploymentStoredPushMissingError | DeploymentValidationError> {
          const storeInput = yield* startAnalyzedDeploymentPushStoreInput(ids, clock, input);
          return yield* store.startAnalyzedPush(storeInput);
        },
      );

      const finishPush = Effect.fn("DeploymentService.finishPush")(
        function* (
          pushId: string,
        ): Effect.fn.Return<
          FinishPushResponse,
          | DeploymentArtifactRefError
          | DeploymentPushNotFoundError
          | DeploymentSqlError
          | DeploymentStoredPushMissingError
          | DeploymentValidationError
        > {
          const input = yield* finishDeploymentPushStoreInput(store, artifacts, clock, pushId);
          return yield* store.finishPush(input);
        },
      );

      const abandonPush = Effect.fn("DeploymentService.abandonPush")(
        function* (
          pushId: string,
          request: AbandonPushRequest,
        ): Effect.fn.Return<
          PushStatus,
          | DeploymentPushNotFoundError
          | DeploymentPushInvalidStateError
          | DeploymentSqlError
          | DeploymentStoredPushMissingError
          | DeploymentValidationError
        > {
          const input = yield* abandonDeploymentPushStoreInput(store, clock, pushId, request);
          return yield* store.abandonPush(input);
        },
      );

      return DeploymentService.of({
        getActiveDeployment,
        getPush,
        startAnalyzedPush,
        finishPush,
        abandonPush,
      });
    }),
  );
}
