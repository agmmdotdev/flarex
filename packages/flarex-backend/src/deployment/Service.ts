import { Context, Effect, Layer } from "effect";
import type {
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  PushDiagnostic,
  PushSourcePackage,
  PushStatus,
} from "../types";
import { DeploymentClock, DeploymentIds } from "./Runtime";
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

export class DeploymentService extends Context.Service<DeploymentService, {
  startAnalyzedPush(input: StartAnalyzedPushInput): Effect.Effect<PushStatus, DeploymentSqlError>;
}>()("flarex-backend/deployment/DeploymentService") {
  static readonly layer = Layer.effect(
    DeploymentService,
    Effect.gen(function* () {
      const clock = yield* DeploymentClock;
      const ids = yield* DeploymentIds;
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

      return DeploymentService.of({
        startAnalyzedPush,
      });
    }),
  );
}
