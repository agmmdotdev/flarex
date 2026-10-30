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
import { CORE_TRANSACTION_REFERENCE_LIMITS, CoreQueryInputError, CoreTransactionError, type CoreError, type CoreQuery } from "@flarex/persistence-postgres/internal/core";
import { Cause, Clock, Context, Effect, Exit, Option, Result, Schema } from "effect";
import { captureExecutionDiagnosticContext } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1 } from "flarex-protocol/commit-protocol";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import type { QueryCursorBroker } from "flarex-protocol/query-cursor";
import type { ManagedDatabaseQueryCapability } from "flarex/internal/query";
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
const SafeCount = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0
  ? undefined : "Expected a nonnegative safe query count"));
const decodeQueryRequest = Schema.decodeUnknownEffect(Schema.Struct({
  table: Schema.NonEmptyString,
  index: Schema.optionalKey(Schema.NonEmptyString),
  range: Schema.optionalKey(Schema.Struct({ expressions: Schema.Array(Schema.Unknown) })),
  order: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
  cursor: Schema.optionalKey(Schema.String),
}), { onExcessProperty: "error" });
const decodeQueryTerminal = Schema.decodeUnknownEffect(Schema.Union([
  Schema.Struct({ kind: Schema.Literal("collect") }),
  Schema.Struct({ kind: Schema.Literal("take"), count: SafeCount }),
  Schema.Struct({ kind: Schema.Literal("paginate"), numItems: SafeCount.check(Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(CORE_TRANSACTION_REFERENCE_LIMITS.documentsRead)) }),
]), { onExcessProperty: "error" });
const decodePageCount = Schema.decodeUnknownEffect(SafeCount.check(Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1)));
const QUERY_TRANSPORT_MAXIMUM_BYTES = 8 * 1024 * 1024;
const QUERY_TRANSPORT_EMPTY_PAGE = { page: [], isDone: false, continueCursor: "" };
const QUERY_TRANSPORT_ENVELOPE_BYTES = new TextEncoder().encode(JSON.stringify({
  kind: "ok", value: QUERY_TRANSPORT_EMPTY_PAGE,
})).byteLength - 2;
// The Worker normalizes this inner page frame after decoding the ok envelope.
// Core supplies the array base and measured documents; the cursor is ASCII hex.
const QUERY_TRANSPORT_PAGE_SEMANTIC_BYTES = normalizeFlarexValueV1(QUERY_TRANSPORT_EMPTY_PAGE).semanticSizeBytes
  - normalizeFlarexValueV1([]).semanticSizeBytes;

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
    const session = makeCoreCapability(input, callbackContext, configuration.queryCursor.broker);
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

function makeCoreCapability(input: CoreBodyInput, callbackContext: Context.Context<never>, broker: QueryCursorBroker) {
  let open = true;
  let tail = Promise.resolve();
  let firstCause: Cause.Cause<CapabilityFailure> | undefined;
  const queries = new Map<string, CoreQuery>();
  let querySequence = 0;
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
  const queryResult = <A>(work: Effect.Effect<A, CapabilityFailure>) => work.pipe(
    Effect.map(value => ({ kind: "ok" as const, value })),
    Effect.catchTag("CoreQueryInputError", error => Effect.succeed({ kind: "queryError" as const,
      message: error.reason === "invalidCursor" ? "Invalid query cursor." : "Invalid database query." })),
  );
  const requireQuery = (queryId: string) => {
    const query = queries.get(queryId);
    return query === undefined ? Effect.fail(new CoreQueryInputError({ reason: "invalidQuery" })) : Effect.succeed(query);
  };
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
    queryStart: (request: unknown, terminal: unknown) => run(() => queryResult(Effect.gen(function* () {
      const captured = yield* decodeQueryRequest(request).pipe(Effect.mapError(invalidQuery));
      const operation = yield* decodeQueryTerminal(terminal).pipe(Effect.mapError(invalidQuery));
      if (captured.range !== undefined && captured.index === undefined)
        return yield* new CoreQueryInputError({ reason: "invalidQuery" });
      // Public tokens are authenticated before the transaction compares their
      // query fingerprint with the selected snapshot's normalized metadata.
      const cursor = captured.cursor === undefined ? undefined
        : yield* Effect.fromResult(broker.decode(captured.cursor)).pipe(Effect.mapError(cause =>
          new CoreQueryInputError({ reason: "invalidCursor", cause })));
      const query = yield* input.transaction.startQuery({ query: {
        source: captured.index === undefined
          ? { type: "FullTableScan", tableName: captured.table, order: captured.order ?? "asc" }
          : { type: "IndexRange", indexName: `${captured.table}.${captured.index}`,
            range: captured.range?.expressions ?? [], order: captured.order ?? "asc" },
        operators: operation.kind === "take" ? [{ limit: operation.count }] : [],
      }, ...(cursor === undefined ? {} : { cursor }) });
      const queryId = `query_${++querySequence}`;
      queries.set(queryId, query);
      return { queryId };
    }))),
    queryNext: (queryId: string, maxResults: unknown) => run(() => queryResult(Effect.gen(function* () {
      const count = yield* decodePageCount(maxResults).pipe(Effect.mapError(invalidQuery));
      const query = yield* requireQuery(queryId);
      const page = yield* query.nextPage({ maxResults: count, maxBytes: QUERY_TRANSPORT_MAXIMUM_BYTES,
        positionSize: position => {
          const cursorLength = position === null ? 0 : broker.encodedLength(position, query.queryFingerprint.byteLength);
          return { encodedBytes: QUERY_TRANSPORT_ENVELOPE_BYTES + cursorLength,
            semanticBytes: QUERY_TRANSPORT_PAGE_SEMANTIC_BYTES + cursorLength };
        },
      });
      const continueCursor = page.position === null ? "" : broker.encode({
        position: page.position, queryFingerprint: query.queryFingerprint,
      });
      return { page: structuredClone([...page.documents]), isDone: page.done, continueCursor };
    }))),
    queryCleanup: (queryId: string) => run(() => queryResult(Effect.gen(function* () {
      const query = yield* requireQuery(queryId);
      yield* query.close();
      queries.delete(queryId);
      return null;
    }))),
  }) satisfies ManagedDatabaseQueryCapability;
  return { target,
    closeAndDrain: Effect.uninterruptible(Effect.gen(function* () {
      open = false;
      // The tail handles each admitted rejection immediately and cannot reject;
      // the retained complete Cause below remains the failure authority.
      yield* Effect.promise(() => tail);
      // Close every stream, including when an earlier RPC poisoned the root.
      // Cleanup owns all failures and retains their complete Causes.
      for (const query of queries.values()) {
        const closed = yield* Effect.exit(query.close());
        if (Exit.isFailure(closed)) firstCause = firstCause === undefined ? closed.cause
          : Cause.combine(firstCause, closed.cause);
      }
      queries.clear();
      if (firstCause !== undefined) return yield* Effect.failCause(firstCause);
    })),
  };
}

function invalidQuery(cause: unknown): CoreQueryInputError {
  return new CoreQueryInputError({ reason: "invalidQuery", cause });
}
