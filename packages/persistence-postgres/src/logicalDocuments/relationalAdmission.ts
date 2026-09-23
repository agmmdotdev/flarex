import { Data, Effect, Result, Schema } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import type { RelationalSchema, RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { ApplicationBindingInput } from "../applicationActivation";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { DataBindingHeadToken } from "../frameworkSchema/binding/model";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturePrivateJsonData } from "../privateJsonData";
import type { ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import { prepareLogicalSourceEvidence, LogicalSourceAdmissionError } from "./sourceAdmission";
import { prepareLogicalRelationalValueValidation, LogicalRelationalValueError } from "./relationalValues";

export class LogicalRelationalAdmissionError extends Data.TaggedError("LogicalRelationalAdmissionError")<{
  readonly reason: "invalidInput" | "sourceMismatch" | "notReady" | "bindingMissing" | "invalidAuthority";
  readonly cause?: unknown;
}> {}
const SourceContract = Schema.Struct({
  sourceKey: Schema.NonEmptyString, writeProfile: Schema.NonEmptyString,
  schema: Schema.Json, evidence: Schema.Json,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeContract = Schema.decodeUnknownEffect(SourceContract);
const projectSourceFailure = (cause: LogicalSourceAdmissionError) =>
  new LogicalRelationalAdmissionError({ reason: cause.reason, cause });

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
}
const admissions = new WeakMap<object, LogicalRelationalAdmissionState>();

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
        head: binding.head }));
      return Effect.suspend(() => work(admission)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(admission))));
    });
  });
  return Object.freeze({ withAdmission });
});

export const requireLogicalRelationalAdmission = Effect.fn("LogicalRelationalAdmission.require")(function* (
  admission: LogicalRelationalAdmission, tx: FlarexMetadataTransaction,
) {
  const state = admissions.get(admission);
  if (state === undefined || state.tx !== tx) return yield* Effect.fail(new LogicalRelationalAdmissionError({ reason: "invalidAuthority" }));
  return state;
});
