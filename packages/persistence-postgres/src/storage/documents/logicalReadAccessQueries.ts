import { and, asc, desc, eq, getTableName, sql, type SQL } from "drizzle-orm";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { encodeCanonicalJson, type JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { LogicalWhere } from "./logicalDocuments/query";
import type { LogicalRelationalReadDemand } from "./logicalDocuments/relationalQuery";
import { fxControlLogicalReadAccess } from "../../database/schema";

export const textArray = (values: readonly string[]) => sql`array[${sql.join(values.map(value => sql`${value}`), sql`, `)}]::text[]`;
interface SelectionInput {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly sourceKey: string;
  readonly localName: string;
}

export const logicalReadPredicateKey = (predicate: JsonObject | null) =>
  encodeCanonicalJson(predicate, () => { throw new Error("Owned logical read predicate is not JSON"); });
export const logicalReadFacetKey = (fields: readonly string[], predicate: JsonObject | null) =>
  JSON.stringify([fields, logicalReadPredicateKey(predicate), null]);
const identity = (input: SelectionInput, alias: string) => sql`${sql.identifier(alias)}.deployment_id = ${input.deploymentId}
  and ${sql.identifier(alias)}.schema_version_id = ${input.schemaVersionId}
  and ${sql.identifier(alias)}.source_key = ${input.sourceKey}
  and ${sql.identifier(alias)}.local_name = ${input.localName}`;

/** Each next edge is a full primary-key equality probe. Sibling fields that
 * were not supplied by the query are never read or enumerated. */
const paths = (input: SelectionInput, kind: "index" | "unique", available: readonly string[]) => sql`
  with recursive demand(field, position) as (
    select field, position from unnest(${textArray([...new Set(available)].toSorted())}) with ordinality as requested(field, position)
  ), paths(fields, position) as (
    select array[]::text[], 0::bigint
    union all
    select parent.fields || requested.field, requested.position
    from paths parent join demand requested on requested.position > parent.position
    cross join lateral (
      select 1 from ${fxControlLogicalReadAccess} node
      where ${identity(input, "node")} and node.selector_kind = ${`trie:${kind}`}
        and node.selector_key = array_to_json(parent.fields || requested.field)::text
      limit 1
    ) admitted
  )`;

/** The lateral LIMIT is an exact-key cardinality boundary. It prevents
 * replacing demand probes with a whole-terminal hash scan. */
const selectedRows = (tx: FlarexMetadataTransaction, input: SelectionInput, keys: SQL) => tx
  // Raw lateral FROM has no Drizzle table-name nullability map. SQL fields
  // borrow each existing column's driver decoder and exact data type rather
  // than pretending the source is a second schema table.
  .select({
    deploymentId: sql`${fxControlLogicalReadAccess.deploymentId}`.mapWith(fxControlLogicalReadAccess.deploymentId),
    schemaVersionId: sql`${fxControlLogicalReadAccess.schemaVersionId}`.mapWith(fxControlLogicalReadAccess.schemaVersionId),
    sourceKey: sql`${fxControlLogicalReadAccess.sourceKey}`.mapWith(fxControlLogicalReadAccess.sourceKey),
    localName: sql`${fxControlLogicalReadAccess.localName}`.mapWith(fxControlLogicalReadAccess.localName),
    selectorKind: sql`${fxControlLogicalReadAccess.selectorKind}`.mapWith(fxControlLogicalReadAccess.selectorKind),
    selectorKey: sql`${fxControlLogicalReadAccess.selectorKey}`.mapWith(fxControlLogicalReadAccess.selectorKey),
    leadingField: sql`${fxControlLogicalReadAccess.leadingField}`.mapWith(fxControlLogicalReadAccess.leadingField),
    prefixLength: sql`${fxControlLogicalReadAccess.prefixLength}`.mapWith(fxControlLogicalReadAccess.prefixLength),
    ordinal: sql`${fxControlLogicalReadAccess.ordinal}`.mapWith(fxControlLogicalReadAccess.ordinal),
    projectionJson: sql`${fxControlLogicalReadAccess.projectionJson}`.mapWith(fxControlLogicalReadAccess.projectionJson),
    projectionSha256: sql`${fxControlLogicalReadAccess.projectionSha256}`.mapWith(fxControlLogicalReadAccess.projectionSha256),
  }).from(sql`(${keys}) requested
    cross join lateral (
      select * from ${fxControlLogicalReadAccess} terminal
      where ${identity(input, "terminal")} and terminal.selector_kind = requested.kind
        and terminal.selector_key = requested.key limit 1
    ) ${sql.identifier(getTableName(fxControlLogicalReadAccess))}`);

const predicatesFor = (where: LogicalWhere) => {
  const nulls = Object.keys(where).filter(field => where[field] === null), predicates: (JsonObject | null)[] = [null];
  for (const field of nulls) predicates.push({ kind: "fieldIsNull", field });
  for (const nullField of nulls) for (const textField of Object.keys(where)) {
    const value = where[textField];
    if (typeof value === "string") predicates.push({ kind: "fieldIsNullAndTextEquals", nullField, textField, value });
    if (typeof value === "boolean") predicates.push({ kind: "fieldIsNullAndBooleanEquals", nullField, booleanField: textField, value });
  }
  return predicates.map(logicalReadPredicateKey);
};

/** Exact native/page keys share the same protected catalog and SQL owner. */
export function logicalExactReadAccessQuery(tx: FlarexMetadataTransaction, input: SelectionInput,
  requested: readonly Readonly<{ kind: string; key: string }>[]) {
  const kinds = requested.map(row => row.kind), keys = requested.map(row => row.key);
  return selectedRows(tx, input, sql`select kind, key from unnest(${textArray(kinds)}, ${textArray(keys)}) as keys(kind, key)`)
    .orderBy(asc(fxControlLogicalReadAccess.ordinal));
}

export function logicalNativeReadAccessQuery(tx: FlarexMetadataTransaction, input: SelectionInput, demand: LogicalRelationalReadDemand) {
  const predicates = [null, ...demand.nulls.map(field => ({ kind: "fieldIsNull", field }))];
  const requests: { kind: string; key: string }[] = [];
  for (const field of demand.fields) for (const kind of ["native:btree", "native:uniqueBtree", "native:textEquality", "native:jsonContainment",
    "native:uniqueSingle", "nativeKey:single", "nativeKey:composite", "nativeReverse"]) for (const predicate of predicates)
    requests.push({ kind, key: logicalReadFacetKey([field], predicate) });
  for (const columns of demand.points) for (const predicate of predicates)
    requests.push({ kind: "nativePoint", key: logicalReadFacetKey(columns, predicate) });
  return logicalExactReadAccessQuery(tx, input, requests);
}

export function logicalPageReadAccessQuery(tx: FlarexMetadataTransaction, input: SelectionInput, fields: readonly string[],
  equality: Readonly<{ column: string; value: string | boolean }> | undefined, requiredNulls: readonly string[]) {
  const predicates: (JsonObject | null)[] = [null];
  for (const field of new Set(requiredNulls)) {
    predicates.push({ kind: "fieldIsNull", field });
    if (equality !== undefined && typeof equality.value === "string")
      predicates.push({ kind: "fieldIsNullAndTextEquals", nullField: field, textField: equality.column, value: equality.value });
    if (equality !== undefined && typeof equality.value === "boolean")
      predicates.push({ kind: "fieldIsNullAndBooleanEquals", nullField: field, booleanField: equality.column, value: equality.value });
  }
  return logicalExactReadAccessQuery(tx, input,
    predicates.map(predicate => ({ kind: "page", key: logicalReadFacetKey(fields, predicate) }))).limit(1);
}

/** Text selection retains the original first declaration containing every
 * pattern field, including fields after its first column. JSON uses its exact
 * single column and visibility predicate. The partial GIN index intersects
 * qualified catalog identity and all requested fields before row decoding. */
export function logicalSearchReadAccessQuery(tx: FlarexMetadataTransaction, input: SelectionInput,
  columns: readonly string[], nulls: readonly string[], kind: "text" | "jsonContainment") {
  return tx.select().from(fxControlLogicalReadAccess).where(and(
    eq(fxControlLogicalReadAccess.deploymentId, input.deploymentId), eq(fxControlLogicalReadAccess.schemaVersionId, input.schemaVersionId),
    eq(fxControlLogicalReadAccess.sourceKey, input.sourceKey), eq(fxControlLogicalReadAccess.localName, input.localName),
    eq(fxControlLogicalReadAccess.selectorKind, "search"), sql`${fxControlLogicalReadAccess.projectionJson}->>'kind' = ${kind}`,
    sql`${fxControlLogicalReadAccess.projectionJson}->'fields' @> ${JSON.stringify(columns)}::jsonb`,
    kind === "text" ? undefined : sql`(${fxControlLogicalReadAccess.projectionJson}->'nullPredicateField' = 'null'::jsonb
      or ${fxControlLogicalReadAccess.projectionJson}->>'nullPredicateField' = any(${textArray(nulls)}))`,
  )).orderBy(asc(fxControlLogicalReadAccess.ordinal)).limit(1);
}

/** Longest eligible prefix, then the original definition ordinal. The existing
 * row evaluator still compiles the selected physical bounds. */
export function logicalIndexReadAccessQuery(tx: FlarexMetadataTransaction, input: SelectionInput, where: LogicalWhere,
  exactPoint?: Readonly<{ columns: readonly string[]; nullColumn?: string }>) {
  const available = Object.keys(where), ranges = available.filter(field => where[field] !== null && typeof where[field] === "object");
  const eligiblePredicates = exactPoint === undefined ? predicatesFor(where) : [logicalReadPredicateKey(exactPoint.nullColumn === undefined
    ? null : { kind: "fieldIsNull", field: exactPoint.nullColumn })];
  const facet = (range: SQL) => exactPoint === undefined
    ? sql`array_to_json(array[array_to_json(fields)::text, predicate, ${range}])::text`
    : sql`array_to_json(array[array_to_json(fields)::text, predicate, ${JSON.stringify(exactPoint.columns)}, ${range}])::text`;
  const keys = sql`${paths(input, "index", available)}
    select ${exactPoint === undefined ? "index" : "indexPoint"}::text as kind, ${facet(sql`'eq'`)} as key
    from paths cross join unnest(${textArray(eligiblePredicates)}) predicates(predicate)
    where cardinality(fields) > 0 and not fields && ${textArray(ranges)}
    union all
    select ${exactPoint === undefined ? "indexRange" : "indexPoint"}::text, ${facet(sql`range_field`)}
    from paths cross join unnest(${textArray(eligiblePredicates)}) predicates(predicate)
      cross join unnest(${textArray(ranges)}) range_fields(range_field)
    where range_field = any(fields)
      and not exists (select 1 from unnest(fields) field where field = any(${textArray(ranges)}) and field <> range_field)`;
  return selectedRows(tx, input, keys)
    .orderBy(desc(fxControlLogicalReadAccess.prefixLength), asc(fxControlLogicalReadAccess.ordinal)).limit(1);
}

/** First eligible complete unique key, including its nulls-distinct policy. */
export function logicalUniqueReadAccessQuery(tx: FlarexMetadataTransaction, input: SelectionInput, where: LogicalWhere) {
  const available = Object.keys(where).filter(field => where[field] === null || typeof where[field] !== "object");
  const nulls = available.filter(field => where[field] === null);
  const keys = sql`${paths(input, "unique", available)}
    select 'unique'::text as kind, array_to_json(array[array_to_json(fields)::text, 'all'])::text as key
      from paths where cardinality(fields) > 0
    union all
    select 'unique'::text, array_to_json(array[array_to_json(fields)::text, 'nonNull'])::text
      from paths where cardinality(fields) > 0 and not fields && ${textArray(nulls)}`;
  return selectedRows(tx, input, keys).orderBy(asc(fxControlLogicalReadAccess.ordinal)).limit(1);
}
