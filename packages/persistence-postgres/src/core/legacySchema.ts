/** Frozen c554 metadata decoders, used only by the one-time logical migration and pre-cutover history. */
import { Result, Schema } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { ValidatorJsonV1, validatorJsonAdmissionIssueV1 } from "flarex-protocol/validator-json";
import { CorePersistenceError } from "./contracts";
import type { CoreRegistryDecoders } from "./registry";
import type { CoreSystemDocument } from "./transaction";

const Hex = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{32}$/.test(value) ? undefined : "Expected an internal identity"));
const LegacyTable = Schema.Struct({ name: Schema.String, number: Schema.Int, tabletId: Hex, validator: Schema.String });
const LegacyIndex = Schema.Struct({ name: Schema.String, tableNumber: Schema.Int, fields: Schema.Array(Schema.String),
  enabled: Schema.Boolean, persistenceIndexId: Schema.optionalKey(Schema.BigInt) });
const decodeTable = Schema.decodeUnknownResult(LegacyTable);
const decodeIndex = Schema.decodeUnknownResult(LegacyIndex);
const corrupt = (cause?: unknown) => new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });

export const decodeLegacyTable = (document: CoreSystemDocument) => Result.gen(function* () {
  const metadata = yield* Result.mapError(decodeTable(document.value), corrupt);
  const id = yield* Result.mapError(decodeDocumentId(document.id), corrupt);
  if (metadata.number <= 0 || metadata.number > 0xffff_ffff || encodeBytesToLowercaseHex(id.internalId) !== metadata.tabletId)
    return yield* Result.fail(corrupt());
  const parsed = yield* Result.try({ try: (): unknown => JSON.parse(metadata.validator), catch: (cause: unknown) => {
    if (cause instanceof SyntaxError) return corrupt(cause);
    throw cause;
  } });
  const issue = validatorJsonAdmissionIssueV1(parsed);
  if (issue !== undefined) return yield* Result.fail(corrupt(issue));
  const validator = yield* Result.mapError(Schema.decodeUnknownResult(ValidatorJsonV1)(parsed), corrupt);
  return { metadata, id: id.internalId.slice(), validator };
});

export const LEGACY_CORE_REGISTRY_DECODERS: CoreRegistryDecoders = {
  table: (document, ts) => Result.map(decodeLegacyTable(document), ({ metadata, id }) => ({ id, ts,
    definition: { name: metadata.name, number: metadata.number, tabletId: id.slice(), namespace: null, state: "active" as const, indexes: [] } })),
  index: (document, ts, registry) => Result.gen(function* () {
    const metadata = yield* Result.mapError(decodeIndex(document.value), corrupt);
    const id = yield* Result.mapError(decodeDocumentId(document.id), corrupt);
    const table = registry.tableByNumber(metadata.tableNumber);
    if (table === undefined || !bytesEqual(table.id, table.definition.tabletId)) return yield* Result.fail(corrupt());
    return { ref: { id: id.internalId, ...(metadata.persistenceIndexId === undefined ? {} : { persistenceIndexId: metadata.persistenceIndexId }) },
      tableId: table.id.slice(), name: metadata.name, fields: metadata.fields, ts,
      state: metadata.enabled ? { type: "Enabled" as const } : { type: "Backfilled2" as const, staged: true } };
  }),
};
