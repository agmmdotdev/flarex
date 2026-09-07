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
  if (!isCapturedRelationalPhysicalLayout(layout)) return yield* Effect.fail(invalid());
  const table = layout.frame.tables.find(candidate => candidate.identity.tableId === tableId);
  const primary = table?.keys.find(key => key.kind === "primary");
  if (table === undefined || primary === undefined) return yield* Effect.fail(invalid());
  const components: JsonObject[] = [];
  for (const name of primary.columns.filter(candidate => candidate !== "scope_uuid")) {
    const column = table.columns.find(candidate => candidate.name === name);
    const value = column === undefined ? undefined : row[column.identity.columnId];
    if (column === undefined || column.type !== "text" || !isPrivateValueText(value) || value.length === 0) return yield* Effect.fail(invalid());
    components.push({ columnId: column.identity.columnId, type: "text", value });
  }
  if (components.length === 0 || components.length > 16) return yield* Effect.fail(invalid());
  const captured = yield* capturePrivateCanonicalValue({ format: "flarex.relational-primary-key", version: 1, keyId: primary.identity.keyId, components }, 4096,
    { invalidInput: invalid, hashFailure: cause => corrupt(cause) });
  return captured;
});

export const decodeRelationalPrimaryKey = Effect.fn("RelationalChanges.decodePrimaryKey")(function* (
  layout: RelationalPhysicalLayout, tableId: string, bytes: Uint8Array,
) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 4096) return yield* Effect.fail(corrupt());
  const json = yield* Effect.try({ try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes), catch: corrupt });
  const parsed: unknown = yield* Effect.try({ try: () => JSON.parse(json), catch: corrupt });
  const captured = yield* Effect.fromResult(capturePrivateJsonData(parsed, 4096, (_reason, cause) => corrupt(cause)));
  if (!isJsonObject(captured.value) || !Array.isArray(captured.value.components)) return yield* Effect.fail(corrupt());
  const row: Record<string, string> = Object.create(null);
  for (const component of captured.value.components) {
    if (!isJsonObject(component) || typeof component.columnId !== "string" || typeof component.value !== "string" || Object.hasOwn(row, component.columnId)) return yield* Effect.fail(corrupt());
    row[component.columnId] = component.value;
  }
  const expected = yield* captureRelationalPrimaryKey(layout, tableId, row).pipe(Effect.mapError(corrupt));
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
    if (row.changeOrdinal !== ordinal || row.epochUuid !== header.epochUuid || row.codecVersion !== 1 || row.installationSha256 !== input.installationSha256 ||
      row.artifactSha256 !== input.layout.frame.artifact.artifactSha256 || !["insert", "update", "delete"].includes(row.operation)) return yield* Effect.fail(corrupt());
    const key = yield* decodeRelationalPrimaryKey(input.layout, row.tableId, row.keyBytes);
    facts.push(Object.freeze({ tableId: row.tableId, key, operation: row.operation, changeOrdinal: ordinal }));
  }
  return Object.freeze(facts);
});
