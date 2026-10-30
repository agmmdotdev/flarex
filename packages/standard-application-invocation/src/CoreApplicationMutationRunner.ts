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
import { CoreTransactionError, type CoreError } from "@flarex/persistence-postgres/internal/core";
import { Cause, Clock, Context, Effect, Exit, Option, Result, Schema } from "effect";
import { captureExecutionDiagnosticContext } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { inspectVerifiedApplicationMutationGrantV1 } from "flarex-protocol/internal/application-mutation-grant-v1";
import { APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
} from "flarex-protocol/internal/application-revision-syscall-validation-v1";
import {
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
  decodeApplicationTransactionWorkerRequestV1Effect,
} from "flarex-protocol/internal/application-worker-v1";

import type { ApplicationMutationSystemLive } from "./ApplicationMutationSystem";

type CoreBodyInput = Parameters<CoreApplicationMutationConfiguration<never, never>["execute"]>[0];
type CapabilityFailure = CoreError | CoreApplicationMutationError;
const decodeIndexName = Schema.decodeUnknownEffect(Schema.NonEmptyString);
const decodeLimit = Schema.decodeUnknownEffect(Schema.Int.check(Schema.isGreaterThan(0)));
const decodeBounds = Schema.decodeUnknownEffect(Schema.Struct({
  startInclusive: Schema.optionalKey(Schema.String),
  endExclusive: Schema.optionalKey(Schema.String),
}), { onExcessProperty: "error" });

/** Host projection and RPC lifetime, separate from shared transaction authority. */
export function makeCoreApplicationMutationRunner(configuration: Readonly<{
  applicationRunner: ApplicationMutationSystemLive["applicationRunner"];
  executionContextFactory: ApplicationMutationSystemLive["executionContextFactory"];
}>) {
  const execute = Effect.fn("CoreApplicationMutationRunner.execute")(function* (input: CoreBodyInput) {
    const runner = configuration.applicationRunner;
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
    const session = makeCoreCapability(input, callbackContext);
    return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const host = yield* Effect.exit(restore(runner.host.runTransaction({ definition, request, capability: session.target })).pipe(
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

function makeCoreCapability(input: CoreBodyInput, callbackContext: Context.Context<never>) {
  let open = true;
  let tail = Promise.resolve();
  let firstCause: Cause.Cause<CapabilityFailure> | undefined;
  const stopped = () => new Error("The Application journal capability is unavailable.");
  const run = <A>(work: () => Effect.Effect<A, CapabilityFailure>): Promise<A> => {
    if (!open) return Promise.reject(stopped());
    const admitted = tail.then(async () => {
      if (firstCause !== undefined) throw stopped();
      // This is the real foreign RPC callback edge. Every admitted operation is
      // serialized and joined before its owner can finalize the transaction.
      const exit = await Effect.runPromiseExitWith(callbackContext)(input.revalidate.pipe(Effect.andThen(work)));
      if (Exit.isFailure(exit)) {
        const reason = exit.cause.reasons.length === 1 ? exit.cause.reasons[0] : undefined;
        if (reason !== undefined && Cause.isFailReason(reason) && reason.error instanceof CoreTransactionError &&
          reason.error.reason === "documentValidation") {
          const refusal = new Error(APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1);
          refusal.name = APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1;
          throw refusal;
        }
        firstCause = exit.cause;
        throw stopped();
      }
      return exit.value;
    });
    tail = admitted.then(() => undefined, () => undefined);
    return admitted;
  };
  const requireTable = (table: string, id: string) => Effect.fromResult(decodeDocumentId(id).pipe(
    Result.flatMap(identity => input.tables.some(candidate =>
      candidate.logicalName === table && candidate.tableId === identity.tableNumber)
      ? Result.succeed(undefined)
      : Result.fail(new CoreTransactionError({ reason: "invalidDocumentId" }))),
    Result.mapError(cause => cause instanceof CoreTransactionError ? cause
      : new CoreTransactionError({ reason: "invalidDocumentId", cause })),
  ));
  const target = Object.freeze({
    revalidate: () => run(() => Effect.void),
    readPointDocument: (table: string, id: string) => run(() => requireTable(table, id).pipe(
      Effect.andThen(input.transaction.get(id)),
      Effect.map(Option.match({ onNone: () => ({ kind: "missing" as const }),
        onSome: document => ({ kind: "present" as const, document: structuredClone(document) }) })),
    )),
    insertPointDocument: (table: string, value: unknown) => run(() => input.transaction.insert(table, value)),
    patchPointDocument: (id: string, value: unknown) => run(() => input.transaction.patch(id, value)),
    replacePointDocument: (id: string, value: unknown) => run(() => input.transaction.replace(id, value)),
    deletePointDocument: (id: string) => run(() => input.transaction.delete(id)),
    queryIndexRange: (table: string, descriptor: unknown, bounds: unknown, limit: number) => run(() => Effect.gen(function* () {
      const index = yield* decodeIndexName(descriptor).pipe(Effect.mapError(invalidQuery));
      const count = yield* decodeLimit(limit).pipe(Effect.mapError(invalidQuery));
      if (count >= Number.MAX_SAFE_INTEGER) return yield* new CoreTransactionError({ reason: "capacity" });
      const range = yield* decodeBounds(bounds).pipe(Effect.mapError(invalidQuery));
      // The retained bounds producer has a separate row-ID tie. Until the
      // Application profile lowers bounds for developer-ID keys, only an
      // unbounded request is admitted by this fresh target.
      if (range.startInclusive !== undefined || range.endExclusive !== undefined)
        return yield* new CoreTransactionError({ reason: "indexUnavailable" });
      const rows = yield* input.transaction.scan(table, index, { limit: count + 1 });
      return { documents: structuredClone(rows.slice(0, count)), isDone: rows.length <= count };
    })),
  });
  return { target,
    closeAndDrain: Effect.uninterruptible(Effect.gen(function* () {
      open = false;
      // The tail handles each admitted rejection immediately and cannot reject;
      // the retained complete Cause below remains the failure authority.
      yield* Effect.promise(() => tail);
      if (firstCause !== undefined) return yield* Effect.failCause(firstCause);
    })),
  };
}

function invalidQuery(cause: unknown): CoreTransactionError {
  return new CoreTransactionError({ reason: "invalidValue", cause });
}
