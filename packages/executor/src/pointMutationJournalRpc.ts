import type {
  RunSessionJournalIndexedQueryV1Result,
  RunSessionJournalPointOperationV1Result,
} from "@flarex/persistence-postgres/session-journal-store";
import { RpcTarget, type RpcStub } from "cloudflare:workers";
import { Cause, Data, Effect, Exit, Result, Schema, Semaphore } from "effect";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
} from "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import {
  decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1,
  type AppDocumentIdentityV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  SchemaManifestAppIndexDescriptorSchema,
  SchemaManifestAppTableNameSchema,
  type SchemaManifestAppTableName,
} from "flarex-protocol/schema-manifest";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import {
  MAX_APPLICATION_WORKER_TABLES_V1,
} from "flarex-protocol/internal/application-worker-v1";
import {
  CommitSyscallSequenceV1Schema,
  type CommitSyscallSequenceV1,
} from "flarex-protocol/commit-protocol";

import type {
  PointMutationJournalBoundaryV1Error,
  PointMutationJournalLogicalOutcomeV1,
  PointMutationJournalIndexedQueryLogicalOutcomeV1,
  PointMutationJournalIndexV1,
  PointMutationJournalTableV1,
} from "./pointMutationJournal";
import type {
  PointMutationOccBoundJournalV1,
} from "./storedAttemptAuthentication";

const REMOTE_STOP_ERROR_NAME = "FlarexJournalRpcStopped";
const REMOTE_STOP_ERROR_MESSAGE = "The journal RPC capability is unavailable.";

export class PointMutationJournalResultRejectedV1Error
  extends Data.TaggedError("PointMutationJournalResultRejectedV1Error")<{
    readonly result: Exclude<
      | RunSessionJournalPointOperationV1Result
      | RunSessionJournalIndexedQueryV1Result,
      { readonly kind: "completed" }
    >;
  }> {}

export class ApplicationPointMutationJournalProjectionV1Error
  extends Data.TaggedError("ApplicationPointMutationJournalProjectionV1Error")<{
    readonly reason:
      | "invalidConfiguration"
      | "unknownTable"
      | "invalidIndexDescriptor"
      | "invalidDocumentId"
      | "documentTableMismatch"
      | "unexpectedOutcome";
    readonly cause?: unknown;
  }> {}

export type PointMutationJournalRpcBoundaryV1Error =
  | PointMutationJournalBoundaryV1Error
  | PointMutationJournalResultRejectedV1Error;

export type ApplicationPointMutationJournalRpcBoundaryV1Error =
  | PointMutationJournalRpcBoundaryV1Error
  | ApplicationPointMutationJournalProjectionV1Error;

export interface PointMutationJournalRpcTableMethodsV1 {
  readonly runPointOperation: (
    operation: unknown,
  ) => Promise<PointMutationJournalLogicalOutcomeV1>;
  readonly resolveDeveloperIndex: (
    indexDescriptor: unknown,
  ) => Promise<PointMutationJournalRpcIndexTargetV1>;
}

export interface PointMutationJournalRpcIndexMethodsV1 {
  readonly runIndexedQuery: (
    operation: unknown,
  ) => Promise<PointMutationJournalIndexedQueryLogicalOutcomeV1>;
}

export type PointMutationJournalRpcIndexTargetV1 =
  & RpcTarget
  & PointMutationJournalRpcIndexMethodsV1;

export type PointMutationJournalRpcTableTargetV1 =
  & RpcTarget
  & PointMutationJournalRpcTableMethodsV1;

export interface PointMutationJournalRpcParentMethodsV1 {
  readonly resolvePointTable: (
    tableName: unknown,
  ) => Promise<PointMutationJournalRpcTableTargetV1>;
}

export type PointMutationJournalRpcParentTargetV1 =
  & RpcTarget
  & PointMutationJournalRpcParentMethodsV1;

export type PointMutationJournalRpcTableStubV1 = RpcStub<
  PointMutationJournalRpcTableTargetV1
>;

