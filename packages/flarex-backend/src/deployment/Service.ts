import { Context, Effect, Layer, Schema } from "effect";
import type { HttpError } from "../http";
import type {
  AbandonPushRequest,
  ActiveDeploymentStatus,
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  FinishPushResponse,
  PushDiagnostic,
  PushSourcePackage,
  PushStatus,
} from "../types";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "./Runtime";
import { DeploymentPushStore, type DeploymentSqlError } from "./Store";

export type StartAnalyzedPushInput = {
  readonly sourcePackage: PushSourcePackage;
  readonly diagnostics: ReadonlyArray<PushDiagnostic>;
} & (
  | {
      readonly analysis: DeploymentAnalysis;
      readonly codegenAnalysis: DeploymentCodegenAnalysis;
    }
  | {
      readonly error: string;
    }
);

export class DeploymentPushNotFoundError extends Schema.TaggedErrorClass<DeploymentPushNotFoundError>()(
  "DeploymentPushNotFoundError",
  {
    pushId: Schema.String,
  },
) {}

export class DeploymentPushInvalidStateError extends Schema.TaggedErrorClass<DeploymentPushInvalidStateError>()(
  "DeploymentPushInvalidStateError",
  {
    action: Schema.Literal("abandon"),
    pushId: Schema.String,
    state: Schema.String,
  },
) {}

export class DeploymentActiveDeploymentNotFoundError extends Schema.TaggedErrorClass<DeploymentActiveDeploymentNotFoundError>()(
  "DeploymentActiveDeploymentNotFoundError",
  {},
) {}

export class DeploymentService extends Context.Service<DeploymentService, {
  getActiveDeployment(): Effect.Effect<
    ActiveDeploymentStatus,
    DeploymentActiveDeploymentNotFoundError | DeploymentSqlError | HttpError
  >;
  startAnalyzedPush(input: StartAnalyzedPushInput): Effect.Effect<PushStatus, DeploymentSqlError>;
  finishPush(pushId: string): Effect.Effect<
    FinishPushResponse,
    DeploymentPushNotFoundError | DeploymentSqlError | HttpError
  >;
  abandonPush(pushId: string, request: AbandonPushRequest): Effect.Effect<
    PushStatus,
    DeploymentPushNotFoundError | DeploymentPushInvalidStateError | DeploymentSqlError | HttpError
  >;
}>()("flarex-backend/deployment/DeploymentService") {
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
          DeploymentActiveDeploymentNotFoundError | DeploymentSqlError | HttpError
        > {
          const active = yield* store.getActiveDeployment();
          if (active === null) {
            return yield* Effect.fail(new DeploymentActiveDeploymentNotFoundError());
          }
          return active;
        },
      );

      const startAnalyzedPush = Effect.fn("DeploymentService.startAnalyzedPush")(
        function* (input: StartAnalyzedPushInput): Effect.fn.Return<PushStatus, DeploymentSqlError> {
          const now = yield* clock.currentTimeMillis;
          const pushId = yield* ids.pushId;
          if ("analysis" in input) {
            return yield* store.startAnalyzedPush({
              pushId,
              now,
              sourcePackage: input.sourcePackage,
              analysis: input.analysis,
              codegenAnalysis: input.codegenAnalysis,
              diagnostics: input.diagnostics,
            });
          }
          return yield* store.startAnalyzedPush({
            pushId,
            now,
            sourcePackage: input.sourcePackage,
            error: input.error,
            diagnostics: input.diagnostics,
          });
        },
      );

      const finishPush = Effect.fn("DeploymentService.finishPush")(
        function* (
          pushId: string,
        ): Effect.fn.Return<FinishPushResponse, DeploymentPushNotFoundError | DeploymentSqlError | HttpError> {
          const preflight = yield* store.getPush(pushId);
          if (preflight === null) {
            return yield* Effect.fail(new DeploymentPushNotFoundError({ pushId }));
          }
          const executionArtifactRef = yield* artifacts.executionArtifactRefForSourcePackage(preflight.sourcePackage);
          const now = yield* clock.currentTimeMillis;
          return yield* store.finishPush({
            pushId,
            now,
            executionArtifactRef,
          });
        },
      );

      const abandonPush = Effect.fn("DeploymentService.abandonPush")(
        function* (
          pushId: string,
          request: AbandonPushRequest,
        ): Effect.fn.Return<
          PushStatus,
          DeploymentPushNotFoundError | DeploymentPushInvalidStateError | DeploymentSqlError | HttpError
        > {
          const status = yield* store.getPush(pushId);
          if (status === null) {
            return yield* Effect.fail(new DeploymentPushNotFoundError({ pushId }));
          }
          if (status.state !== "pending" && status.state !== "analyzed") {
            return yield* Effect.fail(new DeploymentPushInvalidStateError({
              action: "abandon",
              pushId,
              state: status.state,
            }));
          }
          const now = yield* clock.currentTimeMillis;
          const reason = typeof request.reason === "string" && request.reason.length > 0
            ? request.reason.slice(0, 1000)
            : "Push abandoned before activation.";
          return yield* store.abandonPush({
            pushId,
            now,
            reason,
          });
        },
      );

      return DeploymentService.of({
        getActiveDeployment,
        startAnalyzedPush,
        finishPush,
        abandonPush,
      });
    }),
  );
}
