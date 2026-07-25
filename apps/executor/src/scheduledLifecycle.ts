import type {
  PointMutationRedeliverySchedulerHostRunV1,
} from "@flarex/executor/point-mutation-redelivery-scheduler-host-contract";
import { isNonBlankString } from "@flarex/utils/strings";
import { Cause, Data, Effect, Exit } from "effect";

import {
  reportSecondaryCleanupError,
  type ExecutorCleanupErrorReporter,
} from "./cleanupReporting";
import type {
  ExecutorDatabaseClient,
  ExecutorWorkerEnv,
} from "./requestLifecycle";

export class HostedExecutorScheduledEventConfigurationV1Error
  extends Data.TaggedError(
    "HostedExecutorScheduledEventConfigurationV1Error",
  )<{
    readonly reason: "missingHyperdrive";
  }> {}

export class HostedExecutorScheduledEventDatabaseClientV1Error
  extends Data.TaggedError(
    "HostedExecutorScheduledEventDatabaseClientV1Error",
  )<{
    readonly operation: "connect" | "end";
    readonly cause: unknown;
  }> {}

export interface ExecutorScheduledEventRunFactoryInput<
  Client extends ExecutorDatabaseClient,
> {
  readonly client: Client;
}

export interface ExecutorScheduledEventCleanupErrorInput {
  readonly primaryCause: Cause.Cause<unknown>;
  readonly cleanupError: HostedExecutorScheduledEventDatabaseClientV1Error;
}

export interface ExecutorScheduledEventHostDependencies<
  Client extends ExecutorDatabaseClient,
  RunFailure,
> {
  createClient(connectionString: string): Client;
  createRun(
    input: ExecutorScheduledEventRunFactoryInput<Client>,
  ): PointMutationRedeliverySchedulerHostRunV1<RunFailure>;
  onCleanupError?: ExecutorCleanupErrorReporter<
    ExecutorScheduledEventCleanupErrorInput
  >;
}

export interface ExecutorScheduledEventHost {
  scheduled(
    controller: ScheduledController,
    env: ExecutorWorkerEnv,
  ): Promise<void>;
}

export function createExecutorScheduledEventHost<
  Client extends ExecutorDatabaseClient,
  RunFailure,
>(
  dependencies: ExecutorScheduledEventHostDependencies<Client, RunFailure>,
): ExecutorScheduledEventHost {
  const runEvent = Effect.fn(
    "ExecutorScheduledEventHost.runEvent",
  )(function* (connectionString: string) {
    yield* Effect.acquireUseRelease(
      Effect.sync(() => dependencies.createClient(connectionString)),
      (client) =>
        Effect.gen(function* () {
          yield* connectClientEffect(client);
          const run = dependencies.createRun({ client });
          yield* run.runEffect();
        }),
      (client, exit) => closeClientEffect(client).pipe(
        Effect.catch((cleanupError) =>
          Exit.isSuccess(exit)
            ? Effect.fail(cleanupError)
            : Effect.promise(() =>
              reportSecondaryCleanupError(dependencies.onCleanupError, {
                primaryCause: exit.cause,
                cleanupError,
              })
            )
        ),
      ),
    );
  });

  return Object.freeze({
    scheduled: async (
      controller: ScheduledController,
      env: ExecutorWorkerEnv,
    ): Promise<void> => {
      const connectionString =
        env.HYPERDRIVE_CACHE_DISABLED?.connectionString;
      if (!isNonBlankString(connectionString)) {
        controller.noRetry();
        throw new HostedExecutorScheduledEventConfigurationV1Error({
          reason: "missingHyperdrive",
        });
      }
      await Effect.runPromise(runEvent(connectionString));
    },
  });
}

function connectClientEffect(
  client: ExecutorDatabaseClient,
): Effect.Effect<
  void,
  HostedExecutorScheduledEventDatabaseClientV1Error
> {
  return Effect.tryPromise({
    try: () => client.connect(),
    catch: (cause) =>
      new HostedExecutorScheduledEventDatabaseClientV1Error({
        operation: "connect",
        cause,
      }),
  }).pipe(Effect.asVoid);
}

function closeClientEffect(
  client: ExecutorDatabaseClient,
): Effect.Effect<
  void,
  HostedExecutorScheduledEventDatabaseClientV1Error
> {
  return Effect.tryPromise({
    try: () => client.end(),
    catch: (cause) =>
      new HostedExecutorScheduledEventDatabaseClientV1Error({
        operation: "end",
        cause,
      }),
  });
}