export type PointMutationJournalRpcIndexStubV1 = RpcStub<
  PointMutationJournalRpcIndexTargetV1
>;

export type PointMutationJournalRpcParentStubV1 = RpcStub<
  PointMutationJournalRpcParentTargetV1
>;

export interface PointMutationJournalRpcSessionV1 {
  readonly target: PointMutationJournalRpcParentTargetV1;
  readonly closeAndDrain: Effect.Effect<
    void,
    PointMutationJournalRpcBoundaryV1Error,
    never
  >;
}

export interface ApplicationPointMutationJournalTableBindingV1 {
  readonly tableId: CatalogTableId;
  readonly logicalName: SchemaManifestAppTableName;
}

export interface ApplicationPointMutationJournalRpcMethodsV1 {
  readonly revalidate: () => Promise<void>;
  readonly readPointDocument: (
    tableName: unknown,
    documentId: unknown,
  ) => Promise<CanonicalFlarexRuntimeValueV1 | null>;
  readonly queryIndexRange: (
    tableName: unknown,
    indexDescriptor: unknown,
    bounds: unknown,
    limit: unknown,
  ) => Promise<Readonly<{
    readonly documents: ReadonlyArray<CanonicalFlarexRuntimeValueV1>;
    readonly isDone: boolean;
  }>>;
  readonly insertPointDocument: (
    tableName: unknown,
    value: unknown,
  ) => Promise<AppDocumentIdV1>;
  readonly patchPointDocument: (
    documentId: unknown,
    value: unknown,
  ) => Promise<void>;
  readonly replacePointDocument: (
    documentId: unknown,
    value: unknown,
  ) => Promise<void>;
  readonly deletePointDocument: (
    documentId: unknown,
  ) => Promise<void>;
}

export type ApplicationPointMutationJournalRpcTargetV1 =
  & RpcTarget
  & ApplicationPointMutationJournalRpcMethodsV1;

export interface ApplicationPointMutationJournalRpcSessionV1 {
  readonly target: ApplicationPointMutationJournalRpcTargetV1;
  readonly closeAndDrain: Effect.Effect<
    void,
    ApplicationPointMutationJournalRpcBoundaryV1Error,
    never
  >;
}

/**
 * Settles one runtime call and its attempt-scoped journal as a single
 * uninterruptible boundary. Journal failure retains precedence because it can
 * carry an earlier poisoned RPC operation that user code swallowed before the
 * runtime returned.
 */
export function runPointMutationRuntimeWithJournalSettlementV1<
  Success,
  HostError,
  JournalError,
>(
  host: Effect.Effect<Success, HostError>,
  closeAndDrain: Effect.Effect<void, JournalError>,
): Effect.Effect<Success, HostError | JournalError> {
  return Effect.uninterruptible(
    host.pipe(
      Effect.exit,
      Effect.flatMap(hostExit =>
        closeAndDrain.pipe(
          Effect.exit,
          Effect.flatMap(journalExit =>
            resolveRuntimeJournalExits(hostExit, journalExit)
          ),
        )
      ),
    ),
  );
}

function resolveRuntimeJournalExits<Success, HostError, JournalError>(
  hostExit: Exit.Exit<Success, HostError>,
  journalExit: Exit.Exit<void, JournalError>,
): Effect.Effect<Success, HostError | JournalError> {
  if (Exit.isFailure(journalExit)) {
    return Effect.failCause(journalExit.cause);
  }
  return Exit.isSuccess(hostExit)
    ? Effect.succeed(hostExit.value)
    : Effect.failCause(hostExit.cause);
}

const decodeCatalogTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodeTableNameResult = Schema.decodeUnknownResult(
  SchemaManifestAppTableNameSchema,
);
const decodeIndexDescriptorResult = Schema.decodeUnknownResult(
  SchemaManifestAppIndexDescriptorSchema,
);

