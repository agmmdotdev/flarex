import { Data, Effect, Result, Schema } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import type { RelationalSchema, RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { compileLogicalSourceSearches } from "flarex-protocol/internal/logical-storage-requirements";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { AdmittedParticipantOperationV1 } from "flarex-protocol/commit-protocol";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { TransactionAttemptFence, TransactionSessionIdV1 } from "flarex-protocol/transaction-session";
import type { ApplicationBindingInput } from "../applicationActivation";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { DataBindingHeadToken } from "../frameworkSchema/binding/model";
import { DataBindingError } from "../frameworkSchema/binding/errors";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturePrivateJsonData } from "../privateJsonData";
import type { ScopeClockRecord } from "../scopeClock";
import type { SessionJournalAttemptV1 } from "../sessionJournalStore";
import { getStableLogicalIndexIdentityByNameEffect } from "../stableLogicalIndexCatalog";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import { prepareLogicalSourceEvidence, LogicalSourceAdmissionError } from "./sourceAdmission";
import { prepareLogicalRelationalValueValidation, LogicalRelationalValueError } from "./relationalValues";
import type { LogicalSearchDefinition } from "./searchEntries";

export class LogicalRelationalAdmissionError extends Data.TaggedError("LogicalRelationalAdmissionError")<{
  readonly reason: "invalidInput" | "sourceMismatch" | "notReady" | "bindingMissing" | "invalidAuthority" |
    "unsupportedProfile" | "resourceFailure" | "storedCorruption";
  readonly cause?: unknown;
}> {}
const SourceContract = Schema.Struct({
  sourceKey: Schema.NonEmptyString, writeProfile: Schema.NonEmptyString,
  schema: Schema.Json, evidence: Schema.Json,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeContract = Schema.decodeUnknownEffect(SourceContract);
const projectSourceFailure = (cause: LogicalSourceAdmissionError) =>
  new LogicalRelationalAdmissionError({ reason: cause.reason, cause });
const projectBindingFailure = (cause: unknown): LogicalRelationalAdmissionError => {
  if (cause instanceof LogicalRelationalAdmissionError) return cause;
  if (cause instanceof DataBindingError) {
    const reason = cause.reason === "resourceFailure" || cause.reason === "decisionUncertain"
      ? "resourceFailure" : cause.reason === "storedCorruption" ? "storedCorruption" : "invalidAuthority";
    return new LogicalRelationalAdmissionError({ reason, cause });
  }
  return new LogicalRelationalAdmissionError({ reason: "resourceFailure", cause });
};

declare const admissionBrand: unique symbol;
export interface LogicalRelationalAdmission { readonly [admissionBrand]: true }
export interface LogicalRelationalAdmissionState {
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly schema: RelationalSchema;
  readonly head: DataBindingHeadToken;
  readonly tables: readonly Readonly<{ localName: string; tableId: CatalogTableId; definition: RelationalTableDefinition }>[];
  readonly values: Effect.Success<ReturnType<typeof prepareLogicalRelationalValueValidation>>;
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly search: readonly LogicalSearchDefinition[];
}
const admissions = new WeakMap<object, LogicalRelationalAdmissionState>();

declare const attemptAdmissionBrand: unique symbol;
/** Opaque domain authority issued for one exact journal handle. Its method
 * names are trusted host selections, never data decoded from a sandbox call. */
export interface LogicalRelationalAttemptAdmission { readonly [attemptAdmissionBrand]: true }
export interface LogicalRelationalAttemptRoot {
  readonly scopeId: ScopeId;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly principalDigest: string;
  readonly snapshotCommitSeq: CommitSeq;
  readonly schemaVersionId: CatalogSchemaVersionId;
}
export type LogicalRelationalAttemptReadTransaction = <Value, Failure>(
  work: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
    clock: ScopeClockRecord) => Effect.Effect<Value, Failure>,
) => Effect.Effect<Value, Failure | LogicalRelationalAdmissionError>;
export interface LogicalRelationalAttemptAdmissionState extends Omit<LogicalRelationalAdmissionState, "tx" | "authority"> {
  readonly attempt: SessionJournalAttemptV1;
  readonly root: LogicalRelationalAttemptRoot;
  readonly methods: ReadonlySet<string>;
  readonly readTransaction: LogicalRelationalAttemptReadTransaction;
  readonly verifyBinding: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
    clock: ScopeClockRecord) => Effect.Effect<void, LogicalRelationalAdmissionError>;
}
const attemptAdmissions = new WeakMap<object, LogicalRelationalAttemptAdmissionState>();

