import { Data, Effect, Result, Schema } from "effect";
import { compareBytesLexicographically, copyBytes } from "@flarex/utils/bytes";
import { decodeExactDecimal } from "flarex-protocol/internal/exact-decimal";
import { isRelationalColumnValue, validateRelationalRowValues, type RelationalColumnIdentity, type RelationalPersistenceCapability, type RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import type { LogicalDocumentFailure, LogicalDocumentFailureReason } from "./model";
import { canonicalizeFlarexValueV1Effect, copyCanonicalFlarexValueBytesV1, copyFlarexValueSha256V1, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import { capturePrivateJsonData, inspectCapturedPrivateJsonData, useCapturedPrivateJsonData } from "../../../values/privateJsonData";
import { detachStoredAppDocumentEvidence, detachStoredAppRowRevisionEvidence, inspectStoredAppDocumentEvidence } from "../appRowCanonicalEvidence";
import type { AppRowReadResultV1 } from "../appRows";
import { snapshotDecodedProtocolPlainData } from "flarex-protocol/internal/decoded-protocol-snapshot";
import { isLocatedAppIndexDefinitionV1, type LocatedAppIndexDefinitionV1 } from "../../indexes/locatedAppIndexDefinition";
import { isLocatedAppUniqueConstraintDefinitionV1, type LocatedAppUniqueConstraintDefinitionV1 } from "../../unique/locatedAppUniqueConstraintDefinition";
import { lowerAppDeveloperIndexKeyV1 } from "../../indexes/appDeveloperIndexKeys";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../../unique/appUniqueConstraintKeys";
import { inspectCanonicalFlarexValueOwnershipV1, isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/value";

export function relationalTextIdentity<Failure>(table: RelationalTableDefinition, error: LogicalDocumentFailure<Failure>) {
  const primary = table.keys.find(key => key.kind === "primary");
  const unique = table.keys.filter(key => key.kind === "unique");
  const selected = primary ?? (unique.length === 1 ? unique[0] : undefined);
  const columns = selected?.columns.map(column => column.columnId);
  return columns === undefined || columns.length === 0 ||
    columns.some(key => {
      const column = table.columns.find(candidate => candidate.identity.columnId === key);
      return column?.type !== "text" || column.nullable;
    }) ? Result.fail(error("invalidInput")) : Result.succeed(Object.freeze(columns));
}

const Raw = Schema.Struct({ value: Schema.String,
  precision: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 1000 })),
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });
const decodeRaw = Schema.decodeUnknownResult(Raw);

const belongsTo = (table: RelationalTableDefinition, column: RelationalColumnIdentity) =>
  column.owner === table.identity.owner && column.lineageId === table.identity.lineageId && column.tableId === table.identity.tableId;

export const logicalManagedUpdatedColumns = (table: RelationalTableDefinition,
  capabilities: readonly RelationalPersistenceCapability[]) => capabilities.flatMap(capability =>
  capability.kind === "managedTimestamps" && belongsTo(table, capability.createdAtColumn)
    ? [capability.updatedAtColumn.columnId] : []);

/** Complete native values are checked before projection or mutation. Relation
 * enforcement is a separate execution capability, not a row-value rule. */
export function prepareLogicalRelationalRowValues<Failure>(table: RelationalTableDefinition,
  capabilities: readonly RelationalPersistenceCapability[], error: LogicalDocumentFailure<Failure>) {
  const companions = capabilities.flatMap(capability => capability.kind === "exactNumericCompanion" && belongsTo(table, capability.numericColumn)
    ? [{ numeric: capability.numericColumn.columnId, raw: capability.rawColumn.columnId }] : []);
  return (row: JsonObject, reason: "documentInvalid" | "storedCorruption") => Result.gen(function* () {
    yield* validateRelationalRowValues(table, row).pipe(Result.mapError(cause => error(reason, cause)));
    for (const companion of companions) {
      const value = row[companion.numeric];
      const rawValue = row[companion.raw];
      if (value === null && rawValue === null) continue;
      const raw = yield* decodeRaw(rawValue).pipe(Result.mapError(cause => error(reason, cause)));
      const numeric = yield* decodeExactDecimal(String(value)).pipe(Result.mapError(cause => error(reason, cause)));
      const exact = yield* decodeExactDecimal(raw.value).pipe(Result.mapError(cause => error(reason, cause)));
      if (numeric.canonical !== exact.canonical) return yield* Result.fail(error(reason));
    }
  });
}

