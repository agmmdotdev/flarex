import { Data, Effect, Result, Schema } from "effect";
import { prepareLogicalReadAdmission, requireLogicalReadAdmission, LogicalReadAdmissionError,
  type LogicalReadAdmission, type ManagedLogicalReadPorts, type LogicalReadSelection } from "./readAdmission";
import type { LogicalSourceReadPin } from "../logicalReadMetadata";

export type LogicalRelationalReadAdmission = LogicalReadAdmission;
export const prepareLogicalRelationalReadAdmission = (ports: ManagedLogicalReadPorts,
  input: LogicalReadSelection, pin: LogicalSourceReadPin) => prepareLogicalReadAdmission(ports, input, pin, "medusa");
export const requireLogicalRelationalReadAdmission = Effect.fn("LogicalRelationalReadAdmission.require")(function* (
  token: LogicalRelationalReadAdmission, tx: FlarexMetadataTransaction,
) {
  const state = yield* requireLogicalReadAdmission(token, tx);
  if (state.root.owner !== "medusa" || state.root.kind !== "relational")
    return yield* Effect.fail(new LogicalReadAdmissionError({ reason: "invalidAuthority" }));
  return state;
});
import type { CatalogTableId } from "flarex-protocol/catalog";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import type { RelationalSchema, RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { compileLogicalSourceSearches } from "flarex-protocol/internal/logical-storage-requirements";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { AdmittedParticipantOperation, SourceContribution } from "flarex-protocol/commit-protocol";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { ApplicationBindingInput } from "../applicationActivation";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { DataBindingHeadToken } from "../frameworkSchema/binding/model";
import { DataBindingError } from "../frameworkSchema/binding/errors";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturePrivateJsonData } from "../privateJsonData";
import type { ScopeClockRecord } from "../scopeClock";
import type { SessionJournalAttempt } from "../sessionJournalStore";
import { getStableLogicalIndexIdentityByNameEffect } from "../stableLogicalIndexCatalog";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import { prepareLogicalSourceEvidence, LogicalSourceAdmissionError, type LogicalSourceBindingState, type LogicalSourceConstruction } from "./sourceAdmission";
import { prepareLogicalRelationalValueValidation, LogicalRelationalValueError } from "./relationalValues";
import type { PreparedLogicalRelationalTableMechanics } from "./relationalRows";
import type { LogicalSearchDefinition } from "./searchEntries";
import type { LogicalStorageReadReadiness, LogicalStorageReadDemand, PreparedLogicalDocumentWriteMechanics } from "./model";
import { prepareLogicalWriteMechanics } from "./workingSet";
import { issueLogicalParticipantAttemptAdmission, issueLogicalParticipantCommitAuthority,
  withLogicalParticipantAttemptAdmissionEffect, LogicalParticipantAdmissionError,
  type LogicalParticipantAttemptAdmission, type LogicalParticipantAttemptRoot,
  type LogicalParticipantAttemptReadTransaction, type LogicalParticipantCommitAuthority, type LogicalParticipantSelection } from "./participantAdmission";

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
  if (cause instanceof LogicalSourceAdmissionError) return projectSourceFailure(cause);
  if (cause instanceof DataBindingError) {
    const reason = cause.reason === "resourceFailure" || cause.reason === "decisionUncertain"
      ? "resourceFailure" : cause.reason === "storedCorruption" ? "storedCorruption" : "invalidAuthority";
    return new LogicalRelationalAdmissionError({ reason, cause });
  }
  return new LogicalRelationalAdmissionError({ reason: "resourceFailure", cause });
};
const projectParticipantBindingFailure = (cause: unknown): LogicalParticipantAdmissionError => {
  if (cause instanceof LogicalParticipantAdmissionError) return cause;
  const projected = projectBindingFailure(cause);
  return new LogicalParticipantAdmissionError({ reason: projected.reason, cause: projected });
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
  readonly tables: readonly Readonly<{ localName: string; tableId: CatalogTableId; definition: RelationalTableDefinition;
    mechanics: PreparedLogicalRelationalTableMechanics }>[];
  readonly values: Effect.Success<ReturnType<typeof prepareLogicalRelationalValueValidation>>;
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly search: readonly LogicalSearchDefinition[];
  readonly readReadiness: LogicalStorageReadReadiness<LogicalRelationalAdmissionError>;
  readonly tableNames: Pick<ReadonlyMap<CatalogTableId, string>, "get">;
}
const admissions = new WeakMap<object, LogicalRelationalAdmissionState>();

