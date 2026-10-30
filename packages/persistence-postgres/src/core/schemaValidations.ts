/** Convex database/bootstrap_model/schema_validations at db914cf06; FSL-1.1-Apache-2.0. */
import { Effect, Option, Result, Schema } from "effect";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import type { CoreSystemDocument } from "./transaction";
import { coreSchemaCorrupt, coreSchemaTable, CoreSchemaCountSchema, decodeCoreSchemaValidationMetadata,
  SCHEMA_VALIDATIONS, VALIDATIONS_BY_SCHEMA_AND_TABLE, type CoreSchemaDefinition,
  type CoreSchemaValidationMetadata, type CoreSchemaValidationProgressValue, type CoreSchemaValidationState } from "./schemaTypes";
import { CoreSchemaValidationProgress, type CoreSchemaTransaction } from "./schemaValidationProgress";
import { coreDocumentValidatorHash } from "./schemaJson";
import { coreValidatorIsSubset, coreValidatorReferences, coreValidatorsEqual } from "./validatorSubset";

export const CoreSchemaValidationAttemptUpdateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("startWalk"), totalDocs: Schema.NullOr(CoreSchemaCountSchema) }),
  Schema.Struct({ kind: Schema.Literal("recordProgress"), additionalDocsValidated: CoreSchemaCountSchema,
    totalDocs: Schema.NullOr(CoreSchemaCountSchema) }),
  Schema.Struct({ kind: Schema.Literal("markValid") }),
  Schema.Struct({ kind: Schema.Literal("markFailed"), error: Schema.String }),
]);
export type CoreSchemaValidationAttemptUpdate = typeof CoreSchemaValidationAttemptUpdateSchema.Type;
export interface CoreSchemaValidationRecord {
  readonly document: CoreSystemDocument;
  readonly metadata: CoreSchemaValidationMetadata;
}
export interface CoreSchemaValidationWithProgress {
  readonly validation: CoreSchemaValidationMetadata;
  readonly progress: CoreSchemaValidationProgressValue;
}
export interface CoreStagedValidationWithProgress {
  readonly validator: ValidatorJsonV1;
  readonly attempt: CoreSchemaValidationWithProgress;
}

const parse = (document: CoreSystemDocument) => decodeCoreSchemaValidationMetadata(document.value).pipe(
  Result.mapError(coreSchemaCorrupt), Result.map(metadata => Object.freeze({ document,
    metadata: Object.freeze({ ...metadata, state: Object.freeze({ ...metadata.state }) }) })));

/** The attempt row, rather than progress or schema ID alone, fences a worker. */
export class CoreSchemaValidations {
  private readonly counters: CoreSchemaValidationProgress;
  constructor(private readonly tx: CoreSchemaTransaction) { this.counters = new CoreSchemaValidationProgress(tx); }

  readonly validationsForSchema = Effect.fn("CoreSchemaValidations.forSchema")((schemaId: string) => Effect.gen({ self: this }, function* () {
    const rows = yield* this.tx.querySystem(SCHEMA_VALIDATIONS, VALIDATIONS_BY_SCHEMA_AND_TABLE, [schemaId]);
    const parsed: CoreSchemaValidationRecord[] = [];
    const seen = new Set<string>();
    for (const document of rows) {
      const record = yield* Effect.fromResult(parse(document));
      if (seen.has(record.metadata.tableName)) return yield* Effect.fail(coreSchemaCorrupt("Duplicate table validation attempt"));
      seen.add(record.metadata.tableName); parsed.push(record);
    }
    return parsed;
  }));

  readonly validationMetadataForTable = Effect.fn("CoreSchemaValidations.forTable")((schemaId: string, tableName: string) => Effect.gen({ self: this }, function* () {
    const rows = yield* this.tx.querySystem(SCHEMA_VALIDATIONS, VALIDATIONS_BY_SCHEMA_AND_TABLE, [schemaId, tableName]);
    if (rows.length > 1) return yield* Effect.fail(coreSchemaCorrupt("Duplicate table validation attempt"));
    const row = rows[0];
    return row === undefined ? Option.none<CoreSchemaValidationRecord>() : Option.some(yield* Effect.fromResult(parse(row)));
  }));

