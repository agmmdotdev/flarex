/**
 * SchemaModel translated from Convex database/bootstrap_model/schema/mod.rs and
 * common/schemas/mod.rs at db914cf06. Copyright 2026 Convex, Inc.,
 * FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Option, Result } from "effect";
import type { DocumentObject } from "flarex-protocol/document-value";
import { validateValidatorValueV1, type ValidatorIdPolicyV1 } from "flarex-protocol/validator-engine";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { CoreTransactionError } from "./api";
import { captureCoreSchema, coreSchemaCorrupt, coreSchemaTable, CoreSchemaError, decodeCoreSchemaMetadata, SCHEMAS,
  type CoreSchemaDefinition, type CoreSchemaState, type CoreSchemaUniqueState } from "./schemaTypes";
import { parseCoreSchema, serializeCoreSchema } from "./schemaJson";
import type { CoreSchemaSelection } from "./schemaRegistry";
import { CoreSchemaValidations, type CoreStagedValidationWithProgress } from "./schemaValidations";
import type { CoreSchemaTransaction } from "./schemaValidationProgress";
import { coreValidatorIsSubset, coreValidatorReferences } from "./validatorSubset";

export type CoreTableValidationOutcome = "notValidated" | "supersetOfEnforced" | "supersetOfStagedValidated" | "supersetOfShape" | "mustWalk";

/** Existing tables have no invented shape proof. A genuinely absent table is empty. */
export function coreSchemaValidationOutcomes(schema: CoreSchemaDefinition, active: CoreSchemaDefinition | undefined,
  validStagedValidators: ReadonlyMap<string, ValidatorJsonV1>, tableExists: (tableName: string) => boolean):
ReadonlyMap<string, CoreTableValidationOutcome> {
  const outcomes = new Map<string, CoreTableValidationOutcome>();
  for (const table of schema.tables) {
    if (!schema.schemaValidation) { outcomes.set(table.tableName, "notValidated"); continue; }
    const next: ValidatorJsonV1 = table.documentType ?? { type: "any" };
    const enforced: ValidatorJsonV1 = active?.schemaValidation
      ? coreSchemaTable(active, table.tableName)?.documentType ?? { type: "any" } : { type: "any" };
    const staged = validStagedValidators.get(table.tableName);
    const outcome: CoreTableValidationOutcome = coreValidatorIsSubset(enforced, next) ? "supersetOfEnforced"
      : staged !== undefined && coreValidatorIsSubset(staged, next) ? "supersetOfStagedValidated"
        : !tableExists(table.tableName) ? "supersetOfShape" : "mustWalk";
    outcomes.set(table.tableName, outcome);
  }
  return outcomes;
}

function stateRefusal(state: CoreSchemaState): CoreSchemaError {
  switch (state.state) {
    case "failed": return new CoreSchemaError({ reason: "schemaFailed", message: state.error,
      ...(state.table_name === null ? {} : { tableName: state.table_name }) });
    case "overwritten": return new CoreSchemaError({ reason: "schemaOverwritten", message: "Schema has already been overwritten" });
    case "pending": case "validated": case "active": return new CoreSchemaError({ reason: "notValidated", message: "Schema is not in the required lifecycle state" });
  }
}

function violation(schema: CoreSchemaDefinition, tableName: string, body: DocumentObject,
  idPolicy: ValidatorIdPolicyV1, staged: boolean) {
  const table = coreSchemaTable(schema, tableName);
  const validator = staged ? table?.stagedDocumentType : schema.schemaValidation ? table?.documentType : undefined;
  return validator === undefined ? Result.succeed(undefined) : validateValidatorValueV1(validator, body, { idPolicy });
}

/** All durable changes participate in the borrowed transaction's existing settlement. */
export class CoreSchemaModel {
  readonly validations: CoreSchemaValidations;
  constructor(private readonly tx: CoreSchemaTransaction) { this.validations = new CoreSchemaValidations(tx); }

