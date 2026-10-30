import {
  readCoreApplicationProgram,
  readCoreApplicationTableBindings,
  validateCoreApplicationArguments,
} from "@flarex/persistence-postgres/internal/core-application-program";
import { captureExecutionDiagnosticContext } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { Clock, Context, Data, Effect, Exit, Cause } from "effect";
import { makeApplicationWorkerDefinition } from "flarex-backend/internal/application-worker-definition";
import type { DocumentObject } from "flarex-protocol/document-value";
import {
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
  decodeApplicationTransactionWorkerRequestV1Effect,
  type ApplicationWorkerAuthV1,
} from "flarex-protocol/internal/application-worker-v1";

import { makeCoreApplicationReadSession } from "./CoreApplicationReadSession";
import type { ApplicationCoreMutationSystemLive } from "./ApplicationMutationSystem";

/** Trusted app-lifetime composition shared with fresh mutation execution. */
export type ApplicationCoreQuerySystemLive = Pick<ApplicationCoreMutationSystemLive,
  "coreDatabase" | "admission" | "applicationRunner" | "executionContextFactory" | "queryCursor">;

export class CoreApplicationQueryError extends Data.TaggedError("CoreApplicationQueryError")<{
  readonly reason: "functionUnsupported" | "invalidComposition" | "sourceReadFailed"
    | "workerDefinitionFailed" | "invalidExecutionContext";
  readonly cause?: unknown;
}> {}

/** A query borrows the retained database; it never claims or publishes an outcome. */
export function makeCoreApplicationQueryRunner(configuration: ApplicationCoreQuerySystemLive) {
  const database = configuration.coreDatabase;
  const runner = configuration.applicationRunner;
  return Effect.fn("CoreApplicationQueryRunner.execute")(function* (
    functionPath: string,
    argumentsValue: DocumentObject,
    argumentSemanticBytes: number,
    auth: ApplicationWorkerAuthV1,
  ) {
    return yield* configuration.admission.withPermit("query", Effect.acquireUseRelease(database.beginQuery(functionPath), operation => Effect.gen(function* () {
      const program = yield* readCoreApplicationProgram(operation.program, runner.sha256);
      const target = program.runtimeTarget;
      if (program.kind !== "query" || target.function.visibility !== "public")
        return yield* new CoreApplicationQueryError({ reason: "functionUnsupported" });
      if (program.scopeUuid !== configuration.queryCursor.scopeUuid)
        return yield* new CoreApplicationQueryError({ reason: "invalidComposition" });
      const tables = yield* readCoreApplicationTableBindings(operation.transaction);
      yield* Effect.fromResult(validateCoreApplicationArguments(target.function.args, argumentsValue, tables));
      const source = yield* runner.source.read(target.sourceArtifactRootSha256).pipe(
        Effect.mapError(cause => new CoreApplicationQueryError({ reason: "sourceReadFailed", cause })),
      );
      const definition = yield* Effect.try({ try: () => makeApplicationWorkerDefinition({
        source, target, manifest: program.manifest, hostPolicy: runner.hostPolicy,
        hostPolicySha256: runner.hostPolicySha256, compatibilityDate: program.compatibilityDate,
        documentIdFormat: "convex",
      }), catch: cause => new CoreApplicationQueryError({ reason: "workerDefinitionFailed", cause }) });
      const context = yield* configuration.executionContextFactory.make();
      const request = yield* decodeApplicationTransactionWorkerRequestV1Effect({
        format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
        version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
        target, auth, arguments: argumentsValue, argumentSemanticBytes, tables,
        context: { mode: "query", executionId: context.executionId, randomSeed: context.randomSeed,
          executionTime: operation.transaction.unixTime, snapshotTimestamp: operation.transaction.timestamp },
      }, "convex").pipe(Effect.mapError(cause => new CoreApplicationQueryError({ reason: "invalidExecutionContext", cause })));
      const callbackContext = yield* Effect.withFiber(fiber => Effect.succeed(Context.add(
        captureExecutionDiagnosticContext(fiber), Clock.Clock, Context.get(fiber.context, Clock.Clock),
      )));
      const session = makeCoreApplicationReadSession({ transaction: operation.transaction,
        revalidate: database.assertOpen }, callbackContext, configuration.queryCursor.broker, configuration.admission);
      const value = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        const host = yield* Effect.exit(restore(runner.host.runTransaction({ definition, request, capability: session.target })));
        const drained = yield* Effect.exit(session.closeAndDrain);
        if (Exit.isFailure(host)) return yield* Effect.failCause(Exit.isFailure(drained)
          ? Cause.combine(host.cause, drained.cause) : host.cause);
        if (Exit.isFailure(drained)) return yield* Effect.failCause(drained.cause);
        return host.value;
      }));
      yield* operation.finish();
      return value;
    }), operation => operation.abort()));
  });
}
