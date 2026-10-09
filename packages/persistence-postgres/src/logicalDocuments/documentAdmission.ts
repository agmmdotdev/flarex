import type { LogicalStorageReadDemand } from "./model";
import { Cause, Data, Effect, Result, Schema } from "effect";
import { prepareLogicalReadAdmission, requireLogicalReadAdmission, LogicalReadAdmissionError,
  type LogicalReadAdmission, type ManagedLogicalReadPorts, type LogicalReadSelection } from "./readAdmission";
import type { LogicalSourceReadPin } from "../logicalReadMetadata";

export type LogicalDocumentReadAdmission = LogicalReadAdmission;
export const prepareLogicalDocumentReadAdmission = (ports: ManagedLogicalReadPorts,
  input: LogicalReadSelection, pin: LogicalSourceReadPin) => prepareLogicalReadAdmission(ports, input, pin, "payload");
export const requireLogicalDocumentReadAdmission = Effect.fn("LogicalDocumentReadAdmission.require")(function* (
  token: LogicalDocumentReadAdmission, tx: FlarexMetadataTransaction,
) {
  const state = yield* requireLogicalReadAdmission(token, tx);
  if (state.root.owner !== "payload" || state.root.kind !== "documents" || state.root.contentIdentity === null)
    return yield* Effect.fail(new LogicalReadAdmissionError({ reason: "invalidAuthority" }));
  return Object.freeze({ ...state, contentIdentity: state.root.contentIdentity });
});
import { PayloadConfigurationSchema, verifyApplicationWritePolicies,
  type PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";
import { AppDocumentIdV1Schema, requireAppDocumentIdentityV1ForTableResult } from "flarex-protocol/app-document-id";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogSchemaVersionId, SchemaManifestAppTableDeclarationV1 } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { isCanonicalFlarexRuntimeObjectV1, type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { validateValidatorValueV1, type ValidatorIdPolicyV1 } from "flarex-protocol/validator-engine";
import type { ApplicationBindingInput, AcceptedApplicationBinding, ApplicationBindingObservation } from "../applicationActivation";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { DataBindingHeadToken, DataBindingSetFrame } from "../frameworkSchema/binding/model";
import { DataBindingError } from "../frameworkSchema/binding/errors";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturePrivateJsonData } from "../privateJsonData";
import type { ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { LogicalDocumentWrite, LogicalStorageReadReadiness, PreparedLogicalDocumentWriteMechanics } from "./model";
import { prepareLogicalWriteMechanics } from "./workingSet";
import { prepareLogicalSourceEvidence, LogicalSourceAdmissionError, type LogicalSourceBindingState, type LogicalSourceConstruction } from "./sourceAdmission";
import { issueLogicalParticipantAttemptAdmission, issueLogicalParticipantCommitAuthority,
  withLogicalParticipantAttemptAdmissionEffect, LogicalParticipantAdmissionError,
  type LogicalParticipantAttemptAdmission, type LogicalParticipantAttemptRoot,
  type LogicalParticipantAttemptReadTransaction, type LogicalParticipantCommitAuthority, type LogicalParticipantSelection } from "./participantAdmission";
import type { SessionJournalAttempt } from "../sessionJournalStore";
import type { AdmittedParticipantOperation, SourceContribution } from "flarex-protocol/commit-protocol";

export class LogicalDocumentSourceAdmissionError extends Data.TaggedError("LogicalDocumentSourceAdmissionError")<{
  readonly reason: "invalidInput" | "sourceMismatch" | "notReady" | "bindingMissing" | "invalidAuthority" | "documentInvalid" | "resourceFailure" | "unsupportedProfile";
  readonly cause?: unknown;
}> {}

const SourceContract = Schema.Struct({
  sourceKey: Schema.Literal("payload"), writeProfile: Schema.NonEmptyString,
  definition: Schema.Json, evidence: Schema.Json, configuration: PayloadConfigurationSchema,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeContract = Schema.decodeUnknownEffect(SourceContract);
const decodeDocumentId = Schema.decodeUnknownResult(AppDocumentIdV1Schema);
const decodeCreationTime = Schema.decodeUnknownResult(AppCreationTimeV1Schema);
const projectSourceFailure = (cause: LogicalSourceAdmissionError) =>
  new LogicalDocumentSourceAdmissionError({ reason: cause.reason, cause });
const projectAttemptFailure = (cause: unknown): LogicalParticipantAdmissionError => {
  if (cause instanceof LogicalParticipantAdmissionError) return cause;
  if (cause instanceof LogicalSourceAdmissionError) return new LogicalParticipantAdmissionError({ reason: cause.reason, cause });
  if (cause instanceof LogicalDocumentSourceAdmissionError) return new LogicalParticipantAdmissionError({ reason: cause.reason, cause });
  if (cause instanceof DataBindingError) return new LogicalParticipantAdmissionError({
    reason: cause.reason === "resourceFailure" || cause.reason === "decisionUncertain" ? "resourceFailure" :
      cause.reason === "storedCorruption" ? "storedCorruption" : "invalidAuthority", cause,
  });
  return new LogicalParticipantAdmissionError({ reason: "resourceFailure", cause });
};
const canonical = (value: Json) => encodeCanonicalJson(value, () => { throw new Error("Owned Payload policy is not JSON"); });

declare const admissionBrand: unique symbol;
export interface LogicalDocumentSourceAdmission { readonly [admissionBrand]: true }
export interface LogicalDocumentSourceTable {
  readonly localName: string;
  readonly tableId: CatalogTableId;
  readonly definition: SchemaManifestAppTableDeclarationV1;
}
export interface LogicalDocumentSourceAdmissionState {
  readonly tableIds: ReadonlySet<CatalogTableId>;
  readonly writeMechanics: PreparedLogicalDocumentWriteMechanics;
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly head: DataBindingHeadToken;
  readonly frame: DataBindingSetFrame;
  readonly contentIdentity: Readonly<{ configSha256: string; provenanceSha256: string }>;
  readonly configuration: PayloadConfiguration;
  readonly tables: readonly LogicalDocumentSourceTable[];
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly readReadiness: LogicalStorageReadReadiness<LogicalDocumentSourceAdmissionError>;
  readonly validate: (write: LogicalDocumentWrite) => Result.Result<void, LogicalDocumentSourceAdmissionError>;
}

/** Original source mechanics only; no transaction or Application acceptance. */
export interface LogicalDocumentSourcePreparation {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly tables: readonly LogicalDocumentSourceTable[];
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly tableIds: ReadonlySet<CatalogTableId>;
  readonly tablesById: ReadonlyMap<CatalogTableId, LogicalDocumentSourceTable>;
  readonly validate: LogicalDocumentSourceAdmissionState["validate"];
  readonly writeMechanics: PreparedLogicalDocumentWriteMechanics;
  readonly lifetime: import("../preparedHostRuntime").PreparedHostPreparationLifetime;
  readonly requirePrepared: Effect.Effect<void, LogicalParticipantAdmissionError>;
}
const admissions = new WeakMap<object, LogicalDocumentSourceAdmissionState>();
const sourceLookupDisposal = (ids: Set<CatalogTableId>, tables: Map<CatalogTableId, LogicalDocumentSourceTable>) => () => {
  ids.clear(); tables.clear();
};
export interface LogicalDocumentAttemptAdmissionState extends Omit<LogicalDocumentSourceAdmissionState, "tx" | "authority" | "readReadiness"> {
  readonly writeMechanics: PreparedLogicalDocumentWriteMechanics;
  readonly root: LogicalParticipantAttemptRoot;
  readonly preparedSource: object;
  readonly requirePreparedSource: Effect.Effect<void, LogicalParticipantAdmissionError>;
}
const attemptStates = new WeakMap<object, LogicalDocumentAttemptAdmissionState>();

export const withLogicalDocumentAttemptAdmissionEffect = Effect.fn("LogicalDocumentAttemptAdmission.with")(
  function* <Prepared, Value, PreparationFailure, Failure, Requirements>(admission: LogicalParticipantAttemptAdmission,
    attempt: SessionJournalAttempt, method: string,
    prepare: (state: LogicalDocumentAttemptAdmissionState,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>,
      tx: FlarexMetadataTransaction | undefined) => Effect.Effect<Prepared, PreparationFailure>,
    work: (state: LogicalDocumentAttemptAdmissionState,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>, prepared: Prepared) => Effect.Effect<Value, Failure, Requirements>) {
    return yield* withLogicalParticipantAttemptAdmissionEffect(admission, attempt, method,
      (_, tx, checkedRead) => Effect.gen(function* () {
      const state = attemptStates.get(admission);
      if (state === undefined) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
      yield* state.requirePreparedSource;
      return Object.freeze({ state, prepared: yield* prepare(state, checkedRead, tx) });
    }), (_, checkedRead, result) => work(result.state, checkedRead, result.prepared));
  });

/** Payload's compiler supplies actual configuration, declarations and policy.
 * The shared candidate, structural catalog and selected binding authenticate
 * them; a namespace or collection label alone never grants write access. */
export const prepareLogicalDocumentSourceAdmission = Effect.fn("LogicalDocumentSourceAdmission.prepare")(function* (
  ports: AppUniqueConstraintSetBuildPortsV1, unique: AppUniqueConstraintSetEligibilityPortV1,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
  sourceInput: unknown,
  construction: LogicalSourceConstruction,
) {
  const capturedPorts = Object.freeze({ controlDb: ports.controlDb, authority: ports.authority });
  const capturedInput = Object.freeze({ deploymentId: input.deploymentId, scopeId: input.scopeId,
    schemaVersionId: input.schemaVersionId });
  const captured = yield* Effect.fromResult(capturePrivateJsonData(sourceInput, MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES,
    (reason, cause) => new LogicalDocumentSourceAdmissionError({ reason: "invalidInput", cause: { reason, cause } })));
  const expected = yield* decodeContract(captured.value).pipe(Effect.mapError(cause =>
    new LogicalDocumentSourceAdmissionError({ reason: "invalidInput", cause })));
  const declaredNames = expected.configuration.tables.map(table => table.logicalTableName);
  const policy = yield* verifyApplicationWritePolicies(expected.evidence, declaredNames).pipe(Effect.mapError(cause =>
    new LogicalDocumentSourceAdmissionError({ reason: cause.reason === "digestUnavailable" ? "resourceFailure" : "sourceMismatch", cause })));
  if (canonical(policy.policies.configuration) !== canonical(expected.configuration) ||
      expected.writeProfile !== expected.configuration.profile)
    return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "sourceMismatch" }));
  const firstPolicy = policy.policies.tables[0];
  if (firstPolicy === undefined || firstPolicy.owner !== "payload")
    return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "sourceMismatch" }));
  const contentIdentity = Object.freeze({ configSha256: firstPolicy.configSha256,
    provenanceSha256: firstPolicy.provenanceSha256 });
  const selected = yield* prepareLogicalSourceEvidence(capturedPorts, unique, capturedInput, {
    sourceKey: expected.sourceKey, writeProfile: expected.writeProfile,
    definition: expected.definition, evidence: expected.evidence,
  }, "payload", "documents", construction, { owner: "payload", writeProfile: expected.writeProfile, ...contentIdentity })
    .pipe(Effect.catchTag("LogicalSourceAdmissionError", cause => Effect.fail(projectSourceFailure(cause))));
  if (selected.source.definition.kind !== "documents" || selected.source.bindings.some(binding => binding.kind !== "definition"))
    return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "sourceMismatch" }));
  const definitions = selected.source.definition.tables;
  if (definitions.length !== declaredNames.length || definitions.some(table => !declaredNames.includes(table.logicalName)))
    return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "sourceMismatch" }));
  const tables = [];
  for (const binding of selected.tables) {
    const definition = definitions.find(table => table.logicalName === binding.localName);
    if (definition === undefined) return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "sourceMismatch" }));
    tables.push(Object.freeze({ ...binding, definition }));
  }
  const selectedTables = Object.freeze(tables);
  const writeMechanics = yield* prepareLogicalWriteMechanics({
    metadataProjection: selected.metadataProjection,
    tables: selectedTables.map(table => ({ tableId: table.tableId, logicalName: table.localName })),
    indexes: selected.indexes.filter(index => index.access.kind === "developer"), unique: selected.unique,
  }, (reason, cause) => new LogicalDocumentSourceAdmissionError({ reason: reason === "resourceFailure" || reason === "limitExceeded"
    ? "resourceFailure" : reason === "closed" ? "invalidAuthority" : "invalidInput", cause }));
  const idPolicy: ValidatorIdPolicyV1 = Object.freeze({ mode: "tableAware", check: (tableName, value) => {
    if (tableName.startsWith("_")) return "unavailable";
    const table = selectedTables.find(member => member.localName === tableName);
    return table === undefined ? "unavailable" : Result.isSuccess(requireAppDocumentIdentityV1ForTableResult(value, table.tableId))
      ? "valid" : "invalid";
  } });
  const validate = (write: LogicalDocumentWrite): Result.Result<void, LogicalDocumentSourceAdmissionError> => Result.gen(function* () {
    const table = selectedTables.find(member => member.localName === write.tableName && member.tableId === write.tableId);
    if (table === undefined) return yield* Result.fail(new LogicalDocumentSourceAdmissionError({ reason: "invalidAuthority" }));
    const value = write.document.value;
    if (!isCanonicalFlarexRuntimeObjectV1(value) || value._id !== write.documentId || value._creationTime !== write.creationTime)
      return yield* Result.fail(new LogicalDocumentSourceAdmissionError({ reason: "documentInvalid" }));
    const fields: Record<string, CanonicalFlarexRuntimeValueV1> = {};
    for (const [field, item] of Object.entries(value)) {
      if (field === "_id" || field === "_creationTime") continue;
      if (field.startsWith("_")) return yield* Result.fail(new LogicalDocumentSourceAdmissionError({ reason: "documentInvalid" }));
      Object.defineProperty(fields, field, { value: item, enumerable: true });
    }
    yield* validateValidatorValueV1(table.definition.definition.documentType, Object.freeze(fields),
      { path: "$document", idPolicy }).pipe(Result.mapError(cause =>
        new LogicalDocumentSourceAdmissionError({ reason: "documentInvalid", cause })));
  });
  const withSelectedAdmission = Effect.fn("LogicalDocumentSourceAdmission.withTransaction")(function* <Value, Failure, Requirements>(
    profile: "full" | "read",
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalDocumentSourceAdmission, accepted?: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
    borrowed?: ApplicationBindingObservation,
  ) {
    const accept = profile === "read" ? selected.withTransactionReadBinding : selected.withTransactionBinding;
    return yield* accept(application, tx, authority, clock, (binding, accepted) => Effect.gen(function* () {
      // The source-bound scalar participant has no V3 preference cleanup or
      // embedded-content owner. Refuse mixed selected frames before token issue.
      if (binding.frame.payloadContent !== null || binding.frame.payloadLifecycle !== null)
        return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "unsupportedProfile" }));
      // SAFETY: only callback lifetime membership authenticates this token.
      const admission = Object.freeze({}) as LogicalDocumentSourceAdmission;
      admissions.set(admission, Object.freeze({ tx, authority, clock, schemaVersionId: binding.schemaVersionId,
        sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256, head: binding.head,
        frame: binding.frame, contentIdentity,
        configuration: expected.configuration, tables: selectedTables, tableIds, indexes: selected.indexes,
        unique: selected.unique, validate, writeMechanics,
        readReadiness: Object.freeze({ kind: "full" as const }) }));
      return yield* Effect.suspend(() => work(admission, accepted)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(admission))));
    }), borrowed);
  });
  const withAdmission = <Value, Failure, Requirements>(
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalDocumentSourceAdmission, accepted?: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
    borrowed?: ApplicationBindingObservation,
  ) => withSelectedAdmission("full", application, tx, authority, clock, work, borrowed);
  const withReadAdmission = <Value, Failure, Requirements>(
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalDocumentSourceAdmission, accepted?: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
    borrowed?: ApplicationBindingObservation,
  ) => withSelectedAdmission("read", application, tx, authority, clock, work, borrowed);
  const tableIds = new Set(selectedTables.map(table => table.tableId));
  const tablesById = new Map(selectedTables.map(table => [table.tableId, table]));
  if (selected.preparationLifetime !== undefined) {
    yield* Effect.fromResult(selected.preparationLifetime.charge({ tableIds: [...tableIds], tableLookup: [...tablesById.keys()] }))
      .pipe(Effect.mapError(cause => new LogicalDocumentSourceAdmissionError({ reason: "resourceFailure", cause })));
    yield* Effect.fromResult(selected.preparationLifetime.onDispose(sourceLookupDisposal(tableIds, tablesById)))
      .pipe(Effect.mapError(cause => new LogicalDocumentSourceAdmissionError({ reason: "resourceFailure", cause })));
  }
  const lendPreparation = Effect.fn("LogicalDocumentSourceAdmission.lendPreparation")(function* () {
    yield* selected.requirePrepared;
    const lifetime = selected.preparationLifetime;
    if (lifetime === undefined) return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "invalidAuthority" }));
    yield* Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      new LogicalDocumentSourceAdmissionError({ reason: "invalidAuthority", cause })));
    const preparation: LogicalDocumentSourcePreparation = Object.freeze({
      deploymentId: capturedInput.deploymentId, scopeId: capturedInput.scopeId, schemaVersionId: capturedInput.schemaVersionId,
      sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256,
      tables: selectedTables, indexes: selected.indexes, unique: selected.unique, tableIds, tablesById,
      validate, writeMechanics, lifetime, requirePrepared: selected.requirePrepared.pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectAttemptFailure)))),
    });
    return preparation;
  });
  const bindAttemptEffect = Effect.fn("LogicalDocumentAttemptAdmission.bind")(function* (
    application: ApplicationBindingInput, attempt: SessionJournalAttempt, root: LogicalParticipantAttemptRoot,
    readTransaction: LogicalParticipantAttemptReadTransaction, methods: readonly string[],
    entry?: Parameters<LogicalParticipantSelection["bindAttemptEffect"]>[5],
  ) {
    if (entry?.applicationBinding !== undefined && entry.applicationBinding.selection !== prepared)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    if (root.scopeId !== capturedInput.scopeId || root.principalDigest.length === 0 || methods.length === 0 ||
      methods.some(method => method.length === 0) || new Set(methods).size !== methods.length)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const pin = (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) => Effect.gen(function* () {
      const validatePin = (binding: LogicalSourceBindingState) =>
        authority.scopeId !== root.scopeId || clock.scopeId !== root.scopeId ||
          clock.lastCommitSeq < root.snapshotCommitSeq || binding.schemaVersionId !== capturedInput.schemaVersionId ||
          binding.frame.payloadContent !== null || binding.frame.payloadLifecycle !== null
          ? Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" })) : Effect.void;
      if (root.executionProfile === "finiteRoot") {
        if (entry?.finiteMetadata === undefined)
          return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
        return yield* selected.pinFiniteReadBinding(application, attempt, tx, authority, clock, validatePin, root, entry.finiteMetadata);
      }
      return yield* selected.withBinding(application, tx, authority, clock, binding => validatePin(binding).pipe(
        Effect.as(Object.freeze({ head: binding.head, clock, frame: binding.frame, metadata: undefined }))));
    }).pipe(Effect.mapError(projectAttemptFailure));
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
      selected.withBinding(application, tx, authority, clock, binding => binding.frame.payloadContent === null && binding.frame.payloadLifecycle === null
        ? verifyPinnedBinding(binding, authority, clock) : Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" })))
        .pipe(Effect.mapError(projectAttemptFailure));
    const token = issueLogicalParticipantAttemptAdmission(Object.freeze({ attempt, root: Object.freeze({ ...root }),
      preparedSource: prepared,
      ...(pinned.metadata === undefined ? {} : { metadata: pinned.metadata }),
      methods: new Set(methods), readTransaction, verifyBinding, tableIds,
      indexes: selected.indexes, unique: selected.unique,
      sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256, head: pinned.head }));
    attemptStates.set(token, Object.freeze({ root: Object.freeze({ ...root }), clock: pinned.clock,
      preparedSource: prepared, writeMechanics, requirePreparedSource: selected.requirePrepared.pipe(Effect.mapError(projectAttemptFailure)),
      schemaVersionId: capturedInput.schemaVersionId, sourceKey: selected.source.key,
      sourceSha256: selected.source.sourceSha256, head: pinned.head, frame: pinned.frame,
      contentIdentity, configuration: expected.configuration, tables: selectedTables, tableIds,
      indexes: selected.indexes, unique: selected.unique, validate }));
    return token;
  });
  const validateCommitDocument = (tableId: CatalogTableId, document: CanonicalFlarexValueV1) => Result.gen(function* () {
    const value = document.value;
    if (!isCanonicalFlarexRuntimeObjectV1(value))
      return yield* Result.fail(new LogicalParticipantAdmissionError({ reason: "documentInvalid" }));
    const documentId = yield* decodeDocumentId(value._id).pipe(
      Result.mapError(cause => new LogicalParticipantAdmissionError({ reason: "documentInvalid", cause })));
    const creationTime = yield* decodeCreationTime(value._creationTime).pipe(
      Result.mapError(cause => new LogicalParticipantAdmissionError({ reason: "documentInvalid", cause })));
    const table = selectedTables.find(member => member.tableId === tableId);
    if (table === undefined) return yield* Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    yield* validate({ operation: "replace", tableName: table.localName, tableId, documentId, creationTime, document })
      .pipe(Result.mapError(projectAttemptFailure));
  });
  const createCommitAuthority = (application: ApplicationBindingInput, participant: string,
    methods: readonly string[]): LogicalParticipantCommitAuthority => {
    const allowed = new Set(methods);
    const valid = participant.length > 0 && allowed.size > 0 && allowed.size === methods.length &&
      methods.every(method => method.length > 0);
    return issueLogicalParticipantCommitAuthority(Object.freeze({ application, projectApplicationFailure: projectAttemptFailure,
      participant: valid ? participant : "",
      methods: valid ? allowed : new Set<string>(), sourceKey: selected.source.key,
      sourceSha256: selected.source.sourceSha256, schemaVersionId: capturedInput.schemaVersionId,
      tableIds, search: Object.freeze([]),
      publicationDefinitions: selected.publicationDefinitions,
      validateDocument: validateCommitDocument,
      metadataProjection: selected.metadataProjection,
      prepareFiniteTables: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord, touchedTableIds: readonly CatalogTableId[]) =>
        selected.prepareFiniteCommitClosureObservation(tx, authority, clock, touchedTableIds).pipe(Result.map(prepared => ({
          pages: prepared.pages, accept: (observation: unknown) => prepared.accept(observation).pipe(Effect.mapError(projectAttemptFailure)),
        }))),
      verifyFinite: (_operation: AdmittedParticipantOperation, contribution: SourceContribution,
        tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
        selected.readFiniteCommitClosure(tx, authority, clock, [...new Set(contribution.effects.map(effect => effect.tableId))])
          .pipe(Effect.mapError(projectAttemptFailure)),
      verify: (_operation: AdmittedParticipantOperation, contribution: SourceContribution,
        tx: FlarexMetadataTransaction,
        authority: TrustedScopeAuthority, clock: ScopeClockRecord, borrowed?: AcceptedApplicationBinding) => selected.withBinding(
          application, tx, authority, clock, binding => {
            if (authority.scopeId !== capturedInput.scopeId || clock.scopeId !== capturedInput.scopeId ||
              binding.schemaVersionId !== capturedInput.schemaVersionId ||
              binding.frame.payloadContent !== null || binding.frame.payloadLifecycle !== null ||
              contribution.sourceKey !== selected.source.key || contribution.sourceSha256Hex !== selected.source.sourceSha256 ||
              contribution.bindingHead.sequence !== binding.head.sequence || contribution.bindingHead.sha256 !== binding.head.sha256 ||
              contribution.effects.some(effect => !tableIds.has(effect.tableId)))
              return Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
            return Effect.void;
          }, borrowed).pipe(Effect.mapError(projectAttemptFailure)),
    }), selected.preparationLifetime);
  };
  const prepared = Object.freeze({ withAdmission, withReadAdmission, bindAttemptEffect, createCommitAuthority, lendPreparation });
  return prepared;
});

export const requireLogicalDocumentSourceAdmission = Effect.fn("LogicalDocumentSourceAdmission.require")(function* (
  admission: LogicalDocumentSourceAdmission, tx: FlarexMetadataTransaction,
) {
  const state = admissions.get(admission);
  if (state === undefined || state.tx !== tx) return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "invalidAuthority" }));
  return state;
});