export function makePointMutationJournalRpcSessionV1(
  journal: PointMutationOccBoundJournalV1,
): PointMutationJournalRpcSessionV1 {
  const state = new PointMutationJournalRpcSessionStateV1<
    PointMutationJournalRpcBoundaryV1Error
  >(journal);
  return Object.freeze({
    target: new PointMutationJournalRpcParentTarget(state),
    closeAndDrain: closeAndDrainEffect(state),
  });
}

/**
 * Adapts one already-authenticated point-mutation journal attempt to the flat
 * capability consumed by the Application Worker. This adapter owns only
 * in-process sequencing and projection. Every durable read/write, replay,
 * attempt fence, validation, and OCC decision remains with the bound journal.
 */
export function makeApplicationPointMutationJournalRpcSessionV1(
  journal: PointMutationOccBoundJournalV1,
  tables: ReadonlyArray<ApplicationPointMutationJournalTableBindingV1>,
): ApplicationPointMutationJournalRpcSessionV1 {
  const state = new PointMutationJournalRpcSessionStateV1<
    ApplicationPointMutationJournalRpcBoundaryV1Error
  >(journal);
  const applicationState = new ApplicationPointMutationJournalRpcStateV1(
    state,
    captureApplicationTableBindings(tables),
  );
  return Object.freeze({
    target: new ApplicationPointMutationJournalRpcTarget(applicationState),
    closeAndDrain: closeAndDrainEffect(state),
  });
}

function closeAndDrainEffect<
  Error extends ApplicationPointMutationJournalRpcBoundaryV1Error,
>(
  state: PointMutationJournalRpcSessionStateV1<Error>,
): Effect.Effect<void, Error> {
  return Effect.uninterruptible(
    Effect.promise(() => state.closeAndDrain()).pipe(
      Effect.flatMap(() => {
        const cause = state.firstCause();
        return cause === undefined ? Effect.void : Effect.failCause(cause);
      }),
    ),
  );
}

class PointMutationJournalRpcParentTarget
  extends RpcTarget
  implements PointMutationJournalRpcParentMethodsV1
{
  readonly #state: PointMutationJournalRpcSessionStateV1<
    PointMutationJournalRpcBoundaryV1Error
  >;

  constructor(
    state: PointMutationJournalRpcSessionStateV1<
      PointMutationJournalRpcBoundaryV1Error
    >,
  ) {
    super();
    this.#state = state;
  }

  resolvePointTable(
    tableName: unknown,
  ): Promise<PointMutationJournalRpcTableTargetV1> {
    return this.#state.run(() => this.#state.journal.resolvePointTable(
      tableName,
    )).then(
      table => new PointMutationJournalRpcTableTarget(this.#state, table),
    );
  }
}

class PointMutationJournalRpcTableTarget
  extends RpcTarget
  implements PointMutationJournalRpcTableMethodsV1
{
  readonly #state: PointMutationJournalRpcSessionStateV1<
    PointMutationJournalRpcBoundaryV1Error
  >;
  readonly #table: PointMutationJournalTableV1;

  constructor(
    state: PointMutationJournalRpcSessionStateV1<
      PointMutationJournalRpcBoundaryV1Error
    >,
    table: PointMutationJournalTableV1,
  ) {
    super();
    this.#state = state;
    this.#table = table;
  }

  runPointOperation(
    operation: unknown,
  ): Promise<PointMutationJournalLogicalOutcomeV1> {
    return this.#state.runPointOperation(() =>
      this.#state.journal.runPointOperation(this.#table, operation).pipe(
        Effect.flatMap(projectPointMutationJournalRpcOutcomeV1),
      )
    );
  }

  resolveDeveloperIndex(
    indexDescriptor: unknown,
  ): Promise<PointMutationJournalRpcIndexTargetV1> {
    return this.#state.run(() => this.#state.journal.resolveDeveloperIndex(
      this.#table,
      indexDescriptor,
    )).then(
      index => new PointMutationJournalRpcIndexTarget(this.#state, index),
    );
  }
}