  readonly getByState = Effect.fn("CoreSchemaModel.getByState")((state: CoreSchemaUniqueState) =>
    this.tx.tableExists(SCHEMAS) ? Effect.fromResult(this.tx.schemaRegistry.getByState(this.tx.namespace, state,
      this.tx.schemaTableStateIndex(), this.tx.addIndexRead)) : Effect.succeed(Option.none<CoreSchemaSelection>()));
  readonly active = Effect.fn("CoreSchemaModel.active")(() => this.getByState("active"));
  readonly pending = Effect.fn("CoreSchemaModel.pending")(() => this.getByState("pending"));
  readonly validated = Effect.fn("CoreSchemaModel.validated")(() => this.getByState("validated"));

  readonly get = Effect.fn("CoreSchemaModel.get")((id: string) => Effect.gen({ self: this }, function* () {
    const document = yield* this.tx.getSystem(SCHEMAS, id);
    if (Option.isNone(document)) return Option.none<CoreSchemaSelection>();
    const metadata = yield* Effect.fromResult(decodeCoreSchemaMetadata(document.value.value).pipe(Result.mapError(coreSchemaCorrupt)));
    const schema = yield* Effect.fromResult(parseCoreSchema(metadata.schema).pipe(Result.mapError(coreSchemaCorrupt)));
    return Option.some(Object.freeze({ id, creationTime: document.value.creationTime,
      metadata: Object.freeze({ ...metadata, state: Object.freeze({ ...metadata.state }) }), schema }));
  }));

  readonly submitPending = Effect.fn("CoreSchemaModel.submitPending")((input: CoreSchemaDefinition) => Effect.gen({ self: this }, function* () {
    const schema = yield* Effect.fromResult(captureCoreSchema(input));
    const active = yield* this.active();
    const hasStaged = schema.tables.some(table => table.stagedDocumentType !== undefined);
    if (hasStaged) {
      const validStaged = Option.isSome(active)
        ? yield* this.validations.validStagedValidators(active.value.id, active.value.schema) : new Map<string, ValidatorJsonV1>();
      const outcomes = coreSchemaValidationOutcomes(schema, Option.getOrUndefined(Option.map(active, value => value.schema)),
        validStaged, this.tx.tableExists);
      const conflicts = schema.tables.filter(table => table.stagedDocumentType !== undefined && outcomes.get(table.tableName) === "mustWalk");
      if (conflicts.length > 0) return yield* Effect.fail(new CoreSchemaError({ reason: "stagedEnforcedConflict",
        message: `Staged and enforced validation cannot walk the same tables: ${conflicts.map(table => table.tableName).join(", ")}` }));
    }
    for (const table of schema.tables) if (!this.tx.tableExists(table.tableName)) yield* this.tx.ensureUserTable(table.tableName);
    const serialized = serializeCoreSchema(schema);
    if (Option.isSome(active) && serializeCoreSchema(active.value.schema) === serialized) {
      for (const state of ["pending", "validated"] as const) {
        const existing = yield* this.getByState(state);
        if (Option.isSome(existing)) yield* this.markOverwritten(existing.value.id);
      }
      yield* this.validations.retryFailedStagedValidators(active.value.id, schema);
      return { id: active.value.id, state: { state: "active" } as const };
    }
    const carryOver: CoreStagedValidationWithProgress[] = hasStaged && Option.isSome(active)
      ? [...(yield* this.validations.stagedValidationsWithProgress(active.value.id, active.value.schema))] : [];
    const pending = yield* this.pending();
    const validated = yield* this.validated();
    if (Option.isSome(pending) && Option.isSome(validated)) return yield* Effect.fail(coreSchemaCorrupt("Pending and validated schemas coexist"));
    const existing = Option.orElse(pending, () => validated);
    if (Option.isSome(existing)) {
      if (serializeCoreSchema(existing.value.schema) === serialized) {
        yield* this.validations.retryFailedStagedValidators(existing.value.id, schema);
        return { id: existing.value.id, state: existing.value.metadata.state };
      }
      if (hasStaged) carryOver.push(...(yield* this.validations.stagedValidationsWithProgress(existing.value.id, existing.value.schema)));
      yield* this.markOverwritten(existing.value.id);
    }
    const id = yield* this.tx.insertSystem(SCHEMAS, { state: { state: "pending" }, schema: serialized });
    if (hasStaged) yield* this.validations.initializeStagedValidators(id, schema, carryOver);
    return { id, state: { state: "pending" } as const };
  }));

