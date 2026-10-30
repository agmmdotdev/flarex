import { Effect, Option, Result, Schema } from "effect";
import { bytesEqual } from "@flarex/utils/bytes";
import type { CoreSqlConnection } from "./driver";
import { coreTableName, invalidPhysicalLayout } from "./physicalLayout";
import { CORE_PHYSICAL_BASELINE_SQL_SHA256, CORE_PHYSICAL_SCHEMA_SHA256 } from "./layout.generated";

export const CORE_PHYSICAL_METADATA_KEY = "physical_layout";
const utf8 = new TextEncoder();
const format = utf8.encode("flarex-core-pg/db914cf06/1");
const Nanoseconds = Schema.String.check(Schema.makeFilter(value => /^(0|[1-9][0-9]{0,18})$/.test(value)
  && BigInt(value) <= 0x7fff_ffff_ffff_ffffn ? undefined : "Expected canonical nonnegative signed int64 nanoseconds"));
export const CorePhysicalBaselineMetadataSchema = Schema.Struct({ version: Schema.Literal(1),
  migration: Schema.Literal("drizzle-baseline"), schemaSha256: Schema.Literal(CORE_PHYSICAL_SCHEMA_SHA256),
  sqlSha256: Schema.Literal(CORE_PHYSICAL_BASELINE_SQL_SHA256), disposition: Schema.Literals(["executed", "adopted"]),
  appliedAtNanos: Nanoseconds });
export type CorePhysicalBaselineMetadata = typeof CorePhysicalBaselineMetadataSchema.Type;
const Rows = Schema.Array(Schema.Struct({ key: Schema.String, json_value: Schema.Uint8Array }));
const decodeMetadata = Schema.decodeUnknownResult(CorePhysicalBaselineMetadataSchema);

/** Reserved empty-instance rows belong to platform maintenance, never a logical persistence instance. */
export const readCorePhysicalBaseline = Effect.fn("CorePersistence.readPhysicalBaseline")(function* (
  connection: CoreSqlConnection, namespace: string, lock = false,
) {
  const rows = yield* Schema.decodeUnknownEffect(Rows)(yield* connection.query(`SELECT key,json_value
    FROM ${coreTableName(namespace, "persistence_globals")} WHERE instance_name='' ORDER BY key${lock ? " FOR UPDATE" : ""}`))
    .pipe(Effect.mapError(invalidPhysicalLayout));
  if (rows.some(row => row.key !== "storage_format" && row.key !== CORE_PHYSICAL_METADATA_KEY))
    return yield* invalidPhysicalLayout("Unsupported reserved physical metadata");
  const markers = rows.filter(row => row.key === "storage_format");
  if (markers.length !== 1 || markers[0] === undefined || !bytesEqual(markers[0].json_value, format))
    return yield* invalidPhysicalLayout("Unsupported physical storage format");
  const baselines = rows.filter(row => row.key === CORE_PHYSICAL_METADATA_KEY);
  if (baselines.length > 1) return yield* invalidPhysicalLayout("Duplicate physical migration metadata");
  const baseline = baselines[0];
  if (baseline === undefined) return Option.none<CorePhysicalBaselineMetadata>();
  if (baseline.json_value.byteLength > 4096) return yield* invalidPhysicalLayout("Oversized physical migration metadata");
  // Both native operations are the narrow stored-text parser boundary: malformed
  // UTF-8/JSON is an unsupported target, with the original foreign failure kept.
  const parsed = yield* Effect.try({ try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(baseline.json_value)),
    catch: invalidPhysicalLayout });
  const metadata = yield* Effect.fromResult(decodeMetadata(parsed).pipe(Result.mapError(invalidPhysicalLayout)));
  return Option.some(Object.freeze(metadata));
});

export const writeCorePhysicalFormat = Effect.fn("CorePersistence.writePhysicalFormat")(function* (
  connection: CoreSqlConnection, namespace: string,
) {
  yield* connection.query(`INSERT INTO ${coreTableName(namespace, "persistence_globals")}
    (instance_name,key,json_value) VALUES ('','storage_format',$1)`, [format.slice()]);
});

export const writeCorePhysicalBaseline = Effect.fn("CorePersistence.writePhysicalBaseline")(function* (
  connection: CoreSqlConnection, namespace: string, disposition: "executed" | "adopted",
) {
  const rows = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ applied_at: Nanoseconds })))(
    yield* connection.query("SELECT floor(extract(epoch FROM transaction_timestamp())*1000000000)::bigint::text AS applied_at"),
  ).pipe(Effect.mapError(invalidPhysicalLayout));
  const appliedAtNanos = rows[0]?.applied_at;
  if (rows.length !== 1 || appliedAtNanos === undefined) return yield* invalidPhysicalLayout("Missing physical maintenance timestamp");
  const metadata: CorePhysicalBaselineMetadata = { version: 1, migration: "drizzle-baseline",
    schemaSha256: CORE_PHYSICAL_SCHEMA_SHA256, sqlSha256: CORE_PHYSICAL_BASELINE_SQL_SHA256, disposition, appliedAtNanos };
  yield* connection.query(`INSERT INTO ${coreTableName(namespace, "persistence_globals")}
    (instance_name,key,json_value) VALUES ('',$1,$2)`, [CORE_PHYSICAL_METADATA_KEY, utf8.encode(JSON.stringify(metadata))]);
  return Object.freeze(metadata);
});

/**
 * Maintenance holds the lease table before reserved globals, in stable row order.
 * EXCLUSIVE excludes lease creation/renewal and the writer's final FOR SHARE.
 * It does not lock application documents/globals: an older materializing writer
 * can drain, then observe its lost lease instead of creating a lock-order cycle.
 */
export const lockCorePhysicalMaintenance = Effect.fn("CorePersistence.lockPhysicalMaintenance")(function* (
  connection: CoreSqlConnection, namespace: string,
) {
  yield* connection.query(`LOCK TABLE ${coreTableName(namespace, "leases")} IN EXCLUSIVE MODE`);
  const rows = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ instance_name: Schema.NonEmptyString, token: Nanoseconds })))(
    yield* connection.query(`SELECT instance_name,ts::text AS token FROM ${coreTableName(namespace, "leases")}
      ORDER BY instance_name FOR UPDATE`),
  ).pipe(Effect.mapError(invalidPhysicalLayout));
  return rows;
});

/** Only a newly adopted baseline advances tokens; verified replay never revokes a current owner. */
export const fenceCorePhysicalLeases = Effect.fn("CorePersistence.fencePhysicalLeases")(function* (
  connection: CoreSqlConnection, namespace: string, rows: readonly { readonly instance_name: string; readonly token: string }[],
) {
  for (const row of rows) {
    const token = BigInt(row.token);
    if (token === 0x7fff_ffff_ffff_ffffn) return yield* invalidPhysicalLayout("Lease token cannot be fenced without signed int64 overflow");
    yield* connection.query(`UPDATE ${coreTableName(namespace, "leases")} SET ts=$2 WHERE instance_name=$1 AND ts=$3`,
      [row.instance_name, token + 1n, token]);
  }
});