/** Row-local semantics for the admitted scalar relational profile. Defaults and
 * managed fields use the borrowed transaction's timestamp. Native adapters keep
 * ownership of their input coercion and numeric precision rules. */
export function prepareLogicalRelationalRows<Failure>(table: RelationalTableDefinition,
  capabilities: readonly RelationalPersistenceCapability[], error: LogicalDocumentFailure<Failure>) {
  return compileLogicalRelationalRows(table, capabilities, error, prepareLogicalRelationalRowValues(table, capabilities, error));
}

function compileLogicalRelationalRows<Failure>(table: RelationalTableDefinition,
  capabilities: readonly RelationalPersistenceCapability[], error: LogicalDocumentFailure<Failure>,
  validate: ReturnType<typeof prepareLogicalRelationalRowValues<Failure>>) {
  return Result.gen(function* () {
    const keyColumns = yield* relationalTextIdentity(table, error);
    const managed = logicalManagedUpdatedColumns(table, capabilities);
    const deletions = capabilities.flatMap(capability => capability.kind === "softDelete" && belongsTo(table, capability.deletedAtColumn)
      ? [capability.deletedAtColumn.columnId] : []);
    const columnsByName = new Map<string, typeof table.columns[number]>(table.columns.map(column => [column.identity.columnId, column]));
    const suppliedRows = new WeakSet<JsonObject>();
    const validateInput = (input: JsonObject) => Result.gen(function* () {
      // A native write cannot smuggle internal Flarex identity fields or columns
      // outside its source. Complete rows are validated again after defaults.
      for (const [name, value] of Object.entries(input)) {
        const column = columnsByName.get(name);
        if (column === undefined || !isRelationalColumnValue(column.type, column.nullable, value))
          return yield* Result.fail(error("documentInvalid"));
      }
      // Only the capture owner's exact detached immutable tree can retain this
      // supplied-input verdict. A frozen foreign wrapper is insufficient.
      if (inspectCapturedPrivateJsonData(input)?.value === input) suppliedRows.add(input);
    });
    const normalize = (input: JsonObject, previous: JsonObject | null, timestamp: string,
      managedUpdate: "advance" | "preserve" = "advance") => Result.gen(function* () {
      if (!suppliedRows.has(input)) yield* validateInput(input);
      const row = { ...previous, ...input };
      if (previous === null) for (const column of table.columns) {
        const name = column.identity.columnId;
        if (Object.hasOwn(row, name)) continue;
        const value = column.default;
        switch (value.kind) {
          case "none": if (column.nullable) row[name] = null; break;
          case "currentTimestamp": row[name] = timestamp; break;
          case "emptyJsonArray": row[name] = []; break;
          case "exactNumericRawLiteral": row[name] = { value: value.value, precision: value.precision }; break;
          case "booleanLiteral": case "textLiteral": case "integerLiteral": case "exactNumericLiteral": row[name] = value.value; break;
        }
      }
      else if (managedUpdate === "advance") for (const column of managed) row[column] = timestamp;
      for (const column of table.columns) {
        if (column.type === "integer" && Object.is(row[column.identity.columnId], -0))
          row[column.identity.columnId] = 0;
      }
      // Row semantics do not own a request/document allowance. Keep capture's
      // ceiling finite without moving the accepting working set's later bounds
      // or independent ordered charges into this immutable-table helper.
      const captured = yield* useCapturedPrivateJsonData(row, Number.MAX_SAFE_INTEGER, error);
      if (!isJsonObject(captured.value)) return yield* Result.fail(error("documentInvalid"));
      yield* validate(captured.value, "documentInvalid");
      normalizedRows.set(captured.value, normalize);
      return captured.value;
    });
    return Object.freeze({ keyColumns, normalize, validate, validateInput,
      deletedAt: deletions.length === 1 ? deletions[0] : undefined });
  });
}

export class LogicalRelationalMechanicsError extends Data.TaggedError("LogicalRelationalMechanicsError")<{
  readonly reason: LogicalDocumentFailureReason; readonly cause?: unknown;
}> {}
const mechanicError: LogicalDocumentFailure<LogicalRelationalMechanicsError> = (reason, cause) =>
  new LogicalRelationalMechanicsError({ reason, ...(cause === undefined ? {} : { cause }) });
const issuedTableMechanics = new WeakMap<object, Readonly<{ table: RelationalTableDefinition;
  capabilities: readonly RelationalPersistenceCapability[] }>>();
