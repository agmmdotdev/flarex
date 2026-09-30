import { Data, Effect, Result, Schema } from "effect";
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
import type { ApplicationBindingInput } from "../applicationActivation";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { DataBindingHeadToken, DataBindingSetFrame } from "../frameworkSchema/binding/model";
import { DataBindingError } from "../frameworkSchema/binding/errors";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturePrivateJsonData } from "../privateJsonData";
import type { ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { LogicalDocumentWrite } from "./model";
import { prepareLogicalSourceEvidence, LogicalSourceAdmissionError, type LogicalSourceBindingState } from "./sourceAdmission";
import { issueLogicalParticipantAttemptAdmission, issueLogicalParticipantCommitAuthority,
  withLogicalParticipantAttemptAdmissionEffect, LogicalParticipantAdmissionError,
  type LogicalParticipantAttemptAdmission, type LogicalParticipantAttemptRoot,
  type LogicalParticipantAttemptReadTransaction, type LogicalParticipantCommitAuthority } from "./participantAdmission";
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
  readonly validate: (write: LogicalDocumentWrite) => Result.Result<void, LogicalDocumentSourceAdmissionError>;
}
const admissions = new WeakMap<object, LogicalDocumentSourceAdmissionState>();
export interface LogicalDocumentAttemptAdmissionState extends Omit<LogicalDocumentSourceAdmissionState, "tx" | "authority"> {
  readonly root: LogicalParticipantAttemptRoot;
}
const attemptStates = new WeakMap<object, LogicalDocumentAttemptAdmissionState>();

