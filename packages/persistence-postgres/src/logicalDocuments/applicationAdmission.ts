import { Data, Effect, Result, Schema } from "effect";
import { requireAppDocumentIdentityV1ForTableResult } from "flarex-protocol/app-document-id";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogIndexDefinitionId, CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId, SchemaManifestAppTableDeclarationV1 } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { isCanonicalFlarexRuntimeObjectV1, type CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import { validateValidatorValueV1, type ValidatorIdPolicyV1 } from "flarex-protocol/validator-engine";
import type { ApplicationBindingInput } from "../applicationActivation";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { DataBindingHeadToken } from "../frameworkSchema/binding/model";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturePrivateJsonData } from "../privateJsonData";
import type { ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import { getStableLogicalIndexIdentityByNameEffect } from "../stableLogicalIndexCatalog";
import type { LogicalDocumentWrite } from "./model";
import { prepareLogicalSourceEvidence, LogicalSourceAdmissionError, type LogicalSourceConstruction } from "./sourceAdmission";

export class LogicalApplicationSourceAdmissionError extends Data.TaggedError("LogicalApplicationSourceAdmissionError")<{
  readonly reason: "invalidInput" | "sourceMismatch" | "notReady" | "bindingMissing" | "invalidAuthority" | "documentInvalid" | "unsupportedProfile";
  readonly cause?: unknown;
}> {}
const SourceContract = Schema.Struct({ sourceKey: Schema.Literal("application"),
  writeProfile: Schema.Literal("application.occ"), definition: Schema.Json, evidence: Schema.Json,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeContract = Schema.decodeUnknownEffect(SourceContract);
const projectSourceFailure = (cause: LogicalSourceAdmissionError) =>
  new LogicalApplicationSourceAdmissionError({ reason: cause.reason, cause });

declare const admissionBrand: unique symbol;
export interface LogicalApplicationSourceAdmission { readonly [admissionBrand]: true }
export interface LogicalApplicationSourceAdmissionState {
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly head: DataBindingHeadToken;
  readonly tables: readonly Readonly<{ localName: string; tableId: CatalogTableId;
    definition: SchemaManifestAppTableDeclarationV1 }>[];
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly activeDeveloperIndexDefinitionIds: ReadonlySet<CatalogIndexDefinitionId>;
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly validate: (write: LogicalDocumentWrite) => Result.Result<void, LogicalApplicationSourceAdmissionError>;
}
const admissions = new WeakMap<object, LogicalApplicationSourceAdmissionState>();

/** Native Application source and active revision must select the same joint
 * candidate. This grants only Application-owned scalar document semantics. */
export const prepareLogicalApplicationSourceAdmission = Effect.fn("LogicalApplicationSourceAdmission.prepare")(function* (
  ports: AppUniqueConstraintSetBuildPortsV1, unique: AppUniqueConstraintSetEligibilityPortV1,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>, sourceInput: unknown,
  construction: LogicalSourceConstruction,
) {
  const capturedPorts = Object.freeze({ controlDb: ports.controlDb, authority: ports.authority });
  const capturedInput = Object.freeze({ deploymentId: input.deploymentId, scopeId: input.scopeId,
    schemaVersionId: input.schemaVersionId });
  const captured = yield* Effect.fromResult(capturePrivateJsonData(sourceInput, MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES,
    (reason, cause) => new LogicalApplicationSourceAdmissionError({ reason: "invalidInput", cause: { reason, cause } })));
  const expected = yield* decodeContract(captured.value).pipe(Effect.mapError(cause =>
    new LogicalApplicationSourceAdmissionError({ reason: "invalidInput", cause })));
  const selected = yield* prepareLogicalSourceEvidence(capturedPorts, unique, capturedInput, expected,
    "application", "documents", construction).pipe(Effect.catchTag("LogicalSourceAdmissionError", cause => Effect.fail(projectSourceFailure(cause))));
  if (selected.source.definition.kind !== "documents" ||
    selected.source.bindings.some(binding => binding.kind !== "definition"))
    return yield* Effect.fail(new LogicalApplicationSourceAdmissionError({ reason: "unsupportedProfile" }));
  const definitions = selected.source.definition.tables;
  if (definitions.length !== selected.tables.length)
    return yield* Effect.fail(new LogicalApplicationSourceAdmissionError({ reason: "sourceMismatch" }));
  const tables = [];
  for (const binding of selected.tables) {
    const definition = definitions.find(table => table.logicalName === binding.localName);
    if (definition === undefined) return yield* Effect.fail(new LogicalApplicationSourceAdmissionError({ reason: "sourceMismatch" }));
    tables.push(Object.freeze({ ...binding, definition }));
  }
  const ownedTables = Object.freeze(tables);
  const activeDeveloperIndexDefinitionIds = new Set<CatalogIndexDefinitionId>();
  for (const declaration of selected.source.definition.indexes) {
    const table = ownedTables.find(member => member.localName === declaration.tableLogicalName);
    if (table === undefined) return yield* Effect.fail(new LogicalApplicationSourceAdmissionError({ reason: "sourceMismatch" }));
    const stable = yield* getStableLogicalIndexIdentityByNameEffect(capturedPorts.controlDb, {
      deploymentId: capturedInput.deploymentId, tableId: table.tableId, descriptor: declaration.descriptor,
    }).pipe(Effect.mapError(cause => new LogicalApplicationSourceAdmissionError({ reason: "notReady", cause })));
    const located = stable === null ? undefined : selected.indexes.find(index =>
      index.access.kind === "developer" && index.access.tableId === table.tableId &&
      index.access.logicalIndexId === stable.logicalIndexId);
    if (located === undefined) return yield* Effect.fail(new LogicalApplicationSourceAdmissionError({ reason: "sourceMismatch" }));
    activeDeveloperIndexDefinitionIds.add(located.indexDefinitionId);
  }
  if (activeDeveloperIndexDefinitionIds.size !== selected.source.definition.indexes.length)
    return yield* Effect.fail(new LogicalApplicationSourceAdmissionError({ reason: "sourceMismatch" }));
  const idPolicy: ValidatorIdPolicyV1 = Object.freeze({ mode: "tableAware", check: (tableName, value) => {
    if (tableName.startsWith("_")) return "unavailable";
    const table = ownedTables.find(member => member.localName === tableName);
    return table === undefined ? "unavailable" : Result.isSuccess(requireAppDocumentIdentityV1ForTableResult(value, table.tableId))
      ? "valid" : "invalid";
  } });
  const validate = (write: LogicalDocumentWrite): Result.Result<void, LogicalApplicationSourceAdmissionError> => Result.gen(function* () {
    const table = ownedTables.find(member => member.localName === write.tableName && member.tableId === write.tableId);
    if (table === undefined) return yield* Result.fail(new LogicalApplicationSourceAdmissionError({ reason: "invalidAuthority" }));
    const value = write.document.value;
    if (!isCanonicalFlarexRuntimeObjectV1(value) || value._id !== write.documentId || value._creationTime !== write.creationTime)
      return yield* Result.fail(new LogicalApplicationSourceAdmissionError({ reason: "documentInvalid" }));
    const fields: Record<string, CanonicalFlarexRuntimeValueV1> = {};
    for (const [field, item] of Object.entries(value)) {
      if (field === "_id" || field === "_creationTime") continue;
      if (field.startsWith("_")) return yield* Result.fail(new LogicalApplicationSourceAdmissionError({ reason: "documentInvalid" }));
      Object.defineProperty(fields, field, { value: item, enumerable: true });
    }
    yield* validateValidatorValueV1(table.definition.definition.documentType, Object.freeze(fields),
      { path: "$document", idPolicy }).pipe(Result.mapError(cause =>
        new LogicalApplicationSourceAdmissionError({ reason: "documentInvalid", cause })));
  });

  const withAdmission = Effect.fn("LogicalApplicationSourceAdmission.withTransaction")(function* <Value, Failure, Requirements>(
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalApplicationSourceAdmission) => Effect.Effect<Value, Failure, Requirements>,
  ) {
    return yield* selected.withBinding(application, tx, authority, clock, binding => {
      // SAFETY: only this callback issues and registers a token for the checked selected binding.
      const admission = Object.freeze({}) as LogicalApplicationSourceAdmission;
      admissions.set(admission, Object.freeze({ tx, authority, clock, schemaVersionId: binding.schemaVersionId,
        head: binding.head, tables: ownedTables, indexes: selected.indexes, unique: selected.unique,
        activeDeveloperIndexDefinitionIds, validate }));
      return Effect.suspend(() => work(admission)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(admission))));
    });
  });
  return Object.freeze({ withAdmission });
});

export const requireLogicalApplicationSourceAdmission = Effect.fn("LogicalApplicationSourceAdmission.require")(function* (
  admission: LogicalApplicationSourceAdmission, tx: FlarexMetadataTransaction,
) {
  const state = admissions.get(admission);
  if (state === undefined || state.tx !== tx)
    return yield* Effect.fail(new LogicalApplicationSourceAdmissionError({ reason: "invalidAuthority" }));
  return state;
});