const normalizedRows = new WeakMap<JsonObject, object>();
interface CanonicalRowVerdict {
  readonly derived?: WeakMap<ReadonlySet<CanonicalFlarexValueV1>, CanonicalDerivedKeys>;
  readonly kind: "relational";
  /** Stored captures acquire table semantics only at actual query/write inspection. */
  readonly mechanics: PreparedLogicalRelationalTableMechanics | undefined;
  readonly bytes: Uint8Array;
  readonly digest: Uint8Array;
  readonly runtime: JsonObject;
  readonly native: JsonObject;
}
interface CanonicalDocumentVerdict {
  readonly derived?: WeakMap<ReadonlySet<CanonicalFlarexValueV1>, CanonicalDerivedKeys>;
  readonly kind: "document";
  readonly owner: PreparedLogicalCanonicalDocumentSemantics;
  readonly bytes: Uint8Array;
  readonly digest: Uint8Array;
  readonly read: () => CanonicalFlarexRuntimeObjectV1;
  readonly intact: () => boolean;
}
type PreparedLogicalCanonicalDocumentSemantics = ReturnType<typeof prepareLogicalCanonicalDocumentSemantics>;
const canonicalRows = new WeakMap<CanonicalFlarexValueV1, CanonicalRowVerdict | CanonicalDocumentVerdict>();
const canonicalJsonRows = new WeakMap<JsonObject, CanonicalFlarexValueV1>();
const detachedActivityJson = new WeakMap<object, Json>();
const canonicalBytesMatch = (document: CanonicalFlarexValueV1, verdict: CanonicalRowVerdict | CanonicalDocumentVerdict) =>
  compareBytesLexicographically(document.canonicalBytes, verdict.bytes) === 0 &&
  compareBytesLexicographically(document.sha256, verdict.digest) === 0;
interface CanonicalDerivedKeys {
  readonly unique: Map<LocatedAppUniqueConstraintDefinitionV1, Readonly<{ key: Result.Result.Success<ReturnType<typeof lowerCanonicalAppUniqueConstraintV1Result>>; bytes?: Uint8Array }>>;
  readonly index: Map<LocatedAppIndexDefinitionV1, Map<AppCreationTimeV1, Result.Result.Success<ReturnType<typeof lowerAppDeveloperIndexKeyV1>>>>;
}
export interface LogicalCanonicalKeyOwner<Failure> {
  /** The existing root/local retained-document owner is the cache lifetime. */
  readonly identity: ReadonlySet<CanonicalFlarexValueV1>;
  readonly retain: (document: CanonicalFlarexValueV1, bytes: number) => Result.Result<void, Failure>;
  readonly error: LogicalDocumentFailure<Failure>;
}
function derivedKeys(document: CanonicalFlarexValueV1, verdict: CanonicalRowVerdict | CanonicalDocumentVerdict, owner: ReadonlySet<CanonicalFlarexValueV1>) {
  const owners = verdict.derived ?? new WeakMap<ReadonlySet<CanonicalFlarexValueV1>, CanonicalDerivedKeys>();
  const retained = owners.get(owner);
  if (retained !== undefined) return retained;
  const derived: CanonicalDerivedKeys = { unique: new Map(), index: new Map() };
  owners.set(owner, derived);
  canonicalRows.set(document, Object.freeze({ ...verdict, derived: owners }));
  return derived;
}
export function forgetLogicalCanonicalDerivedKeys(document: CanonicalFlarexValueV1, owner: ReadonlySet<CanonicalFlarexValueV1>) {
  canonicalRows.get(document)?.derived?.delete(owner);
}
export function logicalUniqueKeyRetentionBytes(key: Result.Result.Success<ReturnType<typeof lowerCanonicalAppUniqueConstraintV1Result>>) {
  return key.kind === "claim" ? 128 + 32 * key.projection.values.length + 2 * key.encodedKey.length
    + 2 * key.canonicalKeyBytes.byteLength + 2 * key.localeKey.length : 128 + 2 * key.localeKey.length;
}

/** Interpretation belongs to the actual canonical revision, separate from its
 * preimage. Only genuine catalog definitions and canonical owner verdicts can
 * retain it; every use still checks the original mutable byte/digest evidence. */
