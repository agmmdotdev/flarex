import { readFile } from "node:fs/promises";
import { Result, Schema } from "effect";
import { CoreProgramIdentitySchema } from "../../src/core/api";
import { captureCoreObject } from "../../src/core/document";
import { CORE_PHYSICAL_TABLES } from "../../src/database/corePersistence/layout.generated";
import type { CoreSqlParameter } from "../../src/database/corePersistence/driver";
import type { CorePersistenceFixture } from "../core/fixture";

const Hex = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{2})*$/));
const IntegerTag = Schema.Struct({ $bigint: Schema.String.check(Schema.isPattern(/^(0|-?[1-9][0-9]*)$/)) });
const BytesTag = Schema.Struct({ $bytes: Hex });
const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null, BytesTag, IntegerTag]);
const Rows = Schema.Array(Schema.Record(Schema.String, Scalar));
const SourceModule = { path: Schema.String, roles: Schema.Int, sourceSha256: Schema.String, sourceByteLength: Schema.Int };
const Source = Schema.Struct({ sourceArtifact: Schema.Struct({ rootSha256: Schema.String, executionModulePath: Schema.String,
  schemaModulePath: Schema.Union([Schema.String, Schema.Null]), modules: Schema.Array(Schema.Struct(SourceModule)) }),
  modules: Schema.Array(Schema.Struct({ ...SourceModule, source: Schema.String })) });
const CapturedStore = Schema.Struct({
  sourceCommit: Schema.Literal("8b52e473dfd66d8b8d7655bf865abc147ba1b154"), instance: Schema.Literal("application"),
  programs: Schema.Array(Schema.Struct({ identity: CoreProgramIdentitySchema, metadata: Schema.Unknown })),
  source: Schema.optionalKey(Source), coldAnalysisLoads: Schema.optionalKey(Schema.Int),
  requestIdentity: Schema.Struct({ key: Schema.String, requestHash: Schema.String, program: CoreProgramIdentitySchema }),
  first: Schema.Struct({ timestamp: IntegerTag, head: Schema.Struct({ identity: CoreProgramIdentitySchema, id: BytesTag, ts: IntegerTag }),
    outcome: Schema.Struct({ kind: Schema.Literal("committed"), timestamp: IntegerTag, result: Schema.Unknown }) }),
  storage: Schema.Struct({ documents: Rows, indexes: Rows, leases: Rows, read_only: Rows, persistence_globals: Rows }),
});
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
function scalar(value: typeof Scalar.Type): CoreSqlParameter {
  if (typeof value !== "object" || value === null) return value;
  return "$bigint" in value ? BigInt(value.$bigint) : bytes(value.$bytes);
}

export async function readPre09CapturedProgramStore(filename: "pre09-positive-record-store.json" | "pre09-actual-record-worker-store.json" = "pre09-positive-record-store.json") {
  const store = Schema.decodeUnknownSync(CapturedStore)(JSON.parse(await readFile(
    new URL(`./fixtures/${filename}`, import.meta.url), "utf8")));
  const programs = store.programs.map(program => ({ ...program, metadata: Result.getOrThrow(captureCoreObject(program.metadata, true)).value }));
  return { ...store, programs,
    head: { ...store.first.head, id: bytes(store.first.head.id.$bytes), ts: BigInt(store.first.head.ts.$bigint) },
    outcome: { ...store.first.outcome, timestamp: BigInt(store.first.outcome.timestamp.$bigint) },
  };
}

/** Replay captured physical rows. No schema, head, claim or outcome algorithm is reproduced here. */
export async function seedPre09CapturedProgramStore(fixture: CorePersistenceFixture,
  store: Awaited<ReturnType<typeof readPre09CapturedProgramStore>>) {
  for (const table of CORE_PHYSICAL_TABLES) for (const row of store.storage[table.name]) {
    const columns = table.columns.map(column => column.name);
    if (Object.keys(row).toSorted().join(",") !== columns.toSorted().join(",")) throw new Error("Frozen pre09 columns changed.");
    // Fresh installation already wrote these same platform-owned format/baseline records.
    if (table.name === "persistence_globals" && row.instance_name === "") continue;
    const values = columns.map(column => {
      const value = row[column];
      if (value === undefined) throw new Error("Frozen pre09 column disappeared.");
      return scalar(value);
    });
    await fixture.query(`INSERT INTO "${fixture.namespace}"."${table.name}" (${columns.map(column => `"${column}"`).join(",")})
      VALUES (${columns.map((_column, index) => `$${index + 1}`).join(",")})`, values);
  }
}
