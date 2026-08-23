import type {
  StandardApplicationTaskReferenceV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import type {
  TaskInputStore,
  TaskInputStoreError,
} from "flarex-backend/internal/task-input-store";
import { Context, Effect, Layer } from "effect";

import {
  ApplicationTaskSystem,
  type ApplicationTaskRunRequest,
  type ApplicationTaskSystemApi,
  type CreateApplicationTaskRunError,
} from "./ApplicationTaskSystem.js";

export type StandardApplicationTaskRunCreationReceipt = Effect.Success<
  ReturnType<ApplicationTaskSystemApi["createRun"]>
>;

export interface StandardApplicationTaskRunRequestV1<Payload> {
  readonly version: ApplicationTaskRunRequest["version"];
  readonly requestKey: ApplicationTaskRunRequest["requestKey"];
  readonly payload: Payload;
  readonly executionIdentity: ApplicationTaskRunRequest["executionIdentity"];
}

export type CreateStandardApplicationTaskRunError =
  | TaskInputStoreError
  | CreateApplicationTaskRunError;

export interface StandardApplicationTaskSystemApi {
  readonly createRun: <Payload, Output>(
    reference: StandardApplicationTaskReferenceV1<Payload, Output>,
    request: StandardApplicationTaskRunRequestV1<NoInfer<Payload>>,
  ) => Effect.Effect<
    StandardApplicationTaskRunCreationReceipt,
    CreateStandardApplicationTaskRunError
  >;
}

export class StandardApplicationTaskSystem extends Context.Service<
  StandardApplicationTaskSystem,
  StandardApplicationTaskSystemApi
>()(
  "flarex/standard-application-invocation/StandardApplicationTaskSystem",
) {}

export const createStandardApplicationTaskRun = Effect.fn(
  "StandardApplicationTaskSystem.createRun",
)(function* <Payload, Output>(
  reference: StandardApplicationTaskReferenceV1<Payload, Output>,
  request: StandardApplicationTaskRunRequestV1<NoInfer<Payload>>,
): Effect.fn.Return<
  StandardApplicationTaskRunCreationReceipt,
  CreateStandardApplicationTaskRunError,
  StandardApplicationTaskSystem
> {
  const system = yield* StandardApplicationTaskSystem;
  return yield* system.createRun(reference, request);
});

export function makeStandardApplicationTaskSystemLayer(
  inputStore: Pick<TaskInputStore, "publish">,
): Layer.Layer<
  StandardApplicationTaskSystem,
  never,
  ApplicationTaskSystem
> {
  const inputStoreOwner = inputStore;
  const publish: TaskInputStore["publish"] = value =>
    inputStoreOwner.publish(value);

  return Layer.effect(
    StandardApplicationTaskSystem,
    Effect.gen(function* () {
      const applicationTaskSystem = yield* ApplicationTaskSystem;
      return StandardApplicationTaskSystem.of({
        createRun: Effect.fn("StandardApplicationTaskSystem.createRunLive")(
          function* (reference, request) {
            const input = yield* publish(request.payload);
            return yield* applicationTaskSystem.createRun(
              reference.taskId,
              Object.freeze({
                version: request.version,
                requestKey: request.requestKey,
                input,
                executionIdentity: request.executionIdentity,
              }),
            );
          },
        ),
      });
    }),
  );
}