/** Source-specific fields used only by the native Product evaluator. The
 * neutral issuer owns the opaque token, exact attempt and checked reads. */
export interface LogicalRelationalAttemptAdmissionState extends Omit<LogicalRelationalAdmissionState, "tx" | "authority" | "readReadiness"> {
  readonly writeMechanics: PreparedLogicalDocumentWriteMechanics;
  readonly root: LogicalParticipantAttemptRoot;
  readonly preparedSource: object;
  readonly requirePreparedSource: Effect.Effect<void, LogicalParticipantAdmissionError>;
}
const relationalAttemptStates = new WeakMap<object, LogicalRelationalAttemptAdmissionState>();

export const withLogicalRelationalAttemptAdmissionEffect = Effect.fn("LogicalRelationalAttemptAdmission.with")(
  function* <Prepared, Value, PreparationFailure, Failure, Requirements>(admission: LogicalParticipantAttemptAdmission,
    attempt: SessionJournalAttempt, method: string,
    prepare: (state: LogicalRelationalAttemptAdmissionState,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>,
      tx: FlarexMetadataTransaction | undefined) => Effect.Effect<Prepared, PreparationFailure>,
    work: (state: LogicalRelationalAttemptAdmissionState,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>, prepared: Prepared) => Effect.Effect<Value, Failure, Requirements>) {
    return yield* withLogicalParticipantAttemptAdmissionEffect(admission, attempt, method,
      (_, tx, checkedRead) => Effect.gen(function* () {
      const state = relationalAttemptStates.get(admission);
      if (state === undefined) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
      yield* state.requirePreparedSource;
      return Object.freeze({ state, prepared: yield* prepare(state, checkedRead, tx) });
    }), (_, checkedRead, result) => work(result.state, checkedRead, result.prepared));
  });
/** Native semantics remain here; source identity, structural readiness and
 * selected binding evidence are shared with document-source admission. */