class PointMutationJournalRpcIndexTarget
  extends RpcTarget
  implements PointMutationJournalRpcIndexMethodsV1
{
  readonly #state: PointMutationJournalRpcSessionStateV1<
    PointMutationJournalRpcBoundaryV1Error
  >;
  readonly #index: PointMutationJournalIndexV1;

  constructor(
    state: PointMutationJournalRpcSessionStateV1<
      PointMutationJournalRpcBoundaryV1Error
    >,
    index: PointMutationJournalIndexV1,
  ) {
    super();
    this.#state = state;
    this.#index = index;
  }

  runIndexedQuery(
    operation: unknown,
  ): Promise<PointMutationJournalIndexedQueryLogicalOutcomeV1> {
    return this.#state.run(() =>
      this.#state.journal.runIndexedQuery(this.#index, operation).pipe(
        Effect.flatMap(projectPointMutationJournalIndexedQueryRpcOutcomeV1),
      )
    );
  }
}

interface CapturedApplicationPointMutationJournalBindingsV1 {
  readonly byId: ReadonlyMap<CatalogTableId, SchemaManifestAppTableName>;
  readonly byName: ReadonlyMap<SchemaManifestAppTableName, CatalogTableId>;
}

function captureApplicationTableBindings(
  input: ReadonlyArray<ApplicationPointMutationJournalTableBindingV1>,
): CapturedApplicationPointMutationJournalBindingsV1 {
  if (
    !Array.isArray(input) ||
    input.length > MAX_APPLICATION_WORKER_TABLES_V1
  ) {
    throw new ApplicationPointMutationJournalProjectionV1Error({
      reason: "invalidConfiguration",
    });
  }
  const byId = new Map<CatalogTableId, SchemaManifestAppTableName>();
  const byName = new Map<SchemaManifestAppTableName, CatalogTableId>();
  for (const binding of input) {
    const decoded = Result.gen(function* () {
      const tableId = yield* decodeCatalogTableIdResult(binding.tableId);
      const logicalName = yield* decodeTableNameResult(binding.logicalName);
      return { tableId, logicalName } as const;
    });
    const captured = Result.match(decoded, {
      onFailure: cause => {
        throw new ApplicationPointMutationJournalProjectionV1Error({
          reason: "invalidConfiguration",
          cause,
        });
      },
      onSuccess: value => value,
    });
    if (
      byId.has(captured.tableId) ||
      byName.has(captured.logicalName)
    ) {
      throw new ApplicationPointMutationJournalProjectionV1Error({
        reason: "invalidConfiguration",
      });
    }
    byId.set(captured.tableId, captured.logicalName);
    byName.set(captured.logicalName, captured.tableId);
  }
  return Object.freeze({ byId, byName });
}

class ApplicationPointMutationJournalRpcTarget
  extends RpcTarget
  implements ApplicationPointMutationJournalRpcMethodsV1
{
  constructor(
    private readonly state: ApplicationPointMutationJournalRpcStateV1,
  ) {
    super();
  }

  revalidate(): Promise<void> {
    return this.state.revalidate();
  }

  readPointDocument(
    tableName: unknown,
    documentId: unknown,
  ): Promise<CanonicalFlarexRuntimeValueV1 | null> {
    return this.state.readPointDocument(tableName, documentId);
  }

  queryIndexRange(
    tableName: unknown,
    indexDescriptor: unknown,
    bounds: unknown,
    limit: unknown,
  ): Promise<Readonly<{
    readonly documents: ReadonlyArray<CanonicalFlarexRuntimeValueV1>;
    readonly isDone: boolean;
  }>> {
    return this.state.queryIndexRange(
      tableName,
      indexDescriptor,
      bounds,
      limit,
    );
  }

  insertPointDocument(
    tableName: unknown,
    value: unknown,
  ): Promise<AppDocumentIdV1> {
    return this.state.insertPointDocument(tableName, value);
  }

  patchPointDocument(
    documentId: unknown,
    value: unknown,
  ): Promise<void> {
    return this.state.patchPointDocument(documentId, value);
  }

  replacePointDocument(
    documentId: unknown,
    value: unknown,
  ): Promise<void> {
    return this.state.replacePointDocument(documentId, value);
  }

  deletePointDocument(documentId: unknown): Promise<void> {
    return this.state.deletePointDocument(documentId);
  }
}

