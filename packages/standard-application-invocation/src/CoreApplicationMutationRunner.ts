import {
  makeApplicationWorkerDefinition,
} from "flarex-backend/internal/application-worker-definition";
import {
  mapApplicationPointMutationHostFailure,
  projectApplicationAuth,
} from "flarex-backend/internal/application-point-mutation-runner";
import {
  CoreApplicationMutationError,
  type CoreApplicationMutationConfiguration,
} from "@flarex/persistence-postgres/internal/core-application-mutation";
import { Cause, Clock, Context, Effect, Exit } from "effect";
import { captureExecutionDiagnosticContext } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import type { QueryCursorBroker } from "flarex-protocol/query-cursor";
import { inspectVerifiedApplicationMutationGrantV1 } from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
  decodeApplicationTransactionWorkerRequestV1Effect,
} from "flarex-protocol/internal/application-worker-v1";

import type { ApplicationMutationSystemLive } from "./ApplicationMutationSystem";
import { makeCoreApplicationReadSession } from "./CoreApplicationReadSession";

type CoreBodyInput = Parameters<CoreApplicationMutationConfiguration<never, never>["execute"]>[0];
/** Host projection and RPC lifetime, separate from shared transaction authority. */
export function makeCoreApplicationMutationRunner(configuration: Readonly<{
  applicationRunner: ApplicationMutationSystemLive["applicationRunner"];
  executionContextFactory: ApplicationMutationSystemLive["executionContextFactory"];
  queryCursor: Readonly<{ scopeUuid: string; broker: QueryCursorBroker }>;
}>) {
  const execute = Effect.fn("CoreApplicationMutationRunner.execute")(function* (input: CoreBodyInput) {
    const runner = configuration.applicationRunner;
    if (input.program.scopeUuid !== configuration.queryCursor.scopeUuid)
      return yield* new CoreApplicationMutationError({ reason: "metadataInvalid" });
    const target = input.program.executionAuthority.authority.runtimeTarget;
    const source = yield* runner.source.read(target.sourceArtifactRootSha256).pipe(
      Effect.mapError(cause => new CoreApplicationMutationError({ reason: "metadataInvalid", cause })),
    );
    const definition = yield* Effect.try({ try: () => makeApplicationWorkerDefinition({
      source, target, manifest: input.program.manifest, hostPolicy: runner.hostPolicy,
      hostPolicySha256: runner.hostPolicySha256, compatibilityDate: input.program.compatibilityDate,
      documentIdFormat: "convex",
    }), catch: cause => new CoreApplicationMutationError({ reason: "metadataInvalid", cause }) });
    const context = yield* configuration.executionContextFactory.make();
    const grant = inspectVerifiedApplicationMutationGrantV1(input.grant).payload;
    const request = yield* decodeApplicationTransactionWorkerRequestV1Effect({
      format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
      version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
      target, auth: projectApplicationAuth(grant.auth), arguments: input.arguments,
      argumentSemanticBytes: input.argumentSemanticBytes,
      tables: input.tables,
      context: { mode: "write", executionId: context.executionId, logScopeId: context.logScopeId,
        randomSeed: context.randomSeed, executionTime: input.transaction.unixTime,
        initialCreationTimeCursor: input.transaction.unixTime },
    }).pipe(Effect.mapError(cause => new CoreApplicationMutationError({ reason: "metadataInvalid", cause })));
    const callbackContext = yield* Effect.withFiber(fiber => Effect.succeed(Context.add(
      captureExecutionDiagnosticContext(fiber), Clock.Clock, Context.get(fiber.context, Clock.Clock),
    )));
    const session = makeCoreApplicationReadSession(input, callbackContext, configuration.queryCursor.broker);
    const capability = Object.freeze({
      ...session.target,
      insertPointDocument: (table: string, value: unknown) => session.run(() => input.transaction.insert(table, value)),
      patchPointDocument: (id: string, value: unknown) => session.run(() => input.transaction.patch(id, value)),
      replacePointDocument: (id: string, value: unknown) => session.run(() => input.transaction.replace(id, value)),
      deletePointDocument: (id: string) => session.run(() => input.transaction.delete(id)),
    });
    return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const host = yield* Effect.exit(restore(runner.host.runTransaction({ definition, request, capability })).pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapApplicationPointMutationHostFailure))),
      ));
      const drained = yield* Effect.exit(session.closeAndDrain);
      if (Exit.isFailure(host)) return yield* Effect.failCause(Exit.isFailure(drained)
        ? Cause.combine(host.cause, drained.cause) : host.cause);
      if (Exit.isFailure(drained)) return yield* Effect.failCause(drained.cause);
      return host.value;
    }));
  });
  return execute;
}