export function lowerLogicalCanonicalUniqueKey<Failure>(definition: LocatedAppUniqueConstraintDefinitionV1, document: CanonicalFlarexValueV1,
  owner: LogicalCanonicalKeyOwner<Failure>, reason: "documentInvalid" | "storedCorruption" | "invalidInput") {
  return Result.gen(function* () {
    const verdict = canonicalRows.get(document);
    if (verdict !== undefined && (!canonicalBytesMatch(document, verdict) || verdict.kind === "document" && !verdict.intact()))
      return yield* Result.fail(owner.error(reason));
    const eligible = verdict !== undefined && isLocatedAppUniqueConstraintDefinitionV1(definition);
    const retained = verdict?.derived?.get(owner.identity)?.unique.get(definition);
    if (retained !== undefined) {
      if (retained.key.kind === "claim" && (retained.bytes === undefined ||
          compareBytesLexicographically(retained.key.canonicalKeyBytes, retained.bytes) !== 0))
        return yield* Result.fail(owner.error(reason));
      return retained.key;
    }
    const lowered = yield* lowerCanonicalAppUniqueConstraintV1Result(definition, document).pipe(Result.mapError(cause => owner.error(reason, cause)));
    if (verdict !== undefined && eligible) {
      const bytes = lowered.kind === "claim" ? lowered.canonicalKeyBytes : undefined;
      // Account both native/projection storage and the protected integrity copy.
      yield* owner.retain(document, logicalUniqueKeyRetentionBytes(lowered));
      derivedKeys(document, verdict, owner.identity).unique.set(definition,
        Object.freeze({ key: lowered, ...(bytes === undefined ? {} : { bytes: copyBytes(bytes) }) }));
    }
    return lowered;
  });
}

export function lowerLogicalCanonicalIndexKey<Failure>(definition: LocatedAppIndexDefinitionV1, document: CanonicalFlarexValueV1, creationTime: AppCreationTimeV1,
  owner: LogicalCanonicalKeyOwner<Failure>, reason: "documentInvalid" | "storedCorruption" | "invalidInput") {
  return Result.gen(function* () {
    const verdict = canonicalRows.get(document);
    if (verdict !== undefined && (!canonicalBytesMatch(document, verdict) || verdict.kind === "document" && !verdict.intact()))
      return yield* Result.fail(owner.error(reason));
    const eligible = verdict !== undefined && isLocatedAppIndexDefinitionV1(definition);
    const retained = verdict?.derived?.get(owner.identity)?.index.get(definition);
    if (retained?.has(creationTime)) return retained.get(creationTime) ?? null;
    const lowered = yield* lowerAppDeveloperIndexKeyV1(definition, document, creationTime).pipe(Result.mapError(cause => owner.error(reason, cause)));
    if (verdict !== undefined && eligible) {
      yield* owner.retain(document, 128 + 2 * (lowered?.length ?? 0));
      const byCreationTime = retained ?? new Map<AppCreationTimeV1, Result.Result.Success<ReturnType<typeof lowerAppDeveloperIndexKeyV1>>>();
      byCreationTime.set(creationTime, lowered);
      derivedKeys(document, verdict, owner.identity).index.set(definition, byCreationTime);
    }
    return lowered;
  });
}
const decodeDocument = Schema.decodeUnknownResult(Schema.JsonObject);

/** The existing canonical document owner retains complete source semantics,
 * never admission or budgets. Foreign wrappers receive their original complete
 * validation and acquire no verdict, even when their values are frozen. */
function validateLogicalDocumentCanonicalSemantics<Failure>(document: CanonicalFlarexValueV1,
  owner: PreparedLogicalCanonicalDocumentSemantics, validate: (runtime: CanonicalFlarexRuntimeObjectV1) => Result.Result<boolean, Failure>,
  error: () => Failure): Result.Result<void, Failure> {
  return Result.gen(function* () {
    const prior = canonicalRows.get(document);
    if (prior !== undefined && !canonicalBytesMatch(document, prior)) return yield* Result.fail(error());
    if (prior?.kind === "document" && !prior.intact()) return yield* Result.fail(error());
    if (prior?.kind === "document" && prior.owner === owner) return;
    const issued = inspectCanonicalFlarexValueOwnershipV1(document);
    if (issued !== undefined && !issued.intact) return yield* Result.fail(error());
    const runtime = issued?.read() ?? document.value;
    if (!isCanonicalFlarexRuntimeObjectV1(runtime)) return yield* Result.fail(error());
    const reuseEligible = yield* validate(runtime);
    if (!reuseEligible || issued === undefined || document.profile !== "appDocument") return;
    // read() is a defensive runtime loan; its containers and protected binary
    // storage were normalized/owned by the actual codec before any escape.
    const read = () => {
      const value = issued.read();
      if (!isCanonicalFlarexRuntimeObjectV1(value)) throw new Error("Canonical document issuer lost its object runtime");
      return value;
    };
    canonicalRows.set(document, Object.freeze({ kind: "document", owner, read,
      intact: () => inspectCanonicalFlarexValueOwnershipV1(document)?.intact === true,
      bytes: copyBytes(document.canonicalBytes), digest: copyBytes(document.sha256) }));
  });
}