class ApplicationPointMutationJournalRpcStateV1 {
  readonly #operationGate = Semaphore.makeUnsafe(1);
  readonly #tableCapabilities = new Map<
    SchemaManifestAppTableName,
    PointMutationJournalTableV1
  >();
  readonly #indexCapabilities = new Map<string, PointMutationJournalIndexV1>();
  #nextSequence = 0n;
  #terminalCause:
    | Cause.Cause<ApplicationPointMutationJournalRpcBoundaryV1Error>
    | undefined;

  constructor(
    private readonly session: PointMutationJournalRpcSessionStateV1<
      ApplicationPointMutationJournalRpcBoundaryV1Error
    >,
    private readonly bindings:
      CapturedApplicationPointMutationJournalBindingsV1,
  ) {}

  revalidate(): Promise<void> {
    // The exact attempt was reloaded immediately before the bound journal was
    // opened. This handshake proves that this process-local RPC session still
    // admits calls; every actual journal operation performs durable liveness
    // and claim-fence revalidation in its existing owner.
    return this.session.run(() => Effect.void);
  }

  readPointDocument(
    tableName: unknown,
    documentId: unknown,
  ): Promise<CanonicalFlarexRuntimeValueV1 | null> {
    return this.session.runPointOperation(() =>
      this.runOperation((sequence, self) =>
        Effect.gen(function* () {
          const identity = yield* self.documentIdentity(documentId, tableName);
          const table = yield* self.table(tableName);
          const outcome = yield* self.session.journal.runPointOperation(
            table,
            Object.freeze({
              kind: "get" as const,
              syscallSequence: sequence,
              documentId: identity.id,
            }),
          ).pipe(Effect.flatMap(projectPointMutationJournalRpcOutcomeV1));
          switch (outcome.kind) {
            case "missing":
              return null;
            case "present":
              return outcome.document;
            case "inserted":
            case "unit":
              return yield* self.unexpectedOutcome();
          }
        })
      )
    );
  }

  queryIndexRange(
    tableName: unknown,
    indexDescriptor: unknown,
    bounds: unknown,
    limit: unknown,
  ): Promise<Readonly<{
    readonly documents: ReadonlyArray<CanonicalFlarexRuntimeValueV1>;
    readonly isDone: boolean;
  }>> {
    return this.session.run(() =>
      this.runOperation((sequence, self) =>
        Effect.gen(function* () {
          const index = yield* self.index(tableName, indexDescriptor);
          const outcome = yield* self.session.journal.runIndexedQuery(
            index,
            Object.freeze({
              kind: "indexRange" as const,
              syscallSequence: sequence,
              bounds,
              limit,
            }),
          ).pipe(Effect.flatMap(
            projectPointMutationJournalIndexedQueryRpcOutcomeV1,
          ));
          return Object.freeze({
            documents: outcome.documents,
            isDone: outcome.isDone,
          });
        })
      )
    );
  }

  insertPointDocument(
    tableName: unknown,
    value: unknown,
  ): Promise<AppDocumentIdV1> {
    return this.session.runPointOperation(() =>
      this.runOperation((sequence, self) =>
        Effect.gen(function* () {
          const table = yield* self.table(tableName);
          const outcome = yield* self.session.journal.runPointOperation(
            table,
            Object.freeze({
              kind: "insert" as const,
              syscallSequence: sequence,
              fields: value,
            }),
          ).pipe(Effect.flatMap(projectPointMutationJournalRpcOutcomeV1));
          switch (outcome.kind) {
            case "inserted": {
              const identity = yield* self.documentIdentity(
                outcome.documentId,
                tableName,
              );
              return identity.id;
            }
            case "missing":
            case "present":
            case "unit":
              return yield* self.unexpectedOutcome();
          }
        })
      )
    );
  }