export const prepareLogicalRelationalAdmission = Effect.fn("LogicalRelationalAdmission.prepare")(function* (
  ports: AppUniqueConstraintSetBuildPortsV1, unique: AppUniqueConstraintSetEligibilityPortV1,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
  sourceInput: unknown,
  construction: LogicalSourceConstruction,
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
  }, "medusa", "relational", construction).pipe(Effect.catchTag("LogicalSourceAdmissionError", cause => Effect.fail(projectSourceFailure(cause))));
  if (selected.source.definition.kind !== "relational")
    return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "sourceMismatch" }));
  const schema = selected.source.definition.schema;
  const tables = [];
  for (const binding of selected.tables) {
    const definition = schema.tables.find(table => table.identity.tableId === binding.localName);
    const mechanics = selected.catalog.relationalTableMechanics(binding.tableId);
    if (definition === undefined || mechanics === undefined || mechanics.table !== definition)
      return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "sourceMismatch" }));
    tables.push(Object.freeze({ ...binding, definition, mechanics }));
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
    capturedInput.deploymentId, capturedInput.schemaVersionId, { kind: "prepared", requirements: selected.requirements,
      tableMechanics: selected.catalog.relationalTableMechanics });
  const confinedValues = Object.freeze({ validate: (tableId: CatalogTableId, document: Parameters<typeof values.validate>[1]) =>
    tableIds.has(tableId) ? values.validate(tableId, document) : Result.fail(new LogicalRelationalValueError({ reason: "invalidTable" })) });
  const writeMechanics = yield* prepareLogicalWriteMechanics({
    metadataProjection: selected.metadataProjection,
    tables: selectedTables.map(table => ({ tableId: table.tableId, logicalName: table.localName,
      relational: table.definition, relationalMechanics: table.mechanics })),
    relationalCapabilities: schema.capabilities, searchDefinitions: search,
    indexes: selected.indexes.filter(index => index.access.kind === "developer"), unique: selected.unique,
  }, (reason, cause) => new LogicalRelationalAdmissionError({ reason: reason === "resourceFailure" || reason === "limitExceeded"
    ? "resourceFailure" : reason === "closed" ? "invalidAuthority" : "invalidInput", cause }));
  const tableNames = Object.freeze({ get: writeMechanics.tableName });
  const withSelectedAdmission = Effect.fn("LogicalRelationalAdmission.withTransaction")(function* <Value, Failure, Requirements>(
    profile: "full" | "read",
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalRelationalAdmission) => Effect.Effect<Value, Failure, Requirements>,
  ) {
    const accept = profile === "read" ? selected.withTransactionReadBinding : selected.withTransactionBinding;
    return yield* accept(application, tx, authority, clock, (binding): Effect.Effect<Value, Failure | LogicalRelationalAdmissionError, Requirements> => {
      // SAFETY: only callback lifetime membership authenticates this inert token.
      const admission = Object.freeze({}) as LogicalRelationalAdmission;
      admissions.set(admission, Object.freeze({ tx, authority, clock, schemaVersionId: binding.schemaVersionId,
        sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256, schema,
        tables: selectedTables, tableNames, values: confinedValues, indexes: selected.indexes, unique: selected.unique,
        search: Object.freeze(search),
        readReadiness: Object.freeze({ kind: "full" as const }),
        head: binding.head }));
      return Effect.suspend(() => work(admission)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(admission))));
    });
  });
  const withAdmission = <Value, Failure, Requirements>(
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalRelationalAdmission) => Effect.Effect<Value, Failure, Requirements>,
  ) => withSelectedAdmission("full", application, tx, authority, clock, work);
  const withReadAdmission = <Value, Failure, Requirements>(
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalRelationalAdmission) => Effect.Effect<Value, Failure, Requirements>,
  ) => withSelectedAdmission("read", application, tx, authority, clock, work);
  const bindAttemptEffect = Effect.fn("LogicalRelationalAttemptAdmission.bind")(function* (
    application: ApplicationBindingInput, attempt: SessionJournalAttempt, root: LogicalParticipantAttemptRoot,
    readTransaction: LogicalParticipantAttemptReadTransaction, methods: readonly string[],
    entry?: Parameters<LogicalParticipantSelection["bindAttemptEffect"]>[5],
  ) {
    if (entry?.applicationBinding !== undefined && entry.applicationBinding.selection !== prepared)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    if (root.scopeId !== capturedInput.scopeId ||
      root.principalDigest.length === 0 || methods.length === 0 ||
      methods.some(method => method.length === 0) || new Set(methods).size !== methods.length)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const pin = (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) => Effect.gen(function* () {
      const validatePin = (binding: LogicalSourceBindingState) =>
        authority.scopeId !== root.scopeId || clock.scopeId !== root.scopeId ||
          clock.lastCommitSeq < root.snapshotCommitSeq || binding.schemaVersionId !== capturedInput.schemaVersionId
          ? Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" })) : Effect.void;
      if (root.executionProfile === "finiteRoot") {
        if (entry?.finiteMetadata === undefined)
          return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
        return yield* selected.pinFiniteReadBinding(application, attempt, tx, authority, clock, validatePin, root, entry.finiteMetadata);
      }
      return yield* selected.withBinding(application, tx, authority, clock, binding => validatePin(binding).pipe(
        Effect.as(Object.freeze({ head: binding.head, clock, frame: binding.frame, metadata: undefined }))));
    }).pipe(Effect.mapError(projectParticipantBindingFailure));
    const pinned = yield* (entry === undefined ? readTransaction((tx, authority, observation) =>
      "lastCommitSeq" in observation ? pin(tx, authority, observation)
        : Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" })))
      : pin(entry.tx, entry.authority, entry.clock));
    const verifyPinnedBinding = (binding: Pick<LogicalSourceBindingState, "schemaVersionId" | "head">,
      authority: TrustedScopeAuthority, clock: Pick<ScopeClockRecord, "scopeId">) =>
        binding.schemaVersionId === capturedInput.schemaVersionId &&
        binding.head.sequence === pinned.head.sequence && binding.head.sha256 === pinned.head.sha256 &&
        authority.scopeId === root.scopeId && clock.scopeId === root.scopeId
          ? Effect.void : Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const verifyBinding = (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
      selected.withBinding(application, tx, authority, clock, binding => verifyPinnedBinding(binding, authority, clock))
        .pipe(Effect.mapError(projectParticipantBindingFailure));
    const token = issueLogicalParticipantAttemptAdmission(Object.freeze({ attempt, root: Object.freeze({ ...root }),
      preparedSource: prepared,
      ...(pinned.metadata === undefined ? {} : { metadata: pinned.metadata }),
      methods: new Set(methods), readTransaction, verifyBinding, tableIds,
      indexes: selected.indexes, unique: selected.unique,
      sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256, head: pinned.head }));
    relationalAttemptStates.set(token, Object.freeze({ root: Object.freeze({ ...root }),
      preparedSource: prepared, writeMechanics,
      requirePreparedSource: selected.requirePrepared.pipe(Effect.mapError(projectParticipantBindingFailure)),
      clock: pinned.clock, schemaVersionId: capturedInput.schemaVersionId, sourceKey: selected.source.key,
      sourceSha256: selected.source.sourceSha256, schema, tables: selectedTables, tableNames,
      values: confinedValues, indexes: selected.indexes, unique: selected.unique,
      search: Object.freeze(search), head: pinned.head }));
    return token;
  });
  const createCommitAuthority = (application: ApplicationBindingInput, participant: string,
    methods: readonly string[]): LogicalParticipantCommitAuthority => {
    const allowed = new Set(methods);
    if (participant.length === 0 || allowed.size === 0 || allowed.size !== methods.length ||
      methods.some(method => method.length === 0)) return issueLogicalParticipantCommitAuthority(Object.freeze({
        participant: "", methods: new Set<string>(), sourceKey: selected.source.key,
        sourceSha256: selected.source.sourceSha256, schemaVersionId: capturedInput.schemaVersionId,
        tableIds, indexes: selected.indexes, unique: selected.unique, search: Object.freeze(search),
        validateDocument: () => Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" })),
        verify: () => Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" })),
      }));
    return issueLogicalParticipantCommitAuthority(Object.freeze({ participant, methods: allowed,
      sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256,
      schemaVersionId: capturedInput.schemaVersionId, tableIds, indexes: selected.indexes, unique: selected.unique,
      search: Object.freeze(search),
      validateDocument: (tableId: CatalogTableId, document: CanonicalFlarexValueV1) => confinedValues.validate(tableId, document).pipe(
        Result.mapError(cause => new LogicalParticipantAdmissionError({ reason: "documentInvalid", cause }))),
      metadataProjection: selected.metadataProjection,
      prepareFiniteTables: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord, touchedTableIds: readonly CatalogTableId[]) =>
        selected.prepareFiniteCommitClosureObservation(tx, authority, clock, touchedTableIds).pipe(Result.map(prepared => ({
          pages: prepared.pages, accept: (observation: unknown) => prepared.accept(observation).pipe(Effect.mapError(projectParticipantBindingFailure)),
        }))),
      verifyFinite: (_operation: AdmittedParticipantOperation, contribution: SourceContribution,
        tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
        selected.readFiniteCommitClosure(tx, authority, clock, [...new Set(contribution.effects.map(effect => effect.tableId))])
          .pipe(Effect.mapError(projectParticipantBindingFailure)),
      verify: (_operation: AdmittedParticipantOperation, contribution: SourceContribution,
        tx: FlarexMetadataTransaction,
        authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
        selected.withBinding(application, tx, authority, clock, binding => {
        if (authority.scopeId !== capturedInput.scopeId || clock.scopeId !== capturedInput.scopeId ||
          binding.schemaVersionId !== capturedInput.schemaVersionId ||
          contribution.sourceKey !== selected.source.key ||
          contribution.sourceSha256Hex !== selected.source.sourceSha256 ||
          contribution.bindingHead.sequence !== binding.head.sequence ||
          contribution.bindingHead.sha256 !== binding.head.sha256)
          return Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
        const admittedTableIds = new Set(selectedTables.map(table => table.tableId));
        if (contribution.effects.some(effect => !admittedTableIds.has(effect.tableId)))
          return Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
        return Effect.void;
      }).pipe(Effect.mapError(projectParticipantBindingFailure)),
    }));
  };
  const prepared = Object.freeze({ withAdmission, withReadAdmission, bindAttemptEffect, createCommitAuthority });
  return prepared;
});

export const requireLogicalRelationalAdmission = Effect.fn("LogicalRelationalAdmission.require")(function* (
  admission: LogicalRelationalAdmission, tx: FlarexMetadataTransaction,
) {
  const state = admissions.get(admission);
  if (state === undefined || state.tx !== tx) return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
  return state;
});