declare const commitAuthorityBrand: unique symbol;
export interface LogicalRelationalParticipantCommitAuthority { readonly [commitAuthorityBrand]: true }
interface LogicalRelationalParticipantCommitAuthorityState {
  readonly participant: string;
  readonly methods: ReadonlySet<string>;
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableIds: ReadonlySet<CatalogTableId>;
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly validateDocument: (tableId: CatalogTableId, document: CanonicalFlarexValueV1) =>
    Result.Result<unknown, LogicalRelationalValueError>;
  readonly verify: (operation: AdmittedParticipantOperationV1,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
    clock: ScopeClockRecord) => Effect.Effect<Readonly<{
      tableIds: ReadonlySet<CatalogTableId>;
      indexes: readonly LocatedAppIndexDefinitionV1[];
      unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
      search: readonly LogicalSearchDefinition[];
      validateDocument: (tableId: CatalogTableId, document: CanonicalFlarexValueV1) =>
        Result.Result<unknown, LogicalRelationalValueError>;
    }>, LogicalRelationalAdmissionError>;
}
const participantCommitAuthorities = new WeakMap<object, LogicalRelationalParticipantCommitAuthorityState>();

/** Trusted preparation only. The final transaction rechecks this exact source
 * and binding head before any selected definition can authorize publication. */
export const inspectLogicalRelationalParticipantCommitAuthority = (
  token: LogicalRelationalParticipantCommitAuthority, operation: AdmittedParticipantOperationV1,
): Readonly<{ schemaVersionId: CatalogSchemaVersionId; tableIds: ReadonlySet<CatalogTableId>;
  indexes: readonly LocatedAppIndexDefinitionV1[]; unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  validateDocument: (tableId: CatalogTableId, document: CanonicalFlarexValueV1) =>
    Result.Result<unknown, LogicalRelationalValueError> }> | null => {
  const state = typeof token === "object" && token !== null ? participantCommitAuthorities.get(token) : undefined;
  return state === undefined || state.participant !== operation.participant || !state.methods.has(operation.method) ||
    state.sourceKey !== operation.sourceKey || state.sourceSha256 !== operation.sourceSha256Hex ||
    operation.effects.some(effect => !state.tableIds.has(effect.tableId)) ? null : Object.freeze({
      schemaVersionId: state.schemaVersionId, tableIds: state.tableIds, indexes: state.indexes, unique: state.unique,
      validateDocument: state.validateDocument,
    });
};

export const hasLogicalRelationalParticipantCommitAuthority = (
  token: LogicalRelationalParticipantCommitAuthority, participant: string, method: string,
): boolean => {
  const state = typeof token === "object" && token !== null ? participantCommitAuthorities.get(token) : undefined;
  return state !== undefined && state.participant === participant && state.methods.has(method);
};

export const requireLogicalRelationalParticipantCommitAuthorityEffect = Effect.fn("LogicalRelationalParticipantCommitAuthority.require")(
  function* (token: LogicalRelationalParticipantCommitAuthority, operation: AdmittedParticipantOperationV1,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const state = typeof token === "object" && token !== null ? participantCommitAuthorities.get(token) : undefined;
    if (state === undefined || state.participant !== operation.participant || !state.methods.has(operation.method))
      return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
    return yield* state.verify(operation, tx, authority, clock);
  });

