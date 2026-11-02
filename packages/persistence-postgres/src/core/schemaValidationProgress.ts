/** Convex database/bootstrap_model/schema_validation_progress at db914cf06; FSL-1.1-Apache-2.0. */
import { Effect, Option, Result, Schema } from "effect";
import type { CoreTransactionInternals, CoreSystemDocument } from "./transaction";
import { CoreTransactionError } from "./api";
import { coreSchemaCorrupt, CoreSchemaCountSchema, decodeCoreSchemaValidationProgress,
  PROGRESS_BY_VALIDATION, SCHEMA_VALIDATION_PROGRESS, type CoreSchemaValidationProgressValue } from "./schemaTypes";

/** Borrowed actual transaction capability, with no commit/SQL/public lock wrappers. */
export type CoreSchemaTransaction = Pick<CoreTransactionInternals,
  "getSystem" | "querySystem" | "insertSystem" | "replaceSystem" | "deleteSystem"
  | "ensureUserTable" | "tableExists" | "namespace" | "timestamp" | "schemaRegistry"
  | "schemaTableStateIndex" | "addIndexRead" | "applicationSchemaRetained">;
export interface CoreSchemaProgressRecord {
  readonly document: CoreSystemDocument;
  readonly metadata: CoreSchemaValidationProgressValue;
}
const count = Schema.decodeUnknownResult(CoreSchemaCountSchema);

/** Counters are informational rows. Attempt state is always checked by the caller first. */
export class CoreSchemaValidationProgress {
  constructor(private readonly tx: CoreSchemaTransaction) {}

  readonly get = Effect.fn("CoreSchemaValidationProgress.get")((validationId: string) => Effect.gen({ self: this }, function* () {
    const rows = yield* this.tx.querySystem(SCHEMA_VALIDATION_PROGRESS, PROGRESS_BY_VALIDATION, [validationId]);
    if (rows.length > 1) return yield* Effect.fail(coreSchemaCorrupt("Duplicate validation progress"));
    const document = rows[0];
    if (document === undefined) return Option.none<CoreSchemaProgressRecord>();
    const metadata = yield* Effect.fromResult(decodeCoreSchemaValidationProgress(document.value).pipe(Result.mapError(coreSchemaCorrupt)));
    return Option.some(Object.freeze({ document, metadata: Object.freeze(metadata) }));
  }));

  readonly mustGet = Effect.fn("CoreSchemaValidationProgress.mustGet")((validationId: string) => Effect.gen({ self: this }, function* () {
    const found = yield* this.get(validationId);
    if (Option.isNone(found)) return yield* Effect.fail(coreSchemaCorrupt("Validation attempt is missing its progress"));
    return found.value;
  }));

  readonly create = Effect.fn("CoreSchemaValidationProgress.create")((validationId: string,
    numDocsValidated: bigint, totalDocs: bigint | null) => Effect.gen({ self: this }, function* () {
    if (Option.isSome(yield* this.get(validationId))) return yield* Effect.fail(coreSchemaCorrupt("Duplicate validation progress"));
    yield* this.checkCounts(numDocsValidated, totalDocs);
    yield* this.tx.insertSystem(SCHEMA_VALIDATION_PROGRESS, { validationId, numDocsValidated, totalDocs });
  }));

  readonly reset = Effect.fn("CoreSchemaValidationProgress.reset")((validationId: string, totalDocs: bigint | null) => Effect.gen({ self: this }, function* () {
    const row = yield* this.mustGet(validationId);
    yield* this.checkCounts(0n, totalDocs);
    yield* this.tx.replaceSystem(SCHEMA_VALIDATION_PROGRESS, row.document.id,
      { ...row.metadata, numDocsValidated: 0n, totalDocs });
  }));

  readonly record = Effect.fn("CoreSchemaValidationProgress.record")((validationId: string,
    additionalDocsValidated: bigint, totalDocs: bigint | null) => Effect.gen({ self: this }, function* () {
    const row = yield* this.mustGet(validationId);
    yield* this.checkCounts(additionalDocsValidated, totalDocs);
    const next = row.metadata.numDocsValidated + additionalDocsValidated;
    yield* this.checkCounts(next, totalDocs);
    yield* this.tx.replaceSystem(SCHEMA_VALIDATION_PROGRESS, row.document.id,
      { ...row.metadata, numDocsValidated: next, totalDocs: row.metadata.totalDocs ?? totalDocs });
  }));

  readonly delete = Effect.fn("CoreSchemaValidationProgress.delete")((validationId: string) => Effect.gen({ self: this }, function* () {
    const row = yield* this.get(validationId);
    if (Option.isSome(row)) yield* this.tx.deleteSystem(SCHEMA_VALIDATION_PROGRESS, row.value.document.id);
  }));

  private readonly checkCounts = Effect.fn("CoreSchemaValidationProgress.checkCounts")((value: bigint, total: bigint | null) => Effect.gen(function* () {
    yield* Effect.fromResult(count(value).pipe(Result.mapError(cause => new CoreTransactionError({ reason: "capacity", cause }))));
    if (total !== null) yield* Effect.fromResult(count(total).pipe(Result.mapError(cause => new CoreTransactionError({ reason: "capacity", cause }))));
  }));
}
