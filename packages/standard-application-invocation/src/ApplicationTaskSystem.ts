import type { ApplicationActivationRepository } from
  "@flarex/persistence-postgres/internal/application-activation";
import {
  selectApplicationTask,
  type ApplicationTaskSelectionContext,
  type SelectApplicationTaskError,
} from "@flarex/persistence-postgres/internal/application-task-selection";
import type {
  ApplicationTaskSystemRunCreationError,
  ApplicationTaskSystemRunCreationStore,
} from
  "@flarex/persistence-postgres/internal/application-task-system-run-creation";
import { Context, Effect, Layer } from "effect";

type ApplicationTaskRunCreationRequest = Parameters<
  ApplicationTaskSystemRunCreationStore["createSelectedRun"]
>[1];
type ApplicationTaskRunCreationReceipt = Effect.Success<
  ReturnType<ApplicationTaskSystemRunCreationStore["createRun"]>
>;
export type ApplicationTaskRunRequest = Omit<
  ApplicationTaskRunCreationRequest,
  "applicationTaskRuntimeTargetSha256"
>;

export interface ApplicationTaskSystemLive {
  readonly activation: Pick<
    ApplicationActivationRepository<unknown, unknown>,
    "readActive"
  >;
  readonly selection: ApplicationTaskSelectionContext;
  readonly creation: ApplicationTaskSystemRunCreationStore;
}

type ActivationReadError = Effect.Error<
  ReturnType<ApplicationTaskSystemLive["activation"]["readActive"]>
>;

export type CreateApplicationTaskRunError =
  | ActivationReadError
  | SelectApplicationTaskError
  | ApplicationTaskSystemRunCreationError;

export interface ApplicationTaskSystemApi {
  readonly createRun: (
    taskId: unknown,
    request: ApplicationTaskRunRequest,
  ) => Effect.Effect<
    ApplicationTaskRunCreationReceipt,
    CreateApplicationTaskRunError
  >;
}

export class ApplicationTaskSystem extends Context.Service<
  ApplicationTaskSystem,
  ApplicationTaskSystemApi
>()("flarex/standard-application-invocation/ApplicationTaskSystem") {}

export const createApplicationTaskRun = Effect.fn(
  "ApplicationTaskSystem.createRun",
)(function* (
  taskId: unknown,
  request: ApplicationTaskRunRequest,
): Effect.fn.Return<
  ApplicationTaskRunCreationReceipt,
  CreateApplicationTaskRunError,
  ApplicationTaskSystem
> {
  const system = yield* ApplicationTaskSystem;
  return yield* system.createRun(taskId, request);
});

export function makeApplicationTaskSystemLayer(
  live: ApplicationTaskSystemLive,
): Layer.Layer<ApplicationTaskSystem> {
  const captured = captureLive(live);
  return Layer.succeed(
    ApplicationTaskSystem,
    ApplicationTaskSystem.of({
      createRun: Effect.fn("ApplicationTaskSystem.createRunLive")(
        function* (taskId, request) {
          const replay = yield* captured.creation.replayRun(taskId, request);
          if (replay !== null) return replay;
          const active = yield* captured.activation.readActive();
          const selected = yield* selectApplicationTask(
            active.selection,
            taskId,
            captured.selection,
          );
          return yield* captured.creation.createSelectedRun(
            selected.selection,
            request,
          );
        },
      ),
    }),
  );
}

function captureLive(live: ApplicationTaskSystemLive): ApplicationTaskSystemLive {
  return Object.freeze({
    activation: Object.freeze({ readActive: live.activation.readActive }),
    selection: Object.freeze({
      deploymentId: live.selection.deploymentId,
      runtimeHostIdentity: live.selection.runtimeHostIdentity,
      compatibilityDate: live.selection.compatibilityDate,
      authority: Object.freeze({
        scopeMetadata: live.selection.authority.scopeMetadata,
        provisioningReceipts: live.selection.authority.provisioningReceipts,
        scopeClockTargets: live.selection.authority.scopeClockTargets,
      }),
    }),
    creation: Object.freeze({
      replayRun: live.creation.replayRun,
      createRun: live.creation.createRun,
      createSelectedRun: live.creation.createSelectedRun,
    }),
  });
}