export const hasLogicalRelationalAttemptAdmission = (
  admission: LogicalRelationalAttemptAdmission, attempt: SessionJournalAttemptV1, method: string,
): boolean => {
  const state = typeof admission === "object" && admission !== null ? attemptAdmissions.get(admission) : undefined;
  return state !== undefined && state.attempt === attempt && state.methods.has(method);
};

export const inspectLogicalRelationalAttemptAdmission = (
  admission: LogicalRelationalAttemptAdmission, attempt: SessionJournalAttemptV1, method: string,
): Readonly<{ root: LogicalRelationalAttemptRoot; sourceKey: string; sourceSha256: string;
  bindingHead: DataBindingHeadToken }> | null => {
  const state = typeof admission === "object" && admission !== null ? attemptAdmissions.get(admission) : undefined;
  return state === undefined || state.attempt !== attempt || !state.methods.has(method) ? null : Object.freeze({
    root: state.root, sourceKey: state.sourceKey, sourceSha256: state.sourceSha256, bindingHead: state.head,
  });
};

/** A short transaction must surround every source/binding recheck. The caller
 * supplies this checked transaction from the exact journal attempt owner. */
export const requireLogicalRelationalAttemptAdmissionInTransactionEffect = Effect.fn("LogicalRelationalAttemptAdmission.require")(
  function* (admission: LogicalRelationalAttemptAdmission, attempt: SessionJournalAttemptV1, method: string,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const state = typeof admission === "object" && admission !== null ? attemptAdmissions.get(admission) : undefined;
    if (state === undefined || state.attempt !== attempt || !state.methods.has(method) ||
      state.root.scopeId !== authority.scopeId || state.root.scopeId !== clock.scopeId ||
      state.root.snapshotCommitSeq > clock.lastCommitSeq ||
      authority.epoch !== clock.epoch || authority.storageGeneration !== clock.storageGeneration ||
      authority.storageGenerationFence !== clock.storageGenerationFence)
      return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
    yield* state.verifyBinding(tx, authority, clock);
    return state;
  });

/** Borrow an authenticated participant without retaining its SQL transaction.
 * Every evaluator read borrows another checked short transaction. */
export const withLogicalRelationalAttemptAdmissionEffect = Effect.fn("LogicalRelationalAttemptAdmission.with")(
  function* <Value, Failure, Requirements>(admission: LogicalRelationalAttemptAdmission,
    attempt: SessionJournalAttemptV1, method: string,
    work: (state: LogicalRelationalAttemptAdmissionState,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
        Effect.Effect<A, E | LogicalRelationalAdmissionError>) => Effect.Effect<Value, Failure, Requirements>) {
    const state = typeof admission === "object" && admission !== null ? attemptAdmissions.get(admission) : undefined;
    if (state === undefined || state.attempt !== attempt || !state.methods.has(method))
      return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
    const checkedRead = <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
      state.readTransaction((tx, authority, clock) =>
        requireLogicalRelationalAttemptAdmissionInTransactionEffect(admission, attempt, method, tx, authority, clock)
          .pipe(Effect.flatMap(() => read(tx))));
    yield* checkedRead(() => Effect.void);
    return yield* work(state, checkedRead);
  });

/** Native semantics remain here; source identity, structural readiness and
 * selected binding evidence are shared with document-source admission. */