  patchPointDocument(
    documentId: unknown,
    value: unknown,
  ): Promise<void> {
    return this.writeExistingDocument("patch", documentId, value);
  }

  replacePointDocument(
    documentId: unknown,
    value: unknown,
  ): Promise<void> {
    return this.writeExistingDocument("replace", documentId, value);
  }

  deletePointDocument(documentId: unknown): Promise<void> {
    return this.writeExistingDocument("delete", documentId, undefined);
  }

  private writeExistingDocument(
    kind: "patch" | "replace" | "delete",
    documentId: unknown,
    value: unknown,
  ): Promise<void> {
    return this.session.runPointOperation(() =>
      this.runOperation((sequence, self) =>
        Effect.gen(function* () {
          const identity = yield* self.documentIdentity(documentId);
          const tableName = self.bindings.byId.get(identity.tableId);
          if (tableName === undefined) {
            return yield* Effect.fail(
              new ApplicationPointMutationJournalProjectionV1Error({
                reason: "unknownTable",
              }),
            );
          }
          const table = yield* self.table(tableName);
          const operation = kind === "delete"
            ? Object.freeze({
                kind,
                syscallSequence: sequence,
                documentId: identity.id,
              })
            : kind === "patch"
            ? Object.freeze({
                kind,
                syscallSequence: sequence,
                documentId: identity.id,
                patch: value,
              })
            : Object.freeze({
                kind,
                syscallSequence: sequence,
                documentId: identity.id,
                fields: value,
              });
          const outcome = yield* self.session.journal.runPointOperation(
            table,
            operation,
          ).pipe(Effect.flatMap(projectPointMutationJournalRpcOutcomeV1));
          return outcome.kind === "unit" && outcome.operation === kind
            ? undefined
            : yield* self.unexpectedOutcome();
        })
      )
    );
  }