export const withLogicalDocumentAttemptAdmissionEffect = Effect.fn("LogicalDocumentAttemptAdmission.with")(
  function* <Prepared, Value, PreparationFailure, Failure, Requirements>(admission: LogicalParticipantAttemptAdmission,
    attempt: SessionJournalAttempt, method: string,
    prepare: (state: LogicalDocumentAttemptAdmissionState,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>,
      tx: FlarexMetadataTransaction) => Effect.Effect<Prepared, PreparationFailure>,
    work: (state: LogicalDocumentAttemptAdmissionState,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>, prepared: Prepared) => Effect.Effect<Value, Failure, Requirements>) {
    return yield* withLogicalParticipantAttemptAdmissionEffect(admission, attempt, method,
      (_, tx, checkedRead) => Effect.gen(function* () {
      const state = attemptStates.get(admission);
      if (state === undefined) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
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
  }, "payload", "documents").pipe(Effect.catchTag("LogicalSourceAdmissionError", cause => Effect.fail(projectSourceFailure(cause))));
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

  const withAdmission = Effect.fn("LogicalDocumentSourceAdmission.withTransaction")(function* <Value, Failure, Requirements>(
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalDocumentSourceAdmission) => Effect.Effect<Value, Failure, Requirements>,
  ) {
    return yield* selected.withBinding(application, tx, authority, clock, binding => Effect.gen(function* () {
      // The source-bound scalar participant has no V3 preference cleanup or
      // embedded-content owner. Refuse mixed selected frames before token issue.
      if (binding.frame.payloadContent !== null || binding.frame.payloadLifecycle !== null)
        return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "unsupportedProfile" }));
      // SAFETY: only callback lifetime membership authenticates this token.
      const admission = Object.freeze({}) as LogicalDocumentSourceAdmission;
      admissions.set(admission, Object.freeze({ tx, authority, clock, schemaVersionId: binding.schemaVersionId,
        sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256, head: binding.head,
        frame: binding.frame, contentIdentity,
        configuration: expected.configuration, tables: selectedTables, indexes: selected.indexes,
        unique: selected.unique, validate }));
      return yield* Effect.suspend(() => work(admission)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(admission))));
    }));
  });
  const tableIds = new Set(selectedTables.map(table => table.tableId));
  const bindAttemptEffect = Effect.fn("LogicalDocumentAttemptAdmission.bind")(function* (
    application: ApplicationBindingInput, attempt: SessionJournalAttempt, root: LogicalParticipantAttemptRoot,
    readTransaction: LogicalParticipantAttemptReadTransaction, methods: readonly string[],
  ) {
    if (root.scopeId !== capturedInput.scopeId || root.principalDigest.length === 0 || methods.length === 0 ||
      methods.some(method => method.length === 0) || new Set(methods).size !== methods.length)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const pinned = yield* readTransaction((tx, authority, clock) => selected.withBinding(
      application, tx, authority, clock, binding => {
        if (authority.scopeId !== root.scopeId || clock.scopeId !== root.scopeId ||
          clock.lastCommitSeq < root.snapshotCommitSeq || binding.schemaVersionId !== capturedInput.schemaVersionId ||
          binding.frame.payloadContent !== null || binding.frame.payloadLifecycle !== null)
          return Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
        return Effect.succeed(Object.freeze({ head: binding.head, clock, frame: binding.frame }));
      }).pipe(Effect.mapError(projectAttemptFailure)));
    const verifyPinnedBinding = (binding: LogicalSourceBindingState, authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
        binding.schemaVersionId === capturedInput.schemaVersionId &&
        binding.head.sequence === pinned.head.sequence && binding.head.sha256 === pinned.head.sha256 &&
        binding.frame.payloadContent === null && binding.frame.payloadLifecycle === null &&
        authority.scopeId === root.scopeId && clock.scopeId === root.scopeId
          ? Effect.void : Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const verifyBinding = (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
      selected.withBinding(application, tx, authority, clock, binding => verifyPinnedBinding(binding, authority, clock))
        .pipe(Effect.mapError(projectAttemptFailure));
    const verifyReadBinding = (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
      selected.withReadBinding(application, tx, authority, clock, binding => verifyPinnedBinding(binding, authority, clock))
        .pipe(Effect.mapError(projectAttemptFailure));
    const token = issueLogicalParticipantAttemptAdmission(Object.freeze({ attempt, root: Object.freeze({ ...root }),
      methods: new Set(methods), readTransaction, verifyBinding, verifyReadBinding, tableIds,
      indexes: selected.indexes, unique: selected.unique,
      sourceKey: selected.source.key, sourceSha256: selected.source.sourceSha256, head: pinned.head }));
    attemptStates.set(token, Object.freeze({ root: Object.freeze({ ...root }), clock: pinned.clock,
      schemaVersionId: capturedInput.schemaVersionId, sourceKey: selected.source.key,
      sourceSha256: selected.source.sourceSha256, head: pinned.head, frame: pinned.frame,
      contentIdentity, configuration: expected.configuration, tables: selectedTables,
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
    return issueLogicalParticipantCommitAuthority(Object.freeze({ participant: valid ? participant : "",
      methods: valid ? allowed : new Set<string>(), sourceKey: selected.source.key,
      sourceSha256: selected.source.sourceSha256, schemaVersionId: capturedInput.schemaVersionId,
      tableIds, indexes: selected.indexes, unique: selected.unique, search: Object.freeze([]),
      validateDocument: validateCommitDocument,
      verify: (_operation: AdmittedParticipantOperation, contribution: SourceContribution,
        tx: FlarexMetadataTransaction,
        authority: TrustedScopeAuthority, clock: ScopeClockRecord) => selected.withBinding(
          application, tx, authority, clock, binding => {
            if (authority.scopeId !== capturedInput.scopeId || clock.scopeId !== capturedInput.scopeId ||
              binding.schemaVersionId !== capturedInput.schemaVersionId ||
              binding.frame.payloadContent !== null || binding.frame.payloadLifecycle !== null ||
              contribution.sourceKey !== selected.source.key || contribution.sourceSha256Hex !== selected.source.sourceSha256 ||
              contribution.bindingHead.sequence !== binding.head.sequence || contribution.bindingHead.sha256 !== binding.head.sha256 ||
              contribution.effects.some(effect => !tableIds.has(effect.tableId)))
              return Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
            return Effect.void;
          }).pipe(Effect.mapError(projectAttemptFailure)),
    }));
  };
  return Object.freeze({ withAdmission, bindAttemptEffect, createCommitAuthority });
});

export const requireLogicalDocumentSourceAdmission = Effect.fn("LogicalDocumentSourceAdmission.require")(function* (
  admission: LogicalDocumentSourceAdmission, tx: FlarexMetadataTransaction,
) {
  const state = admissions.get(admission);
  if (state === undefined || state.tx !== tx) return yield* Effect.fail(new LogicalDocumentSourceAdmissionError({ reason: "invalidAuthority" }));
  return state;
});
