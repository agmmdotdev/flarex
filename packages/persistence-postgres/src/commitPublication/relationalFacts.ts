import { isPrivateValueText } from "../frameworkSchema/privateStoredValueShape";
import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import type { CommitSeq, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import { capturePrivateCanonicalValue } from "../frameworkSchema/privateCanonicalValue";
import { isCapturedRelationalPhysicalLayout } from "../relationalSchema/physical/canonical";
import type { RelationalPhysicalLayout } from "../relationalSchema/physical/model";
import { capturePrivateJsonData } from "../privateJsonData";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { fxSystemCommits } from "../schema";
import { fxSystemCommitRelationalChanges } from "./relationalFactsSchema";
import { selectRelationalRowKey } from "./relationalRowKey";

export class RelationalChangeError extends Data.TaggedError("RelationalChangeError")<{
  readonly reason: "invalidKey" | "storedCorruption" | "statementFailure";
  readonly cause?: unknown;
}> {}
const invalid = () => new RelationalChangeError({ reason: "invalidKey" });
const corrupt = (cause?: unknown) => new RelationalChangeError({ reason: "storedCorruption", ...(cause === undefined ? {} : { cause }) });

/** V1 admits declared, ordered text-key components. Additional key scalar types
 * require their own codec proof; column names and table IDs are never inferred. */
export const captureRelationalPrimaryKey = Effect.fn("RelationalChanges.capturePrimaryKey")(function* (
  layout: RelationalPhysicalLayout, tableId: string, row: JsonObject,
) {
  return yield* captureRelationalRowKey(layout, tableId, row);
});

/** Codec 1 retains primary-key bytes; codec 2 names a declared non-null unique key. */
export const captureRelationalRowKey = Effect.fn("RelationalChanges.captureRowKey")(function* (
  layout: RelationalPhysicalLayout, tableId: string, row: JsonObject, keyId?: string,
) {
  if (!isCapturedRelationalPhysicalLayout(layout)) return yield* Effect.fail(invalid());
  const table = layout.frame.tables.find(candidate => candidate.identity.tableId === tableId);
  const primary = yield* Effect.fromResult(selectRelationalRowKey(layout, tableId, keyId)).pipe(Effect.mapError(invalid));
  if (table === undefined) return yield* Effect.fail(invalid());
  const components: JsonObject[] = [];
  for (const name of primary.columns.filter(candidate => candidate !== "scope_uuid")) {
    const column = table.columns.find(candidate => candidate.name === name);
    const value = column === undefined ? undefined : row[column.identity.columnId];
    if (column === undefined || column.type !== "text" || !isPrivateValueText(value) || value.length === 0) return yield* Effect.fail(invalid());
    components.push({ columnId: column.identity.columnId, type: "text", value });
  }
  if (components.length === 0 || components.length > 16) return yield* Effect.fail(invalid());
  const captured = yield* capturePrivateCanonicalValue({
    format: primary.kind === "primary" ? "flarex.relational-primary-key" : "flarex.relational-row-key",
    version: primary.kind === "primary" ? 1 : 2, keyId: primary.identity.keyId, components,
  }, 4096,
    { invalidInput: invalid, hashFailure: cause => corrupt(cause) });
  return captured;
});

export const decodeRelationalPrimaryKey = Effect.fn("RelationalChanges.decodePrimaryKey")(function* (
  layout: RelationalPhysicalLayout, tableId: string, bytes: Uint8Array,
) {
  return yield* decodeRelationalRowKey(layout, tableId, bytes, 1);
});

export const decodeRelationalRowKey = Effect.fn("RelationalChanges.decodeRowKey")(function* (
  layout: RelationalPhysicalLayout, tableId: string, bytes: Uint8Array, codecVersion: 1 | 2,
) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 4096) return yield* Effect.fail(corrupt());
  const json = yield* Effect.try({ try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes), catch: corrupt });
  const parsed: unknown = yield* Effect.try({ try: () => JSON.parse(json), catch: corrupt });
  const captured = yield* Effect.fromResult(capturePrivateJsonData(parsed, 4096, (_reason, cause) => corrupt(cause)));
  if (!isJsonObject(captured.value) || !Array.isArray(captured.value.components) ||
    captured.value.version !== codecVersion || typeof captured.value.keyId !== "string") return yield* Effect.fail(corrupt());
  const row: Record<string, string> = Object.create(null);
  for (const component of captured.value.components) {
    if (!isJsonObject(component) || typeof component.columnId !== "string" || typeof component.value !== "string" || Object.hasOwn(row, component.columnId)) return yield* Effect.fail(corrupt());
    row[component.columnId] = component.value;
  }
  const expected = yield* captureRelationalRowKey(layout, tableId, row, codecVersion === 1 ? undefined : captured.value.keyId).pipe(Effect.mapError(corrupt));
  if (expected.canonicalJson !== json) return yield* Effect.fail(corrupt());
  return expected.frame;
});

/** A bounded private reader for the admitted installation. The caller owns its
 * transaction/snapshot and scope admission; this function cannot acquire either. */
export const readRelationalCommitFactsInTransaction = Effect.fn("RelationalChanges.readCommit")(function* (
  tx: FlarexMetadataTransaction,
  input: { readonly scopeUuid: ScopeUuidV1; readonly commitSeq: CommitSeq; readonly installationSha256: string; readonly layout: RelationalPhysicalLayout },
) {
  if (!isCapturedRelationalPhysicalLayout(input.layout)) return yield* Effect.fail(invalid());
  const statementFailure = (cause: unknown) => new RelationalChangeError({ reason: "statementFailure", cause });
  const headers = yield* runDrizzleStatementEffect(tx.select().from(fxSystemCommits).where(and(eq(fxSystemCommits.scopeUuid, input.scopeUuid), eq(fxSystemCommits.commitSeq, input.commitSeq))).limit(2), statementFailure);
  const header = headers[0];
  if (headers.length !== 1 || header === undefined || !Number.isInteger(header.relationalChangeCount) || header.relationalChangeCount < 0 || header.relationalChangeCount > 16000) return yield* Effect.fail(corrupt());
  const rows = yield* runDrizzleStatementEffect(tx.select().from(fxSystemCommitRelationalChanges).where(and(eq(fxSystemCommitRelationalChanges.scopeUuid, input.scopeUuid),
    eq(fxSystemCommitRelationalChanges.commitSeq, input.commitSeq))).orderBy(fxSystemCommitRelationalChanges.changeOrdinal).limit(16001), statementFailure);
  if (rows.length !== header.relationalChangeCount) return yield* Effect.fail(corrupt());
  const facts = [];
  for (const [ordinal, row] of rows.entries()) {
    if (row.changeOrdinal !== ordinal || row.epochUuid !== header.epochUuid || (row.codecVersion !== 1 && row.codecVersion !== 2) || row.installationSha256 !== input.installationSha256 ||
      row.artifactSha256 !== input.layout.frame.artifact.artifactSha256 || !["insert", "update", "delete"].includes(row.operation)) return yield* Effect.fail(corrupt());
    const key = yield* decodeRelationalRowKey(input.layout, row.tableId, row.keyBytes, row.codecVersion);
    facts.push(Object.freeze({ tableId: row.tableId, key, operation: row.operation, changeOrdinal: ordinal }));
  }
  return Object.freeze(facts);
});