  private readonly runOperation = Effect.fn(
    "ApplicationPointMutationJournalRpc.runOperation",
  )(<A>(
    operation: (
      sequence: CommitSyscallSequenceV1,
      self: ApplicationPointMutationJournalRpcStateV1,
    ) => Effect.Effect<A, ApplicationPointMutationJournalRpcBoundaryV1Error>,
  ): Effect.Effect<A, ApplicationPointMutationJournalRpcBoundaryV1Error> => {
    const self = this;
    return this.#operationGate.withPermit(Effect.gen(function* () {
      if (self.#terminalCause !== undefined) {
        return yield* Effect.failCause(self.#terminalCause);
      }
      const sequence = CommitSyscallSequenceV1Schema.make(
        self.#nextSequence + 1n,
      );
      const exit = yield* operation(sequence, self).pipe(Effect.exit);
      if (Exit.isSuccess(exit)) {
        self.#nextSequence = sequence;
        return exit.value;
      }
      if (!isOnlyDocumentValidationFailure(exit.cause)) {
        self.#terminalCause = exit.cause;
      }
      return yield* Effect.failCause(exit.cause);
    }));
  });

  private readonly table = Effect.fn(
    "ApplicationPointMutationJournalRpc.resolveTable",
  )((input: unknown): Effect.Effect<
    PointMutationJournalTableV1,
    ApplicationPointMutationJournalRpcBoundaryV1Error
  > => {
    const self = this;
    return Effect.gen(function* () {
      const tableName = yield* Effect.fromResult(
        decodeTableNameResult(input),
      ).pipe(Effect.mapError(cause =>
        new ApplicationPointMutationJournalProjectionV1Error({
          reason: "unknownTable",
          cause,
        })
      ));
      if (!self.bindings.byName.has(tableName)) {
        return yield* Effect.fail(
          new ApplicationPointMutationJournalProjectionV1Error({
            reason: "unknownTable",
          }),
        );
      }
      const existing = self.#tableCapabilities.get(tableName);
      if (existing !== undefined) return existing;
      const table = yield* self.session.journal.resolvePointTable(tableName);
      self.#tableCapabilities.set(tableName, table);
      return table;
    });
  });

  private readonly index = Effect.fn(
    "ApplicationPointMutationJournalRpc.resolveIndex",
  )((
    tableInput: unknown,
    indexDescriptor: unknown,
  ): Effect.Effect<
    PointMutationJournalIndexV1,
    ApplicationPointMutationJournalRpcBoundaryV1Error
  > => {
    const self = this;
    return Effect.gen(function* () {
      const table = yield* self.table(tableInput);
      const tableName = yield* Effect.fromResult(decodeTableNameResult(
        tableInput,
      )).pipe(Effect.mapError(cause =>
        new ApplicationPointMutationJournalProjectionV1Error({
          reason: "unknownTable",
          cause,
        })
      ));
      const descriptor = yield* Effect.fromResult(
        decodeIndexDescriptorResult(indexDescriptor),
      ).pipe(Effect.mapError(cause =>
        new ApplicationPointMutationJournalProjectionV1Error({
          reason: "invalidIndexDescriptor",
          cause,
        })
      ));
      const key = `${tableName}\u0000${descriptor}`;
      const existing = self.#indexCapabilities.get(key);
      if (existing !== undefined) return existing;
      const index = yield* self.session.journal.resolveDeveloperIndex(
        table,
        descriptor,
      );
      self.#indexCapabilities.set(key, index);
      return index;
    });
  });

  private documentIdentity(
    input: unknown,
    expectedTableInput?: unknown,
  ): Effect.Effect<
    AppDocumentIdentityV1,
    ApplicationPointMutationJournalProjectionV1Error
  > {
    return Effect.fromResult(decodeAppDocumentIdentityV1Result(input)).pipe(
      Effect.mapError(cause =>
        new ApplicationPointMutationJournalProjectionV1Error({
          reason: "invalidDocumentId",
          cause,
        })
      ),
      Effect.flatMap(identity => {
        if (expectedTableInput === undefined) return Effect.succeed(identity);
        return Effect.fromResult(decodeTableNameResult(expectedTableInput)).pipe(
          Effect.mapError(cause =>
            new ApplicationPointMutationJournalProjectionV1Error({
              reason: "unknownTable",
              cause,
            })
          ),
          Effect.flatMap(tableName =>
            this.bindings.byName.get(tableName) === identity.tableId
              ? Effect.succeed(identity)
              : Effect.fail(
                new ApplicationPointMutationJournalProjectionV1Error({
                  reason: "documentTableMismatch",
                }),
              )
          ),
        );
      }),
    );
  }

  private unexpectedOutcome(): Effect.Effect<
    never,
    ApplicationPointMutationJournalProjectionV1Error
  > {
    return Effect.fail(new ApplicationPointMutationJournalProjectionV1Error({
      reason: "unexpectedOutcome",
    }));
  }
}

function isOnlyDocumentValidationFailure(
  cause: Cause.Cause<ApplicationPointMutationJournalRpcBoundaryV1Error>,
): boolean {
  return cause.reasons.length === 1 &&
    Cause.isFailReason(cause.reasons[0]) &&
    cause.reasons[0].error instanceof
      ApplicationRevisionSyscallDocumentValidationV1Error;
}

const projectPointMutationJournalRpcOutcomeV1 = Effect.fn(
  "PointMutationJournalRpc.projectOutcome",
)(function* (
  result: RunSessionJournalPointOperationV1Result,
): Effect.fn.Return<
  PointMutationJournalLogicalOutcomeV1,
  PointMutationJournalResultRejectedV1Error
> {
  switch (result.kind) {
    case "completed":
      return result.outcome;
    case "rejected":
    case "sequenceRejected":
    case "stateRejected":
      return yield* Effect.fail(
        new PointMutationJournalResultRejectedV1Error({ result }),
      );
  }
});

