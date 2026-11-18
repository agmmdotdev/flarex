/** Standalone ordinary-Postgres representation experiment; no application install or production claims. */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
  decodeCanonicalAppDocumentEvidenceV1,
  verifyAppDocumentEvidenceV1,
} from "flarex-protocol/app-document";
import {
  appRowIdHexV1FromBytes,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { type CanonicalFlarexValueV1 } from "flarex-protocol/value";

type Variant = "current" | "bytes" | "json";
const variants: readonly Variant[] = ["current", "bytes", "json"];
const specs = [
  { name: "small", bytes: 768, varied: false },
  { name: "nested4k", bytes: 4096, varied: true },
  { name: "varied32k", bytes: 32768, varied: true },
  { name: "repeated256k", bytes: 262144, varied: false },
  { name: "varied256k", bytes: 262144, varied: true },
  { name: "varied900k", bytes: 900000, varied: true },
] as const;
const tableId = decodeCatalogTableId(1);
const scopeUuid = randomUUID();
const epochUuid = randomUUID();
const namespace = `row_repr_${randomUUID().replaceAll("-", "")}`;
const q = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const relation = (variant: Variant, group: string) =>
  `${q(namespace)}.${q(`${variant}_${group}`)}`;
const payloadColumns = (variant: Variant) =>
  variant === "current"
    ? ["value_json", "value_bytes"]
    : [variant === "bytes" ? "value_bytes" : "value_json"];
interface Stored {
  table_id: number;
  row_id: Buffer;
  creation_time: number;
  value_codec_version: number;
  value_sha256: Buffer | null;
  value_json?: unknown;
  value_bytes?: Buffer;
  is_tombstone: boolean;
}
interface Item {
  rowId: Buffer;
  creationTime: number;
  fields: Record<string, unknown>;
  versions: CanonicalFlarexValueV1[];
  tombstone: boolean;
}
interface Sample {
  variant: Variant;
  group: string;
  shape: string;
  rows: number;
  fetchMs: number;
  codecMs: number;
}
function variedText(length: number, seed: number): string {
  const bytes = Buffer.alloc(length);
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = 32 + ((state >>> 0) % 95);
  }
  return bytes.toString("ascii");
}
async function verify(
  variant: Variant,
  row: Stored,
): Promise<CanonicalFlarexValueV1 | null> {
  if (row.is_tombstone) {
    if (
      row.value_sha256 !== null ||
      (variant !== "bytes" && row.value_json !== null) ||
      (variant !== "json" && row.value_bytes !== null)
    )
      throw new Error("Tombstone retained a body.");
    return null;
  }
  const identity = {
    tableId: decodeCatalogTableId(row.table_id),
    rowId: appRowIdHexV1FromBytes(row.row_id),
    creationTime: decodeAppCreationTimeV1(row.creation_time),
  };
  if (variant !== "bytes")
    return verifyAppDocumentEvidenceV1({
      ...identity,
      codecVersion: row.value_codec_version,
      valueJson: row.value_json,
      sha256: row.value_sha256,
      ...(variant === "current" ? { canonicalBytes: row.value_bytes } : {}),
    });
  return decodeCanonicalAppDocumentEvidenceV1({
    ...identity,
    codecVersion: row.value_codec_version,
    canonicalBytes: row.value_bytes,
    sha256: row.value_sha256,
  });
}
const connectionString = process.env.FLAREX_POSTGRES_DATABASE_URL;
if (!connectionString)
  throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
