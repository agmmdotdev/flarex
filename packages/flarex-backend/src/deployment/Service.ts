import { Context, Effect, Layer, Schema } from "effect";
import type { HttpError } from "../http";
import type {
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

export class DeploymentService extends Context.Service<DeploymentService, {
  startAnalyzedPush(input: StartAnalyzedPushInput): Effect.Effect<PushStatus, DeploymentSqlError>;
  finishPush(pushId: string): Effect.Effect<
    FinishPushResponse,
    DeploymentPushNotFoundError | DeploymentSqlError | HttpError
  >;
}>()("flarex-backend/deployment/DeploymentService") {
  static readonly layer = Layer.effect(
    DeploymentService,
    Effect.gen(function* () {
      const clock = yield* DeploymentClock;
      const ids = yield* DeploymentIds;
      const artifacts = yield* DeploymentArtifacts;
      const store = yield* DeploymentPushStore;

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

      return DeploymentService.of({
        startAnalyzedPush,
        finishPush,
      });
    }),
  );
}