/** Exact source/table/generation identity only; changed bytes are corruption,
 * while a different owner or foreign document retains full validation. */
function inspectLogicalDocumentCanonicalSemantics<Failure>(document: CanonicalFlarexValueV1,
  owner: PreparedLogicalCanonicalDocumentSemantics, error: () => Failure): Result.Result<CanonicalFlarexRuntimeObjectV1 | undefined, Failure> {
  const prior = canonicalRows.get(document);
  if (prior !== undefined && !canonicalBytesMatch(document, prior)) return Result.fail(error());
  if (prior?.kind === "document" && !prior.intact()) return Result.fail(error());
  const issued = inspectCanonicalFlarexValueOwnershipV1(document);
  if (issued !== undefined && !issued.intact) return Result.fail(error());
  return Result.succeed(prior?.kind === "document" && prior.owner === owner ? prior.read() : undefined);
}

/** The exact source construction captures its full table/validator/ID policy.
 * The immutable validate/inspect owner is the retained identity; another table
 * factory cannot register a verdict for this source by supplying its table. */
export function prepareLogicalCanonicalDocumentSemantics<Failure>(
  validate: (runtime: CanonicalFlarexRuntimeObjectV1) => Result.Result<boolean, Failure>,
  error: () => Failure,
) {
  const validateDocument = (document: CanonicalFlarexValueV1): Result.Result<void, Failure> =>
    validateLogicalDocumentCanonicalSemantics(document, owner, validate, error);
  const inspectDocument = (document: CanonicalFlarexValueV1): Result.Result<CanonicalFlarexRuntimeObjectV1 | undefined, Failure> =>
    inspectLogicalDocumentCanonicalSemantics(document, owner, error);
  const owner = Object.freeze({ validate: validateDocument, inspect: inspectDocument });
  return owner;
}

/** Canonicalization is issued here, after this table's complete immutable row
 * verdict. Neither a structural match nor a consumer-supplied Boolean can
 * associate validation evidence with a canonical document. */
export const canonicalizeLogicalRelationalRow = Effect.fnUntraced(function* (
  mechanics: PreparedLogicalRelationalTableMechanics, fields: JsonObject,
  documentId: AppDocumentIdV1, creationTime: AppCreationTimeV1,
) {
  yield* Effect.fromResult(Result.gen(function* () {
    if (!issuedTableMechanics.has(mechanics)) return yield* Result.fail(mechanicError("invalidAuthority"));
    const rows = yield* mechanics.rows;
    if (normalizedRows.get(fields) !== rows.normalize) return yield* Result.fail(mechanicError("invalidAuthority"));
  }));
  const document = yield* canonicalizeFlarexValueV1Effect({ ...fields, _id: documentId, _creationTime: creationTime }, "appDocument")
    .pipe(Effect.mapError(cause => mechanicError("documentInvalid", cause)));
  // Capture the actual runtime representation once. valueJson is the policy
  // representation and may contain codec tags where runtime contains -0.
  yield* Effect.fromResult(Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(document.value, Number.MAX_SAFE_INTEGER, mechanicError);
    if (!isJsonObject(captured.value)) return yield* Result.fail(mechanicError("documentInvalid"));
    const native = yield* useCapturedPrivateJsonData(Object.fromEntries(Object.entries(captured.value)
      .filter(([name]) => name !== "_id" && name !== "_creationTime")), Number.MAX_SAFE_INTEGER, mechanicError);
    if (!isJsonObject(native.value)) return yield* Result.fail(mechanicError("documentInvalid"));
    canonicalRows.set(document, Object.freeze({ kind: "relational", mechanics, bytes: document.canonicalBytes.slice(), digest: document.sha256.slice(),
      runtime: captured.value, native: native.value }));
    if (isJsonObject(document.valueJson)) canonicalJsonRows.set(document.valueJson, document);
  }));
  return document;
});

/** The return owner still applies its own bound and charge. Genuine canonical
 * issuers lend the retained runtime tree; foreign rows capture fully. */
