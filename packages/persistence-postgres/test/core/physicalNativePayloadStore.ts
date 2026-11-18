import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { Json } from "flarex-protocol/json";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { CoreNativeIdentitySchema } from "../../src/core/nativePolicyTypes";
import { CORE_PHYSICAL_TABLES } from "../../src/database/corePersistence/layout.generated";
import type { CoreSqlParameter } from "../../src/database/corePersistence/driver";
import type { CorePersistenceFixture } from "./fixture";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const Hex = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{2})*$/));
const Integer = Schema.String.check(Schema.isPattern(/^(0|-?[1-9][0-9]*)$/));
const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null,
  Schema.Struct({ $bytes: Hex }).annotate(strict), Schema.Struct({ $bigint: Integer }).annotate(strict)]);
const Rows = Schema.Array(Schema.Record(Schema.String, Scalar));
const CapturedStore = Schema.Struct({
  sourceCommit: Schema.Literal("8cc4e383b007b983153f0da7f60a27b59a832970"),
  instance: Schema.NonEmptyString, nativeIdentity: CoreNativeIdentitySchema,
  command: Schema.Literal("native10FrozenCreate"), requestKey: TransactionRequestKeyV1Schema,
  input: Schema.Literal("native10-frozen-title"), result: Json,
  storage: Schema.Struct({ documents: Rows, indexes: Rows, leases: Rows, read_only: Rows, persistence_globals: Rows }).annotate(strict),
}).annotate(strict);
export type CapturedNativePayloadStore = typeof CapturedStore.Type;
const decodeCapturedStore = Schema.decodeUnknownSync(CapturedStore);

/** Actual five-table rows captured from the unmodified Native10 commit. */
export async function readNative10CapturedStore(): Promise<CapturedNativePayloadStore> {
  return decodeCapturedStore(JSON.parse(await readFile(new URL("./fixtures/8cc4-native-payload-store.json", import.meta.url), "utf8")));
}

function scalar(value: typeof Scalar.Type): CoreSqlParameter {
  if (typeof value !== "object" || value === null) return value;
  return "$bigint" in value ? BigInt(value.$bigint)
    : Uint8Array.from(value.$bytes.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
}

/** Test-owned physical replay before any Core owner opens; no behavior is modeled. */
export async function seedNative10CapturedStore(
  physical: Pick<CorePersistenceFixture, "query" | "namespace">, store: CapturedNativePayloadStore,
): Promise<void> {
  for (const table of CORE_PHYSICAL_TABLES) for (const row of store.storage[table.name]) {
    const columns = table.columns.map(column => column.name);
    if (Object.keys(row).toSorted().join(",") !== columns.toSorted().join(","))
      throw new Error(`Captured Native10 ${table.name} columns differ from the frozen physical contract`);
    // The target was freshly provisioned only to supply its five empty tables.
    // Restore the actual captured platform markers too, including their original
    // maintenance timestamp. The subsequent serving load verifies the format.
    if (table.name === "persistence_globals" && row.instance_name === ""
      && (row.key === "storage_format" || row.key === "physical_layout")) {
      const bytes = row.json_value === undefined ? undefined : scalar(row.json_value);
      if (!(bytes instanceof Uint8Array)) throw new Error("Captured Native10 physical marker lost its byte value");
      await physical.query(`UPDATE "${physical.namespace}"."persistence_globals" SET json_value=$1 WHERE instance_name='' AND key=$2`,
        [bytes, row.key]);
      continue;
    }
    const values: CoreSqlParameter[] = [];
    for (const column of columns) {
      const value = row[column];
      if (value === undefined) throw new Error("Captured Native10 SQL column disappeared");
      values.push(scalar(value));
    }
    await physical.query(`INSERT INTO "${physical.namespace}"."${table.name}" (${columns.map(column => `"${column}"`).join(",")})
      VALUES (${columns.map((_column, index) => `$${index + 1}`).join(",")})`, values);
  }
}
