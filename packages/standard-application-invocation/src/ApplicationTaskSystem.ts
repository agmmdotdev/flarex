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
import type {
  TaskExecutionPrincipalIdentity,
  TaskExecutionPrincipalIssuer,
  TaskExecutionPrincipalStoreError,
} from "flarex-backend/internal/task-execution-principal-store";
import { Context, Data, Effect, Layer } from "effect";

type ApplicationTaskRunCreationRequest = Parameters<
  ApplicationTaskSystemRunCreationStore["createSelectedRun"]
>[1];
type ApplicationTaskRunCreationReceipt = Effect.Success<
  ReturnType<ApplicationTaskSystemRunCreationStore["createRun"]>
>;
export type ApplicationTaskRunRequest = Omit<
  ApplicationTaskRunCreationRequest,
  "applicationTaskRuntimeTargetSha256" | "principal"
> & Readonly<{
  readonly executionIdentity: TaskExecutionPrincipalIdentity;
}>;

export interface ApplicationTaskSystemLive {
  readonly activation: Pick<
    ApplicationActivationRepository<unknown, unknown>,
    "readActive"
  >;
  readonly selection: ApplicationTaskSelectionContext;
  readonly creation: ApplicationTaskSystemRunCreationStore;
  readonly principalIssuer: TaskExecutionPrincipalIssuer;
}

type ActivationReadError = Effect.Error<
  ReturnType<ApplicationTaskSystemLive["activation"]["readActive"]>
>;

export type CreateApplicationTaskRunError =
  | ActivationReadError
  | SelectApplicationTaskError
  | ApplicationTaskSystemRunCreationError
  | TaskExecutionPrincipalStoreError
  | ApplicationTaskSystemCompositionError;

export class ApplicationTaskSystemCompositionError extends Data.TaggedError(
  "ApplicationTaskSystemCompositionError",
)<{ readonly reason: "principalScopeMismatch" }> {}

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
          const principal = yield* captured.principalIssuer
            .issueAuthenticatedUser(request.executionIdentity);
          const persistedRequest = Object.freeze({
            version: request.version,
            requestKey: request.requestKey,
            input: request.input,
            principal,
          });
          const replay = yield* captured.creation.replayRun(
            taskId,
            persistedRequest,
          );
          if (replay !== null) return replay;
          const active = yield* captured.activation.readActive();
          const selected = yield* selectApplicationTask(
            active.selection,
            taskId,
            captured.selection,
          );
          if (
            selected.metadata.basis.authority.scopeId !==
              captured.principalIssuer.scopeId
          ) {
            return yield* new ApplicationTaskSystemCompositionError({
              reason: "principalScopeMismatch",
            });
          }
          return yield* captured.creation.createSelectedRun(
            selected.selection,
            persistedRequest,
          );
        },
      ),
    }),
  );
}

function captureLive(live: ApplicationTaskSystemLive): ApplicationTaskSystemLive {
  const activationOwner = live.activation;
  const creationOwner = live.creation;
  const principalIssuerOwner = live.principalIssuer;
  const readActive: ApplicationTaskSystemLive["activation"]["readActive"] =
    () => activationOwner.readActive();
  const replayRun: ApplicationTaskSystemRunCreationStore["replayRun"] =
    (taskId, request) => creationOwner.replayRun(taskId, request);
  const createRun: ApplicationTaskSystemRunCreationStore["createRun"] =
    (taskId, request) => creationOwner.createRun(taskId, request);
  const createSelectedRun:
    ApplicationTaskSystemRunCreationStore["createSelectedRun"] =
      (selection, request) =>
        creationOwner.createSelectedRun(selection, request);
  const issueAuthenticatedUser:
    TaskExecutionPrincipalIssuer["issueAuthenticatedUser"] = identity =>
      principalIssuerOwner.issueAuthenticatedUser(identity);
  return Object.freeze({
    activation: Object.freeze({ readActive }),
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
      replayRun,
      createRun,
      createSelectedRun,
    }),
    principalIssuer: Object.freeze({
      scopeId: principalIssuerOwner.scopeId,
      issueAuthenticatedUser,
    }),
  });
}