  readonly markValidated = Effect.fn("CoreSchemaModel.markValidated")((id: string) => Effect.gen({ self: this }, function* () {
    const schema = yield* this.mustGet(id);
    if (schema.metadata.state.state !== "pending") return yield* Effect.fail(stateRefusal(schema.metadata.state));
    yield* this.tx.replaceSystem(SCHEMAS, id, { ...schema.metadata, state: { state: "validated" } });
  }));

  readonly getValidatedOrActive = Effect.fn("CoreSchemaModel.getValidatedOrActive")((id: string) => Effect.gen({ self: this }, function* () {
    const schema = yield* this.mustGet(id);
    if (schema.metadata.state.state !== "validated" && schema.metadata.state.state !== "active")
      return yield* Effect.fail(stateRefusal(schema.metadata.state));
    return schema;
  }));

  readonly markActive = Effect.fn("CoreSchemaModel.markActive")((id: string) => Effect.gen({ self: this }, function* () {
    const schema = yield* this.getValidatedOrActive(id);
    if (schema.metadata.state.state === "active") return;
    yield* this.validations.deleteEnforcedValidationsForSchema(id);
    yield* this.clearActive();
    yield* this.tx.replaceSystem(SCHEMAS, id, { ...schema.metadata, state: { state: "active" } });
  }));

  readonly markFailed = Effect.fn("CoreSchemaModel.markFailed")((id: string, error: string, tableName?: string) => Effect.gen({ self: this }, function* () {
    const schema = yield* this.mustGet(id);
    switch (schema.metadata.state.state) {
      case "pending": case "validated":
        yield* this.tx.replaceSystem(SCHEMAS, id, { ...schema.metadata,
          state: { state: "failed", error, table_name: tableName ?? null } });
        break;
      case "active": return yield* Effect.fail(new CoreSchemaError({ reason: "notValidated", message: "Active schemas cannot be marked failed" }));
      case "failed": case "overwritten": break;
    }
    yield* this.deleteOldFailedAndOverwritten();
    yield* this.validations.deleteValidationsForSchema(id);
  }));

  readonly markOverwritten = Effect.fn("CoreSchemaModel.markOverwritten")((id: string) => Effect.gen({ self: this }, function* () {
    const schema = yield* this.mustGet(id);
    yield* this.tx.replaceSystem(SCHEMAS, id, { ...schema.metadata, state: { state: "overwritten" } });
    yield* this.deleteOldFailedAndOverwritten();
    yield* this.validations.deleteValidationsForSchema(id);
  }));

  readonly clearActive = Effect.fn("CoreSchemaModel.clearActive")(() => Effect.gen({ self: this }, function* () {
    const active = yield* this.active();
    if (Option.isSome(active)) yield* this.markOverwritten(active.value.id);
  }));

  readonly overwriteAll = Effect.fn("CoreSchemaModel.overwriteAll")(() => Effect.gen({ self: this }, function* () {
    let overwritten = false;
    for (const state of ["pending", "active", "validated"] as const) {
      const selected = yield* this.getByState(state);
      if (Option.isSome(selected)) { yield* this.markOverwritten(selected.value.id); overwritten = true; }
    }
    return overwritten;
  }));