const pool = new Pool({
  connectionString,
  max: 1,
  application_name: "flarex-row-representation-benchmark",
});
const client = await pool.connect();
const samples: Sample[] = [];
const footprint: unknown[] = [];
const plans: unknown[] = [];
let created = false;
try {
  const environment = (
    await client.query(`select current_user, r.rolsuper, r.rolbypassrls, current_setting('server_version') as server_version,
    current_setting('default_toast_compression') as compression, current_setting('synchronous_commit') as synchronous_commit from pg_roles r where r.rolname=current_user`)
  ).rows[0];
  if (!environment || environment.rolsuper || environment.rolbypassrls)
    throw new Error("An ordinary non-BYPASSRLS role is required.");
  await client.query(`create schema ${q(namespace)}`);
  created = true;
  let ordinal = 0;
  for (const spec of specs) {
    const items: Item[] = [];
    // Equal bounded body cohort per group; three immutable versions and a current FK.
    const count = Math.max(
      8,
      Math.min(1024, Math.floor((8 * 1024 * 1024) / spec.bytes)),
    );
    for (let i = 0; i < count; i += 1) {
      ordinal += 1;
      const rowId = decodeAppRowIdHexV1(ordinal.toString(16).padStart(32, "0"));
      const creationTime = decodeAppCreationTimeV1(1_800_000_000_000 + ordinal);
      const text = spec.varied
        ? variedText(spec.bytes, ordinal)
        : "abcdefgh".repeat(Math.ceil(spec.bytes / 8)).slice(0, spec.bytes);
      const fields = {
        name: `Document ${ordinal}`,
        nested: { tags: ["one", "two"], text },
        count: BigInt(ordinal),
        attachment: new Uint8Array([0, 127, 255]).buffer,
        special: [-0, NaN, Infinity, -Infinity],
        unicode: "雪\u0000🌏",
      };
      const versions = [];
      for (let revision = 1; revision <= 3; revision += 1)
        versions.push(
          await canonicalizeAppDocumentV1({
            tableId,
            rowId,
            creationTime,
            fields: { ...fields, revision },
          }),
        );
      items.push({
        rowId: Buffer.from(rowId, "hex"),
        creationTime,
        fields,
        versions,
        tombstone: i % 10 === 9,
      });
    }
    for (const variant of variants) {
      const table = relation(variant, spec.name);
      await client.query(`create table ${table} (scope_uuid uuid not null, table_id int not null, row_id bytea not null, commit_seq bigint not null,
        prev_commit_seq bigint, write_epoch_uuid uuid not null, schema_version_id text not null, creation_time float8 not null,
        value_codec_version int not null, is_tombstone boolean not null,
        ${variant !== "bytes" ? "value_json jsonb," : ""} ${variant !== "json" ? "value_bytes bytea," : ""} value_sha256 bytea,
        primary key(scope_uuid,table_id,row_id,commit_seq))`);
      const currentTable = `${q(namespace)}.${q(`${variant}_${spec.name}_current`)}`;
      await client.query(`create table ${currentTable} (scope_uuid uuid not null, table_id int not null, row_id bytea not null, commit_seq bigint not null,
        primary key(scope_uuid,table_id,row_id), foreign key(scope_uuid,table_id,row_id,commit_seq) references ${table}(scope_uuid,table_id,row_id,commit_seq))`);
      const columns = [
        "scope_uuid",
        "table_id",
        "row_id",
        "commit_seq",
        "prev_commit_seq",
        "write_epoch_uuid",
        "schema_version_id",
        "creation_time",
        "value_codec_version",
        "is_tombstone",
        ...payloadColumns(variant),
        "value_sha256",
      ];
      const pending: unknown[][] = [];
      for (const item of items)
        for (let revision = 1; revision <= 3; revision += 1) {
          const document = item.versions[revision - 1];
          if (!document) throw new Error("Missing version.");
          const tombstone = revision === 3 && item.tombstone;
          const row: unknown[] = [
            scopeUuid,
            tableId,
            item.rowId,
            String(revision),
            revision === 1 ? null : String(revision - 1),
            epochUuid,
            "schema_row_repr",
            item.creationTime,
            document.codecVersion,
            tombstone,
          ];
          if (variant !== "bytes")
            row.push(tombstone ? null : JSON.stringify(document.valueJson));
          if (variant !== "json")
            row.push(tombstone ? null : Buffer.from(document.canonicalBytes));
          row.push(tombstone ? null : Buffer.from(document.sha256));
          pending.push(row);
        }
      for (let start = 0; start < pending.length; start += 128) {
        const batch = pending.slice(start, start + 128);
        await client.query(
          `insert into ${table} (${columns.join(",")}) values ${batch.map((row, i) => `(${row.map((_, j) => `$${i * columns.length + j + 1}`).join(",")})`).join(",")}`,
          batch.flat(),
        );
      }
      await client.query(
        `insert into ${q(namespace)}.${q(`${variant}_${spec.name}_current`)} select scope_uuid,table_id,row_id,max(commit_seq) from ${table} group by scope_uuid,table_id,row_id`,
      );
      await client.query(`vacuum analyze ${table}`);
      const size = (
        await client.query(
          `select pg_relation_size(c.oid)::float8 as heap_bytes, pg_table_size(c.oid)::float8 as table_including_toast_bytes,
        pg_indexes_size(c.oid)::float8 as index_bytes, pg_total_relation_size(c.oid)::float8 as total_bytes,
        pg_total_relation_size(c.reltoastrelid)::float8 as toast_including_index_bytes from pg_class c where c.oid=$1::regclass`,
          [table],
        )
      ).rows[0];
      footprint.push({
        variant,
        group: spec.name,
        documents: count,
        revisions: pending.length,
        ...size,
      });
    }
    for (let round = 0; round < 11; round += 1)
      for (const shape of ["point", "batch", "current", "append"] as const) {
        const selected = items.slice(
          0,
          shape === "batch"
            ? Math.min(
                64,
                count,
                Math.max(1, Math.floor((2 * 1024 * 1024) / spec.bytes)),
              )
            : 1,
        );
        for (let offset = 0; offset < variants.length; offset += 1) {
          const variant = variants[(round + offset) % variants.length];
          if (!variant) throw new Error("Missing variant.");
          const table = relation(variant, spec.name);
          const current = `${q(namespace)}.${q(`${variant}_${spec.name}_current`)}`;
          const fields = `table_id,row_id,creation_time,value_codec_version,is_tombstone,${payloadColumns(variant).join(",")},value_sha256`;
          const item = selected[0];
          if (!item) throw new Error("Missing row.");
          if (shape === "append") {
            const start = performance.now();
            const document = await canonicalizeAppDocumentV1({
              tableId,
              rowId: appRowIdHexV1FromBytes(item.rowId),
              creationTime: decodeAppCreationTimeV1(item.creationTime),
              fields: { ...item.fields, revision: 4 },
            });
            const encoded = performance.now();
            const columns = [
              "scope_uuid",
              "table_id",
              "row_id",
              "commit_seq",
              "prev_commit_seq",
              "write_epoch_uuid",
              "schema_version_id",
              "creation_time",
              "value_codec_version",
              "is_tombstone",
              ...payloadColumns(variant),
              "value_sha256",
            ];
            const values: unknown[] = [
              scopeUuid,
              tableId,
              item.rowId,
              "4",
              "3",
              epochUuid,
              "schema_row_repr",
              item.creationTime,
              document.codecVersion,
              false,
            ];
            // Driver JSON serialization is timed equally with byte parameter construction.
            if (variant !== "bytes")
              values.push(JSON.stringify(document.valueJson));
            if (variant !== "json")
              values.push(Buffer.from(document.canonicalBytes));
            values.push(Buffer.from(document.sha256));
            await client.query("begin");
            try {
              await client.query(
                `insert into ${table} (${columns.join(",")}) values (${values.map((_, i) => `$${i + 1}`).join(",")})`,
                values,
              );
              const changed = await client.query(
                `update ${current} set commit_seq=4 where scope_uuid=$1 and table_id=$2 and row_id=$3 and commit_seq=3`,
                [scopeUuid, tableId, item.rowId],
              );
              if (changed.rowCount !== 1)
                throw new Error("Current CAS failed.");
            } finally {
              await client.query("rollback");
            }
            if (round >= 2)
              samples.push({
                variant,
                group: spec.name,
                shape,
                rows: 1,
                fetchMs: performance.now() - encoded,
                codecMs: encoded - start,
              });
            continue;
          }
          let statement = `select distinct on(row_id) ${fields} from ${table} where scope_uuid=$1 and table_id=$2 and row_id=any($3::bytea[]) and commit_seq<=3 order by row_id,commit_seq desc`;
          const params: unknown[] = [
            scopeUuid,
            tableId,
            selected.map((row) => row.rowId),
          ];
          const start = performance.now();
          if (shape === "current") {
            const pointer = await client.query(
              `select commit_seq from ${current} where scope_uuid=$1 and table_id=$2 and row_id=$3`,
              [scopeUuid, tableId, item.rowId],
            );
            if (pointer.rows[0]?.commit_seq !== "3")
              throw new Error("Current pointer missing.");
            statement = `select ${fields} from ${table} where scope_uuid=$1 and table_id=$2 and row_id=$3 and commit_seq=3`;
            params[2] = item.rowId;
          }
          const result = await client.query<Stored>(statement, params);
          const fetched = performance.now();
          for (const row of result.rows) await verify(variant, row);
          const decoded = performance.now();
          if (result.rows.length !== selected.length)
            throw new Error("Read lost rows.");
          if (round >= 2)
            samples.push({
              variant,
              group: spec.name,
              shape,
              rows: result.rows.length,
              fetchMs: fetched - start,
              codecMs: decoded - fetched,
            });
          if (round === 2)
            plans.push({
              variant,
              group: spec.name,
              shape,
              plan: (
                await client.query(
                  `explain (analyze,buffers,format json) ${statement}`,
                  params,
                )
              ).rows,
            });
        }
      }
    console.error(
      `Measured ${spec.name}: ${count} documents, three revisions, ${items[0]?.versions[0]?.canonicalBytes.length} canonical bytes per initial live row.`,
    );
  }
  const percentile = (values: number[], p: number) =>
    values.toSorted((a, b) => a - b)[
      Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
    ];
  const summary = [];
  for (const spec of specs)
    for (const shape of ["point", "batch", "current", "append"])
      for (const variant of variants) {
        const rows = samples.filter(
          (row) =>
            row.group === spec.name &&
            row.shape === shape &&
            row.variant === variant,
        );
        summary.push({
          variant,
          group: spec.name,
          shape,
          rows: rows[0]?.rows,
          samples: rows.length,
          fetchMedianMs: percentile(
            rows.map((row) => row.fetchMs),
            0.5,
          ),
          codecMedianMs: percentile(
            rows.map((row) => row.codecMs),
            0.5,
          ),
          totalMedianMs: percentile(
            rows.map((row) => row.fetchMs + row.codecMs),
            0.5,
          ),
          totalP95Ms: percentile(
            rows.map((row) => row.fetchMs + row.codecMs),
            0.95,
          ),
        });
      }
  console.log(
    JSON.stringify(
      {
        environment,
        node: process.version,
        method:
          "warm, rotating variants, two warmups and nine measured rounds; append includes canonicalization and rollback, no authority queries; TOAST included in total",
        footprint,
        summary,
        plans,
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  if (created) await client.query(`drop schema ${q(namespace)} cascade`);
  client.release();
  await pool.end();
}
