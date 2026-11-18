import { readFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { CoreProgramIdentitySchema } from "../../src/core/api";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";
import type { CoreSqlDriver, CoreSqlParameter } from "../../src/database/corePersistence/driver";
import { CORE_PHYSICAL_TABLES } from "../../src/database/corePersistence/layout.generated";

const Hex = Schema.String.check(Schema.makeFilter(value => /^(?:[0-9a-f]{2})*$/.test(value) ? undefined : "Expected captured lowercase byte hex"));
const Integer = Schema.String.check(Schema.makeFilter(value => /^(0|-?[1-9][0-9]*)$/.test(value) ? undefined : "Expected captured integer text"));
const IntegerTag = Schema.Struct({ $bigint: Integer });
const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null,
  Schema.Struct({ $bytes: Hex }), IntegerTag]);
const Rows = Schema.Array(Schema.Record(Schema.String, Scalar));
const CapturedStore = Schema.Struct({ sourceCommit: Schema.Literal("c5541e7106550679c209d9f6481791b99d9e9e9f"),
  documentId: DeveloperDocumentIdSchema, instance: Schema.NonEmptyString, first: IntegerTag, latest: IntegerTag,
  requestIdentity: Schema.Struct({ key: Schema.String, requestHash: Schema.String, program: CoreProgramIdentitySchema }),
  storage: Schema.Struct({ documents: Rows, indexes: Rows, leases: Rows, read_only: Rows, persistence_globals: Rows }) });

export async function readC554CapturedStore() {
  const text = await readFile(new URL("./fixtures/c554-populated-store.json", import.meta.url), "utf8");
  return Schema.decodeUnknownSync(CapturedStore)(JSON.parse(text));
}

function scalar(value: typeof Scalar.Type): CoreSqlParameter {
  if (typeof value !== "object" || value === null) return value;
  return "$bigint" in value ? BigInt(value.$bigint)
    : Uint8Array.from(value.$bytes.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
}

/** Replay the actual captured SQL rows; the fixture never models engine behavior. */
export const seedC554CapturedStore = Effect.fn("PhysicalFixture.seedCapturedC554")(function* (
  driver: CoreSqlDriver, namespace: string, store: typeof CapturedStore.Type,
) {
  yield* driver.transaction(connection => Effect.gen(function* () {
    for (const table of CORE_PHYSICAL_TABLES) for (const row of store.storage[table.name]) {
      const columns = table.columns.map(column => column.name);
      if (Object.keys(row).toSorted().join(",") !== columns.toSorted().join(","))
        return yield* Effect.die(new Error(`Captured c554 ${table.name} columns do not match the frozen physical contract`));
      // The frozen c554 fixture already installed this identical format marker.
      if (table.name === "persistence_globals" && row.instance_name === "" && row.key === "storage_format") continue;
      const values: CoreSqlParameter[] = [];
      for (const column of columns) {
        const value = row[column];
        if (value === undefined) return yield* Effect.die(new Error("Captured SQL column disappeared"));
        values.push(scalar(value));
      }
      yield* connection.query(`INSERT INTO "${namespace}"."${table.name}" (${columns.map(column => `"${column}"`).join(",")})
        VALUES (${columns.map((_column, index) => `$${index + 1}`).join(",")})`, values);
    }
  }));
});