  readonly enforceDocument = Effect.fn("CoreSchemaModel.enforceDocument")((tableName: string, body: DocumentObject,
    idPolicy: ValidatorIdPolicyV1) => Effect.gen({ self: this }, function* () {
    if (tableName.startsWith("_")) return;
    const active = yield* this.active();
    if (Option.isSome(active)) {
      yield* Effect.fromResult(violation(active.value.schema, tableName, body, idPolicy, false).pipe(
        Result.mapError(cause => new CoreTransactionError({ reason: "documentValidation", cause }))));
      yield* this.checkStagedWrite(active.value, tableName, body, idPolicy);
    }
    const pending = yield* this.pending();
    const validated = yield* this.validated();
    if (Option.isSome(pending) && Option.isSome(validated)) return yield* Effect.fail(coreSchemaCorrupt("Pending and validated schemas coexist"));
    const proposed = Option.orElse(pending, () => validated);
    if (Option.isNone(proposed)) return;
    const verdict = violation(proposed.value.schema, tableName, body, idPolicy, false);
    if (Result.isFailure(verdict)) yield* this.markFailed(proposed.value.id,
      `New document in ${tableName} violates the proposed validator (${verdict.failure.issue.reason} at ${verdict.failure.issue.path})`, tableName);
    yield* this.checkStagedWrite(proposed.value, tableName, body, idPolicy);
  }));

  /** Called by the real deletion/replacement owner before losing the table mapping. */
  readonly enforceTableDeletion = Effect.fn("CoreSchemaModel.enforceTableDeletion")((tableName: string) => Effect.gen({ self: this }, function* () {
    for (const state of ["active", "pending", "validated"] as const) {
      const selected = yield* this.getByState(state);
      if (Option.isNone(selected)) continue;
      const schema = selected.value.schema;
      const declared = coreSchemaTable(schema, tableName)?.documentType !== undefined;
      const referenced = schema.tables.some(table => table.documentType !== undefined && coreValidatorReferences(table.documentType, tableName));
      if (!declared && !referenced) continue;
      if (state === "active") return yield* Effect.fail(new CoreTransactionError({ reason: "documentValidation" }));
      yield* this.markFailed(selected.value.id, `Table ${tableName} is declared or referenced by the proposed schema`, tableName);
    }
    yield* this.validations.invalidateTableReferences(tableName);
  }));

  private readonly mustGet = Effect.fn("CoreSchemaModel.mustGet")((id: string) => Effect.gen({ self: this }, function* () {
    const schema = yield* this.get(id);
    if (Option.isNone(schema)) return yield* Effect.fail(new CoreSchemaError({ reason: "schemaNotFound", message: "Schema does not exist" }));
    return schema.value;
  }));

  private readonly checkStagedWrite = Effect.fn("CoreSchemaModel.checkStagedWrite")((selected: CoreSchemaSelection,
    tableName: string, body: DocumentObject, idPolicy: ValidatorIdPolicyV1) => Result.match(
    violation(selected.schema, tableName, body, idPolicy, true), {
      onSuccess: () => Effect.void,
      onFailure: failure => this.validations.markFailed(selected.id, tableName,
        `New document in ${tableName} violates its staged validator (${failure.issue.reason} at ${failure.issue.path})`).pipe(Effect.asVoid),
    }));

  private readonly deleteOldFailedAndOverwritten = Effect.fn("CoreSchemaModel.cleanup")(() => Effect.gen({ self: this }, function* () {
    const rows = yield* this.tx.querySystem(SCHEMAS, "by_creation_time", []);
    const cutoff = Number(this.tx.timestamp) / 1_000_000 - 3_600_000;
    for (const row of rows) {
      const metadata = yield* Effect.fromResult(decodeCoreSchemaMetadata(row.value).pipe(Result.mapError(coreSchemaCorrupt)));
      if (metadata.state.state !== "failed" && metadata.state.state !== "overwritten") continue;
      if (row.creationTime > cutoff) break;
      yield* this.tx.deleteSystem(SCHEMAS, row.id);
    }
  }));
}
