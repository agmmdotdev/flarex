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
import { CoreTransactionError, type CoreTransaction } from "@flarex/persistence-postgres/internal/core";
import { captureExecutionDiagnosticContext } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import type { QueryCursorBroker } from "flarex-protocol/query-cursor";
import { inspectVerifiedApplicationMutationGrantV1 } from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
  decodeApplicationTransactionWorkerRequestV1Effect,
} from "flarex-protocol/internal/application-worker-v1";
import { decodeAdmittedFrameworkOperationV1Result, type AdmittedFrameworkOperationV1 } from "flarex-protocol/internal/admitted-framework-operation-v1";
import type { Json } from "flarex-protocol/json";

import type { ApplicationMutationSystemLive } from "./ApplicationMutationSystem";
import { makeCoreApplicationReadSession } from "./CoreApplicationReadSession";
import type { CoreApplicationAdmission } from "./CoreApplicationAdmission";

type CoreBodyInput = Parameters<CoreApplicationMutationConfiguration<never, never>["execute"]>[0];
export type CoreWorkerMutationOperations = Pick<CoreTransaction, "unixTime" | "tableNumber" | "get" | "startQuery"
  | "insert" | "patch" | "replace" | "delete">;
interface RunnerConfiguration {
  readonly applicationRunner: ApplicationMutationSystemLive["applicationRunner"];
  readonly executionContextFactory: ApplicationMutationSystemLive["executionContextFactory"];
  readonly queryCursor: Readonly<{ scopeUuid: string; broker: QueryCursorBroker }>;
  readonly admission: CoreApplicationAdmission;
}
type RunnerInput<Failure> = Omit<CoreBodyInput, "transaction"> & Readonly<{ transaction: CoreWorkerMutationOperations;
  native?: (operation: AdmittedFrameworkOperationV1) => Effect.Effect<Json, Failure> }>;
export type CoreNativeApplicationMutationInput<Failure> = RunnerInput<Failure> & Required<Pick<RunnerInput<Failure>, "native">>;
/** Host projection and RPC lifetime, separate from shared transaction authority. */
export function makeCoreApplicationMutationRunner(configuration: RunnerConfiguration) {
  return makeRunner<never>(configuration, false);
}
/** Same authenticated Worker and callback owner for the named native root.
 * Native callbacks are never replayed by this runner. */
export function makeCoreNativeApplicationMutationRunner<Failure>(configuration: RunnerConfiguration) {
  const execute = makeRunner<Failure>(configuration, true);
  return (input: CoreNativeApplicationMutationInput<Failure>) => execute(input);
}
function makeRunner<NativeFailure>(configuration: RunnerConfiguration, privateNative: boolean) {
  const execute = Effect.fn("CoreApplicationMutationRunner.execute")(function* (input: RunnerInput<NativeFailure>) {
    const runner = configuration.applicationRunner;
    if (privateNative !== (input.native !== undefined)) return yield* new CoreApplicationMutationError({ reason: "unsupportedSelection" });
    if (input.program.scopeUuid !== configuration.queryCursor.scopeUuid)
      return yield* new CoreApplicationMutationError({ reason: "metadataInvalid" });
    const target = input.program.executionAuthority.authority.runtimeTarget;
    const source = yield* runner.source.read(target.sourceArtifactRootSha256).pipe(
      Effect.mapError(cause => new CoreApplicationMutationError({ reason: "metadataInvalid", cause })),
    );
    const definition = yield* Effect.try({ try: () => makeApplicationWorkerDefinition({
      source, target, manifest: input.program.manifest, hostPolicy: runner.hostPolicy,
      validatorIdentityEncoding: input.program.validatorIdentityEncoding,
      hostPolicySha256: runner.hostPolicySha256, compatibilityDate: input.program.compatibilityDate,
      documentIdFormat: "convex",
      ...(privateNative ? { privateNative: true as const } : {}),
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
    }, "convex", input.program.validatorIdentityEncoding).pipe(Effect.mapError(cause => new CoreApplicationMutationError({ reason: "metadataInvalid", cause })));
    const callbackContext = yield* Effect.withFiber(fiber => Effect.succeed(Context.add(
      captureExecutionDiagnosticContext(fiber), Clock.Clock, Context.get(fiber.context, Clock.Clock),
    )));
    const session = makeCoreApplicationReadSession<Effect.Error<typeof input.revalidate>, NativeFailure>(input, callbackContext, configuration.queryCursor.broker,
      configuration.admission);
    const capability = Object.freeze({
      ...session.target,
      insertPointDocument: (table: string, value: unknown) => session.run(() => {
        const binding = input.transaction.tableNumber(table).pipe(
          Effect.map(tableId => ({ tableId, logicalName: table })),
        );
        return input.transaction.insert(table, value).pipe(
          Effect.flatMap(id => binding.pipe(Effect.map(table => ({ kind: "inserted" as const, id, table })))),
          Effect.catchCause(cause => Effect.gen(function* () {
            const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined;
            if (reason !== undefined && Cause.isFailReason(reason) && reason.error instanceof CoreTransactionError) {
              if (reason.error.reason === "documentValidation") {
                const table = yield* binding;
                return { kind: "documentValidation" as const, table };
              }
              if (reason.error.reason === "tooManyTables") return { kind: "tooManyTables" as const };
            }
            return yield* Effect.failCause(cause);
          })),
        );
      }),
      patchPointDocument: (id: string, value: unknown) => session.run(() => input.transaction.patch(id, value)),
      replacePointDocument: (id: string, value: unknown) => session.run(() => input.transaction.replace(id, value)),
      deletePointDocument: (id: string) => session.run(() => input.transaction.delete(id)),
      ...(input.native === undefined ? {} : { runPrivateNativeOperation: (value: unknown) => session.run(() => Effect.gen(function* () {
        const operation = yield* Effect.fromResult(decodeAdmittedFrameworkOperationV1Result(value)).pipe(
          Effect.mapError(cause => new CoreTransactionError({ reason: "invalidValue", cause })));
        const native = input.native;
        if (native === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
        return yield* native(operation);
      })) }),
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