  readonly startTableValidation = Effect.fn("CoreSchemaValidations.startTable")((schemaId: string, tableName: string,
    validatorHash: string | undefined, totalDocs: bigint | null) => Effect.gen({ self: this }, function* () {
    const existing = yield* this.validationMetadataForTable(schemaId, tableName);
    if (Option.isSome(existing)) yield* this.deleteAttempt(existing.value.document.id);
    return yield* this.insertValidation(schemaId, tableName, validatorHash, { state: "pending" }, 0n, totalDocs);
  }));

  readonly updateAttempt = Effect.fn("CoreSchemaValidations.updateAttempt")((attemptId: string,
    update: CoreSchemaValidationAttemptUpdate) => Effect.gen({ self: this }, function* () {
    const document = yield* this.tx.getSystem(SCHEMA_VALIDATIONS, attemptId);
    if (Option.isNone(document)) return false;
    const record = yield* Effect.fromResult(parse(document.value));
    if (record.metadata.state.state !== "pending") return false;
    switch (update.kind) {
      case "startWalk": yield* this.counters.reset(attemptId, update.totalDocs); return true;
      case "recordProgress": yield* this.counters.record(attemptId, update.additionalDocsValidated, update.totalDocs); return true;
      case "markValid":
        yield* this.tx.replaceSystem(SCHEMA_VALIDATIONS, attemptId, { ...record.metadata, state: { state: "valid" } });
        return true;
      case "markFailed":
        yield* this.tx.replaceSystem(SCHEMA_VALIDATIONS, attemptId,
          { ...record.metadata, state: { state: "failed", error: update.error } });
        return true;
    }
  }));

  readonly progress = Effect.fn("CoreSchemaValidations.progress")((attemptId: string) =>
    this.counters.mustGet(attemptId).pipe(Effect.map(record => record.metadata)));

  readonly validationsWithProgress = Effect.fn("CoreSchemaValidations.withProgress")((schemaId: string) => Effect.gen({ self: this }, function* () {
    const results: CoreSchemaValidationWithProgress[] = [];
    for (const record of yield* this.validationsForSchema(schemaId)) results.push({ validation: record.metadata,
      progress: yield* this.progress(record.document.id) });
    return results;
  }));

  readonly stagedValidationsWithProgress = Effect.fn("CoreSchemaValidations.stagedWithProgress")((schemaId: string,
    schema: CoreSchemaDefinition) => Effect.gen({ self: this }, function* () {
    if (!schema.tables.some(table => table.stagedDocumentType !== undefined)) return [];
    const results: CoreStagedValidationWithProgress[] = [];
    for (const attempt of yield* this.validationsWithProgress(schemaId)) {
      const validator = coreSchemaTable(schema, attempt.validation.tableName)?.stagedDocumentType;
      if (validator !== undefined && attempt.validation.validatorHash === (yield* coreDocumentValidatorHash(validator)))
        results.push({ validator, attempt });
    }
    return results;
  }));

  readonly initializeStagedValidators = Effect.fn("CoreSchemaValidations.initializeStaged")((schemaId: string,
    schema: CoreSchemaDefinition, carryOver: readonly CoreStagedValidationWithProgress[]) => Effect.gen({ self: this }, function* () {
    for (const table of schema.tables) {
      if (table.stagedDocumentType === undefined) continue;
      const validatorHash = yield* coreDocumentValidatorHash(table.stagedDocumentType);
      let best: CoreSchemaValidationWithProgress | undefined;
      for (const candidate of carryOver) {
        if (candidate.attempt.validation.tableName !== table.tableName) continue;
        const state = candidate.attempt.validation.state.state;
        const reusable = state === "pending" ? coreValidatorsEqual(candidate.validator, table.stagedDocumentType)
          : state === "valid" && coreValidatorIsSubset(candidate.validator, table.stagedDocumentType);
        if (!reusable) continue;
        if (best === undefined || (state === "valid" && best.validation.state.state !== "valid")
          || (state === best.validation.state.state && candidate.attempt.progress.numDocsValidated > best.progress.numDocsValidated))
          best = candidate.attempt;
      }
      yield* this.insertValidation(schemaId, table.tableName, validatorHash, best?.validation.state ?? { state: "pending" },
        best?.progress.numDocsValidated ?? 0n, best?.progress.totalDocs ?? null);
    }
  }));