export function captureLogicalRelationalCanonicalRow<Failure>(document: CanonicalFlarexValueV1,
  maximum: number, error: LogicalDocumentFailure<Failure>): Result.Result<Readonly<{ value: Json; bytes: number }>, Failure> {
  const verdict = canonicalRows.get(document);
  if (verdict !== undefined) return canonicalBytesMatch(document, verdict)
    ? useCapturedPrivateJsonData(verdict.kind === "relational" ? verdict.runtime : verdict.read(), maximum, error) : Result.fail(error("storedCorruption"));
  return Result.gen(function* () {
    const stored = yield* inspectStoredAppDocumentEvidence(document).pipe(Result.mapError(cause => error("storedCorruption", cause)));
    // Full capture stays at its original accepting bound. Decoder provenance
    // cannot make mutable binary leaves or a failed JSON capture reusable.
    const captured = yield* capturePrivateJsonData(document.value, maximum, error);
    if (stored === undefined || !isJsonObject(captured.value)) return captured;
    const native = yield* useCapturedPrivateJsonData(Object.fromEntries(Object.entries(captured.value)
      .filter(([name]) => name !== "_id" && name !== "_creationTime")), Number.MAX_SAFE_INTEGER, error);
    if (!isJsonObject(native.value)) return yield* Result.fail(error("storedCorruption"));
    canonicalRows.set(document, Object.freeze({ kind: "relational", mechanics: undefined, runtime: captured.value, native: native.value,
      bytes: copyBytes(document.canonicalBytes), digest: copyBytes(document.sha256) }));
    if (isJsonObject(stored.policy)) canonicalJsonRows.set(stored.policy, document);
    return captured;
  });
}

/** Activity policy borrows its distinct JSON representation, never runtime.
 * Retain the existing canonical JSON projection identity only after capture. */
export function captureLogicalRelationalActivityJson<Failure>(document: CanonicalFlarexValueV1,
  error: LogicalDocumentFailure<Failure>): Result.Result<Readonly<{ value: Json; bytes: number }>, Failure> {
  return Result.gen(function* () {
    const verdict = canonicalRows.get(document);
    if (verdict !== undefined && !canonicalBytesMatch(document, verdict)) return yield* Result.fail(error("storedCorruption"));
    const stored = verdict === undefined ? yield* inspectStoredAppDocumentEvidence(document)
      .pipe(Result.mapError(cause => error("storedCorruption", cause))) : undefined;
    const original = document.valueJson;
    const owned = isJsonObject(original) && (canonicalJsonRows.has(original) || stored !== undefined);
    const prior = owned ? detachedActivityJson.get(original) : undefined;
    const captured = yield* useCapturedPrivateJsonData(prior ?? original, Number.MAX_SAFE_INTEGER,
      (_reason, cause) => error("storedCorruption", cause));
    if (owned) {
      canonicalJsonRows.set(original, document);
      detachedActivityJson.set(original, captured.value);
    }
    return captured;
  });
}

/** Complete semantic validation precedes predicate/projection. A copied row or
 * changed mechanics cannot borrow the issuer's native-field verdict. */
export function inspectLogicalRelationalCanonicalRow(mechanics: PreparedLogicalRelationalTableMechanics,
  document: CanonicalFlarexValueV1, runtime: JsonObject,
  reason: "documentInvalid" | "storedCorruption"): Result.Result<JsonObject | undefined, LogicalRelationalMechanicsError> {
  if (!issuedTableMechanics.has(mechanics)) return Result.fail(mechanicError("invalidAuthority"));
  const verdict = canonicalRows.get(document);
  if (verdict !== undefined && !canonicalBytesMatch(document, verdict)) return Result.fail(mechanicError(reason));
  if (verdict?.kind !== "relational" || verdict.runtime !== runtime)
    return Result.succeed(undefined);
  if (verdict.mechanics === mechanics) return Result.succeed(verdict.native);
  if (verdict.mechanics !== undefined) return Result.succeed(undefined);
  // A genuine stored runtime capture retains no table acceptance until this
  // original inspection position. Failed verdicts remain uncached.
  return mechanics.validate(verdict.native, reason).pipe(Result.map(() => {
    canonicalRows.set(document, Object.freeze({ ...verdict, mechanics }));
    return verdict.native;
  }));
}

/** The same native view feeds writes and lifecycle observations. Foreign rows
 * receive the accepting owner's complete value and table validation each time. */