const projectPointMutationJournalIndexedQueryRpcOutcomeV1 = Effect.fn(
  "PointMutationJournalRpc.projectIndexedQueryOutcome",
)(function* (
  result: RunSessionJournalIndexedQueryV1Result,
): Effect.fn.Return<
  PointMutationJournalIndexedQueryLogicalOutcomeV1,
  PointMutationJournalResultRejectedV1Error
> {
  switch (result.kind) {
    case "completed":
      return result.outcome;
    case "rejected":
    case "sequenceRejected":
    case "stateRejected":
      return yield* Effect.fail(
        new PointMutationJournalResultRejectedV1Error({ result }),
      );
  }
});

class PointMutationJournalRpcSessionStateV1<
  Error extends ApplicationPointMutationJournalRpcBoundaryV1Error,
> {
  readonly journal: PointMutationOccBoundJournalV1;
  readonly #admitted = new Set<Promise<void>>();
  readonly #failureCauses = new Map<
    number,
    Cause.Cause<Error>
  >();
  #accepting = true;
  #nextAdmission = 0;
  #drainPromise: Promise<void> | undefined;

  constructor(journal: PointMutationOccBoundJournalV1) {
    this.journal = journal;
  }

  run<A>(
    makeEffect: () => Effect.Effect<
      A,
      Error,
      never
    >,
  ): Promise<A> {
    return this.#run(makeEffect, false);
  }

  runPointOperation<A>(
    makeEffect: () => Effect.Effect<
      A,
      Error,
      never
    >,
  ): Promise<A> {
    return this.#run(makeEffect, true);
  }

  #run<A>(
    makeEffect: () => Effect.Effect<
      A,
      Error,
      never
    >,
    recoverDocumentValidation: boolean,
  ): Promise<A> {
    if (!this.#accepting) {
      return Promise.reject(makeRemoteStopError());
    }
    const admission = this.#nextAdmission;
    this.#nextAdmission += 1;

    let result: Promise<A>;
    try {
      result = Effect.runPromiseExit(makeEffect()).then(
        exit => {
          if (Exit.isSuccess(exit)) return exit.value;
          const onlyReason = exit.cause.reasons.length === 1
            ? exit.cause.reasons[0]
            : undefined;
          if (
            recoverDocumentValidation &&
            onlyReason !== undefined &&
            Cause.isFailReason(onlyReason) &&
            onlyReason.error instanceof
              ApplicationRevisionSyscallDocumentValidationV1Error
          ) {
            throw onlyReason.error;
          }
          this.#retainCause(admission, exit.cause);
          throw makeRemoteStopError();
        },
        cause => {
          this.#retainCause(admission, Cause.die(cause));
          throw makeRemoteStopError();
        },
      );
    } catch (cause) {
      this.#retainCause(admission, Cause.die(cause));
      result = Promise.reject(makeRemoteStopError());
    }

    const settlement = result.then(
      () => undefined,
      () => undefined,
    );
    this.#admitted.add(settlement);
    void settlement.then(() => {
      this.#admitted.delete(settlement);
    });
    return result;
  }

  closeAndDrain(): Promise<void> {
    this.#accepting = false;
    this.#drainPromise ??= this.#drainAdmitted();
    return this.#drainPromise;
  }

  firstCause():
    | Cause.Cause<Error>
    | undefined {
    let earliestAdmission: number | undefined;
    let earliestCause:
      | Cause.Cause<Error>
      | undefined;
    for (const [admission, cause] of this.#failureCauses) {
      if (
        earliestAdmission === undefined ||
        admission < earliestAdmission
      ) {
        earliestAdmission = admission;
        earliestCause = cause;
      }
    }
    return earliestCause;
  }

  #retainCause(
    admission: number,
    cause: Cause.Cause<Error>,
  ): void {
    this.#failureCauses.set(admission, cause);
  }

  async #drainAdmitted(): Promise<void> {
    while (this.#admitted.size > 0) {
      await Promise.all(this.#admitted);
      await Promise.resolve();
    }
  }
}

function makeRemoteStopError(): Error {
  const error = new Error(REMOTE_STOP_ERROR_MESSAGE);
  error.name = REMOTE_STOP_ERROR_NAME;
  Object.defineProperty(error, "stack", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  return error;
}