  readonly retryFailedStagedValidators = Effect.fn("CoreSchemaValidations.retryStaged")((schemaId: string,
    schema: CoreSchemaDefinition) => Effect.gen({ self: this }, function* () {
    if (!schema.tables.some(table => table.stagedDocumentType !== undefined)) return;
    for (const record of yield* this.validationsForSchema(schemaId)) {
      if (record.metadata.state.state !== "failed") continue;
      const validator = coreSchemaTable(schema, record.metadata.tableName)?.stagedDocumentType;
      if (validator === undefined || record.metadata.validatorHash !== (yield* coreDocumentValidatorHash(validator))) continue;
      yield* this.startTableValidation(schemaId, record.metadata.tableName, record.metadata.validatorHash, null);
    }
  }));

  /** Only violating staged writes call this; counter rows remain untouched. */
  readonly markFailed = Effect.fn("CoreSchemaValidations.markFailed")((schemaId: string, tableName: string,
    error: string) => Effect.gen({ self: this }, function* () {
    const record = yield* this.validationMetadataForTable(schemaId, tableName);
    if (Option.isNone(record)) return false;
    if (record.value.metadata.state.state !== "failed") yield* this.tx.replaceSystem(SCHEMA_VALIDATIONS,
      record.value.document.id, { ...record.value.metadata, state: { state: "failed", error } });
    return true;
  }));

  readonly validStagedValidators = Effect.fn("CoreSchemaValidations.validStaged")((schemaId: string,
    schema: CoreSchemaDefinition) => Effect.gen({ self: this }, function* () {
    const valid = new Map<string, ValidatorJsonV1>();
    if (!schema.tables.some(table => table.stagedDocumentType !== undefined)) return valid;
    for (const record of yield* this.validationsForSchema(schemaId)) {
      if (record.metadata.state.state !== "valid") continue;
      const validator = coreSchemaTable(schema, record.metadata.tableName)?.stagedDocumentType;
      if (validator !== undefined && record.metadata.validatorHash === (yield* coreDocumentValidatorHash(validator)))
        valid.set(record.metadata.tableName, validator);
    }
    return valid;
  }));

  readonly invalidateTableReferences = Effect.fn("CoreSchemaValidations.invalidateReferences")((tableName: string) => Effect.gen({ self: this }, function* () {
    if (!this.tx.tableExists(SCHEMA_VALIDATIONS)) return;
    for (const state of ["active", "validated", "pending"] as const) {
      const selected = yield* Effect.fromResult(this.tx.schemaRegistry.getByState(this.tx.namespace, state,
        this.tx.schemaTableStateIndex(), this.tx.addIndexRead));
      if (Option.isNone(selected)) continue;
      for (const table of selected.value.schema.tables) if (table.stagedDocumentType !== undefined
        && coreValidatorReferences(table.stagedDocumentType, tableName)) yield* this.markFailed(selected.value.id, table.tableName,
          `Table ${tableName} is referenced by the staged validator for ${table.tableName} but was deleted or replaced; redeploy to revalidate ${table.tableName}.`);
    }
  }));

  readonly deleteValidationsForSchema = Effect.fn("CoreSchemaValidations.deleteForSchema")((schemaId: string) => Effect.gen({ self: this }, function* () {
    for (const record of yield* this.validationsForSchema(schemaId)) yield* this.deleteAttempt(record.document.id);
  }));

  readonly deleteEnforcedValidationsForSchema = Effect.fn("CoreSchemaValidations.deleteEnforced")((schemaId: string) => Effect.gen({ self: this }, function* () {
    for (const record of yield* this.validationsForSchema(schemaId)) if (record.metadata.validatorHash === undefined)
      yield* this.deleteAttempt(record.document.id);
  }));

  private readonly deleteAttempt = Effect.fn("CoreSchemaValidations.deleteAttempt")((attemptId: string) => Effect.gen({ self: this }, function* () {
    yield* this.counters.delete(attemptId);
    yield* this.tx.deleteSystem(SCHEMA_VALIDATIONS, attemptId);
  }));

  private readonly insertValidation = Effect.fn("CoreSchemaValidations.insert")((schemaId: string, tableName: string,
    validatorHash: string | undefined, state: CoreSchemaValidationState, numDocsValidated: bigint,
    totalDocs: bigint | null) => Effect.gen({ self: this }, function* () {
    if (Option.isSome(yield* this.validationMetadataForTable(schemaId, tableName)))
      return yield* Effect.fail(coreSchemaCorrupt("Duplicate table validation attempt"));
    const id = yield* this.tx.insertSystem(SCHEMA_VALIDATIONS, { schemaId, tableName,
      ...(validatorHash === undefined ? {} : { validatorHash }), state });
    yield* this.counters.create(id, numDocsValidated, totalDocs);
    return id;
  }));
}