export function nativeLogicalRelationalCanonicalRow<Failure>(mechanics: PreparedLogicalRelationalTableMechanics,
  document: CanonicalFlarexValueV1, maximum: number, error: LogicalDocumentFailure<Failure>): Result.Result<JsonObject, Failure> {
  return Result.gen(function* () {
    const captured = yield* captureLogicalRelationalCanonicalRow(document, maximum, error);
    if (!isJsonObject(captured.value)) return yield* Result.fail(error("storedCorruption"));
    const native = yield* inspectLogicalRelationalCanonicalRow(mechanics, document, captured.value, "storedCorruption")
      .pipe(Result.mapError(cause => error(cause.reason, cause.cause)));
    if (native !== undefined) return native;
    const fields = Object.fromEntries(Object.entries(captured.value).filter(([name]) => name !== "_id" && name !== "_creationTime"));
    yield* mechanics.validate(fields, "storedCorruption").pipe(Result.mapError(cause => error(cause.reason, cause.cause)));
    const owned = yield* useCapturedPrivateJsonData(fields, Number.MAX_SAFE_INTEGER, error);
    if (!isJsonObject(owned.value)) return yield* Result.fail(error("storedCorruption"));
    return owned.value;
  });
}

/** Validation evidence has value provenance only; admission and liveness stay
 * with their accepting owners. Mutable buffers are checked against protected
 * copies on every reuse, without decoding/revalidating the complete row. */
export function validateLogicalRelationalCanonicalRow(mechanics: PreparedLogicalRelationalTableMechanics,
  document: CanonicalFlarexValueV1, reason: "documentInvalid" | "storedCorruption") {
  return Result.gen(function* () {
    if (!issuedTableMechanics.has(mechanics)) return yield* Result.fail(mechanicError("invalidAuthority"));
    const verdict = canonicalRows.get(document);
    if (verdict !== undefined && !canonicalBytesMatch(document, verdict)) return yield* Result.fail(mechanicError(reason));
    if (verdict?.kind === "relational") {
      const native = yield* inspectLogicalRelationalCanonicalRow(mechanics, document, verdict.runtime, reason);
      if (native !== undefined) return;
    }
    const value = yield* decodeDocument(document.value).pipe(Result.mapError(cause => mechanicError(reason, cause)));
    const fields: JsonObject = {};
    for (const [name, member] of Object.entries(value)) {
      if (name !== "_id" && name !== "_creationTime") Object.defineProperty(fields, name, { value: member, enumerable: true });
    }
    yield* mechanics.validate(fields, reason);
  });
}

/** Only this owner clones and issues a detached canonical copy. Foreign
 * documents gain no verdict. Canonical trees are already immutable;
 * owned copies share those trees and detach every mutable buffer. */
export function detachLogicalCanonicalDocument(document: CanonicalFlarexValueV1): CanonicalFlarexValueV1 {
  const verdict = canonicalRows.get(document);
  if (verdict === undefined) return detachStoredAppDocumentEvidence(document);
  // Keep a changed buffer's original verdict, so detachment cannot launder a
  // corruption into a foreign row that only requires semantic validation.
  // Derived keys belong to the retaining root/local revision owner. Neither
  // the new verdict nor its runtime getter retains another revision's keys.
  const { derived: _derived, ...interpretation } = verdict;
  const detached = Object.freeze({ profile: document.profile, codecVersion: document.codecVersion,
    valueJson: document.valueJson, semanticSizeBytes: document.semanticSizeBytes, nestingDepth: document.nestingDepth,
    canonicalText: document.canonicalText, get value() { return interpretation.kind === "document" ? interpretation.read() : interpretation.runtime; },
    canonicalBytes: copyCanonicalFlarexValueBytesV1(document.canonicalBytes), sha256: copyFlarexValueSha256V1(document.sha256) });
  const intact = verdict.kind === "document" ? verdict.intact() : true;
  canonicalRows.set(detached, interpretation.kind === "document" ? Object.freeze({ ...interpretation, intact: () => intact }) : Object.freeze(interpretation));
  return detached;
}

/** The root receives an owner-created full revision copy, at its original
 * post-budget frontier. Only an actual issued document transfers interpretation;
 * no caller-supplied destination or structurally matching clone is accepted. */
export function detachLogicalCanonicalRevision(revision: AppRowReadResultV1, sourceDocument: CanonicalFlarexValueV1 | null): AppRowReadResultV1 {
  const copy = detachStoredAppRowRevisionEvidence(revision, sourceDocument);
  const detached = copy.revision;
  if (copy.sourceDocument === null || detached.kind !== "live") return detached;
  const verdict = canonicalRows.get(copy.sourceDocument);
  if (verdict === undefined) return detached;
  const { derived: _derived, ...interpretation } = verdict;
  const intact = interpretation.kind === "document" ? interpretation.intact() : true;
  const document = Object.freeze({ ...detached.document, valueJson: copy.sourceDocument.valueJson,
    get value() { return interpretation.kind === "document" ? interpretation.read() : interpretation.runtime; } });
  canonicalRows.set(document, interpretation.kind === "document" ? Object.freeze({ ...interpretation, intact: () => intact }) : Object.freeze(interpretation));
  return { ...detached, document };
}