export const prepareLogicalRelationalAdmission = Effect.fn("LogicalRelationalAdmission.prepare")(function* (
  ports: AppUniqueConstraintSetBuildPortsV1, unique: AppUniqueConstraintSetEligibilityPortV1,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
  sourceInput: unknown,
) {
  const capturedPorts = Object.freeze({ controlDb: ports.controlDb, authority: ports.authority });
  const capturedInput = Object.freeze({ deploymentId: input.deploymentId, scopeId: input.scopeId,
    schemaVersionId: input.schemaVersionId });
  const owned = yield* Effect.fromResult(capturePrivateJsonData(sourceInput, MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES,
    (reason, cause) => new LogicalRelationalAdmissionError({ reason: "invalidInput", cause: { reason, cause } })));
  const expected = yield* decodeContract(owned.value).pipe(Effect.mapError(cause =>
    new LogicalRelationalAdmissionError({ reason: "invalidInput", cause })));
  const selected = yield* prepareLogicalSourceEvidence(capturedPorts, unique, capturedInput, {
    sourceKey: expected.sourceKey, writeProfile: expected.writeProfile,
    definition: { kind: "relational", schema: expected.schema }, evidence: expected.evidence,
  }, "medusa", "relational").pipe(Effect.catchTag("LogicalSourceAdmissionError", cause => Effect.fail(projectSourceFailure(cause))));
  if (selected.source.definition.kind !== "relational")
    return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "sourceMismatch" }));
  const schema = selected.source.definition.schema;
  const tables = [];
  for (const binding of selected.tables) {
    const definition = schema.tables.find(table => table.identity.tableId === binding.localName);
    if (definition === undefined) return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "sourceMismatch" }));
    tables.push(Object.freeze({ ...binding, definition }));
  }
  const selectedTables = Object.freeze(tables);
  const tableIds = new Set(selectedTables.map(table => table.tableId));
  const search: LogicalSearchDefinition[] = [];
  const requirements = yield* Effect.fromResult(compileLogicalSourceSearches(selected.source)).pipe(
    Effect.mapError(cause => new LogicalRelationalAdmissionError({ reason: "unsupportedProfile", cause })));
  for (const requirement of requirements) {
    const table = selectedTables.find(member => member.localName === requirement.localName);
    if (table === undefined) return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "sourceMismatch" }));
    const identity = yield* getStableLogicalIndexIdentityByNameEffect(capturedPorts.controlDb, {
      deploymentId: capturedInput.deploymentId, tableId: table.tableId, descriptor: requirement.descriptor,
    }).pipe(Effect.mapError(cause => new LogicalRelationalAdmissionError({ reason: "notReady", cause })));
    if (identity === null) return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "notReady" }));
    search.push(Object.freeze({ tableId: table.tableId, logicalIndexId: identity.logicalIndexId,
      sourceSha256: selected.source.sourceSha256, kind: requirement.kind, columns: requirement.columns,
      nullPredicateField: requirement.nullPredicateField }));
  }
  const values = yield* prepareLogicalRelationalValueValidation(capturedPorts.controlDb,
    capturedInput.deploymentId, capturedInput.schemaVersionId);
  const confinedValues = Object.freeze({ validate: (tableId: CatalogTableId, document: Parameters<typeof values.validate>[1]) =>
    tableIds.has(tableId) ? values.validate(tableId, document) : Result.fail(new LogicalRelationalValueError({ reason: "invalidTable" })) });

  const withAdmission = Effect.fn("LogicalRelationalAdmission.withTransaction")(function* <Value, Failure, Requirements>(
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalRelationalAdmission) => Effect.Effect<Value, Failure, Requirements>,
  ) {
    return yield* selected.withBinding(application, tx, authority, clock, binding => {
      // SAFETY: only callback lifetime membership authenticates this inert token.
      const admission = Object.freeze({}) as LogicalRelationalAdmission;
      admissions.set(admission, Object.freeze({ tx, authority, clock, schemaVersionId: binding.schemaVersionId,
        sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256, schema,
        tables: selectedTables, values: confinedValues, indexes: selected.indexes, unique: selected.unique,
        search: Object.freeze(search),
        head: binding.head }));
      return Effect.suspend(() => work(admission)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(admission))));
    });
  });
  const bindAttemptEffect = Effect.fn("LogicalRelationalAttemptAdmission.bind")(function* (
    application: ApplicationBindingInput, attempt: SessionJournalAttemptV1, root: LogicalRelationalAttemptRoot,
    readTransaction: LogicalRelationalAttemptReadTransaction, methods: readonly string[],
  ) {
    if (root.scopeId !== capturedInput.scopeId ||
      root.principalDigest.length === 0 || methods.length === 0 ||
      methods.some(method => method.length === 0) || new Set(methods).size !== methods.length)
      return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
    const pinned = yield* readTransaction((tx, authority, clock) =>
      selected.withBinding(application, tx, authority, clock, binding => {
        if (authority.scopeId !== root.scopeId || clock.scopeId !== root.scopeId ||
          clock.lastCommitSeq < root.snapshotCommitSeq || binding.schemaVersionId !== capturedInput.schemaVersionId)
          return Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
        return Effect.succeed(Object.freeze({ head: binding.head, clock }));
      }).pipe(Effect.mapError(projectBindingFailure)));
    const verifyBinding = (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
      selected.withBinding(application, tx, authority, clock, binding =>
        binding.schemaVersionId === capturedInput.schemaVersionId &&
        binding.head.sequence === pinned.head.sequence && binding.head.sha256 === pinned.head.sha256 &&
        authority.scopeId === root.scopeId && clock.scopeId === root.scopeId
          ? Effect.void : Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" })))
        .pipe(Effect.mapError(projectBindingFailure));
    // SAFETY: only the issuer's WeakMap membership authenticates this opaque, inert capability.
    const token = Object.freeze({}) as LogicalRelationalAttemptAdmission;
    attemptAdmissions.set(token, Object.freeze({ attempt, root: Object.freeze({ ...root }),
      methods: new Set(methods), readTransaction, verifyBinding,
      clock: pinned.clock, schemaVersionId: capturedInput.schemaVersionId, sourceKey: selected.source.key,
      sourceSha256: selected.source.sourceSha256, schema, tables: selectedTables,
      values: confinedValues, indexes: selected.indexes, unique: selected.unique,
      search: Object.freeze(search), head: pinned.head }));
    return token;
  });
  const createCommitAuthority = (application: ApplicationBindingInput, participant: string,
    methods: readonly string[]): LogicalRelationalParticipantCommitAuthority => {
    // SAFETY: trusted publisher construction registers this opaque token before it can authorize a method.
    const token = Object.freeze({}) as LogicalRelationalParticipantCommitAuthority;
    const allowed = new Set(methods);
    if (participant.length === 0 || allowed.size === 0 || allowed.size !== methods.length ||
      methods.some(method => method.length === 0)) return token;
    participantCommitAuthorities.set(token, Object.freeze({ participant, methods: allowed,
      sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256,
      schemaVersionId: capturedInput.schemaVersionId, tableIds, indexes: selected.indexes, unique: selected.unique,
      validateDocument: confinedValues.validate,
      verify: (operation: AdmittedParticipantOperationV1, tx: FlarexMetadataTransaction,
        authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
        selected.withBinding(application, tx, authority, clock, binding => {
        if (authority.scopeId !== capturedInput.scopeId || clock.scopeId !== capturedInput.scopeId ||
          binding.schemaVersionId !== capturedInput.schemaVersionId ||
          operation.sourceKey !== selected.source.key ||
          operation.sourceSha256Hex !== selected.source.sourceSha256 ||
          operation.bindingHead.sequence !== binding.head.sequence ||
          operation.bindingHead.sha256 !== binding.head.sha256)
          return Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
        const admittedTableIds = new Set(selectedTables.map(table => table.tableId));
        if (operation.effects.some(effect => !admittedTableIds.has(effect.tableId)))
          return Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
        return Effect.succeed(Object.freeze({ tableIds: admittedTableIds, indexes: selected.indexes,
          unique: selected.unique, search: Object.freeze(search), validateDocument: confinedValues.validate }));
      }).pipe(Effect.mapError(projectBindingFailure)),
    }));
    return token;
  };
  return Object.freeze({ withAdmission, bindAttemptEffect, createCommitAuthority });
});

export const requireLogicalRelationalAdmission = Effect.fn("LogicalRelationalAdmission.require")(function* (
  admission: LogicalRelationalAdmission, tx: FlarexMetadataTransaction,
) {
  const state = admissions.get(admission);
  if (state === undefined || state.tx !== tx) return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
  return state;
});