function freezeDetachedActivityJson(member: Json): void {
  if (member === null || typeof member !== "object") return;
  for (const child of Array.isArray(member) ? member : Object.values(member)) freezeDetachedActivityJson(child);
  Object.freeze(member);
}

/** Own the detached immutable policy value. Only exact canonical/captured JSON
 * provenance retains its projection; arbitrary frozen structures clone fully. */
export function detachLogicalRelationalActivityJson(value: JsonObject): JsonObject;
export function detachLogicalRelationalActivityJson(value: JsonObject | null): JsonObject | null;
export function detachLogicalRelationalActivityJson(value: Json): Json;
export function detachLogicalRelationalActivityJson(value: Json): Json {
  if (value === null || typeof value !== "object") return value;
  // The capture issuer already owns a detached immutable JSON tree. Sharing
  // that value exposes no mutable byte storage or original caller references.
  if (inspectCapturedPrivateJsonData(value)?.value === value) return value;
  const owned = isJsonObject(value) && canonicalJsonRows.has(value);
  const previous = owned ? detachedActivityJson.get(value) : undefined;
  if (previous !== undefined) return previous;
  const detached = structuredClone(value);
  freezeDetachedActivityJson(detached);
  if (owned) detachedActivityJson.set(value, detached);
  return detached;
}

/** Compile only immutable table mechanics. A failed table identity remains a
 * lazy verdict consumed where that operation previously prepared its table. */
export function prepareLogicalRelationalTableMechanics(sourceTable: RelationalTableDefinition,
  sourceCapabilities: readonly RelationalPersistenceCapability[]) {
  // This existing issuer owns the decoded source snapshot. A caller's readonly
  // type or a frozen outer wrapper cannot make nested schema inputs immutable.
  const table = snapshotDecodedProtocolPlainData(sourceTable);
  const capabilities = snapshotDecodedProtocolPlainData(sourceCapabilities);
  const validate = prepareLogicalRelationalRowValues(table, capabilities, mechanicError);
  const rows = Object.freeze(compileLogicalRelationalRows(table, capabilities, mechanicError, validate));
  const columns = new Map<string, typeof table.columns[number]>(table.columns.map(column => [column.identity.columnId, column]));
  const mechanics = Object.freeze({ table, capabilities,
    column: (name: string) => columns.get(name), columnNames: Object.freeze([...columns.keys()]),
    identity: Object.freeze(rows.pipe(Result.map(policy => policy.keyColumns))), rows, validate,
  });
  issuedTableMechanics.set(mechanics, Object.freeze({ table: sourceTable, capabilities: sourceCapabilities }));
  return mechanics;
}
export type PreparedLogicalRelationalTableMechanics = ReturnType<typeof prepareLogicalRelationalTableMechanics>;
export const hasPreparedLogicalRelationalTableMechanics = (mechanics: PreparedLogicalRelationalTableMechanics,
  table: RelationalTableDefinition, capabilities?: readonly RelationalPersistenceCapability[]) => {
  const issued = issuedTableMechanics.get(mechanics);
  return issued !== undefined && (issued.table === table || mechanics.table === table) &&
    (capabilities === undefined || issued.capabilities === capabilities || mechanics.capabilities === capabilities);
};

export function bindPreparedLogicalRelationalRows<Failure>(mechanics: PreparedLogicalRelationalTableMechanics,
  error: LogicalDocumentFailure<Failure>) {
  if (!issuedTableMechanics.has(mechanics)) return Result.fail(error("invalidAuthority"));
  const project = (cause: LogicalRelationalMechanicsError) => error(cause.reason, cause.cause);
  return mechanics.rows.pipe(Result.mapError(project), Result.map(rows => Object.freeze({
    keyColumns: rows.keyColumns, deletedAt: rows.deletedAt,
    normalize: (...args: Parameters<typeof rows.normalize>) => rows.normalize(...args).pipe(Result.mapError(project)),
    validate: (...args: Parameters<typeof rows.validate>) => rows.validate(...args).pipe(Result.mapError(project)),
    validateInput: (...args: Parameters<typeof rows.validateInput>) => rows.validateInput(...args).pipe(Result.mapError(project)),
  })));
}
