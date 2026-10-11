import { getTableColumns, is, SQL, type BuildQueryConfig, type QueryWithTypings, type QueryTypingsValue } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { fxAppRowRevisions, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxAppSearchEntryCurrent, fxAppJsonEntryCurrent, fxSystemIndexBuildStates,
  fxSystemUniqueConstraintBuilds } from "../../database/schema";
import type { ApplicationMaterializationValues } from "./domainApplication";
import { makePgArray } from "drizzle-orm/pg-core/utils/array";
import { encodeBytesToLowercaseHex, isUint8Array } from "@flarex/utils/bytes";

type PublicationParameter = (value: unknown, type: string, column?: PgColumn) => string;
type MappedPublicationValue = Readonly<{ kind: "value"; value: unknown }> | Readonly<{ kind: "expression"; sql: string }>;
type PublicationMapping = (value: unknown, type: string, column?: PgColumn) => MappedPublicationValue;
type PublicationArray = (values: readonly MappedPublicationValue[], type: string) => string;

function tupleArray(values: readonly (readonly MappedPublicationValue[] | null)[], types: readonly string[],
  composite: string, array: PublicationArray): string {
  if (values.length === 0) return `array[]::${composite}[]`;
  const present = array(values.map(value => ({ kind: "value", value: value !== null })), "boolean");
  const columns = types.map((type, index) => array(values.map(value => value?.[index] ?? { kind: "value", value: null }), type));
  const names = types.map((_, index) => `c${index}`);
  return `array(select case when tuples.present then row(${names.map(name => `tuples.${name}`).join(", ")})::${composite}
    else null::${composite} end from unnest(${[present, ...columns].join(", ")}) with ordinality
    as tuples(present, ${names.join(", ")}, ordinal) order by tuples.ordinal)`;
}
function compileTupleParameters<Table extends PgTable>(table: Table, typeName: string) {
  // SAFETY: Drizzle's table column keys describe this same inferred insert row.
  const columns = Object.entries(getTableColumns(table)).map(([key, column]) => ({
    key: key as keyof Table["$inferInsert"], column, type: column.getSQLType(),
  }));
  return (values: readonly (Table["$inferInsert"] | null)[], namespace: string,
    config: BuildQueryConfig, mapping: PublicationMapping, array: PublicationArray): string => {
    const type = `${namespace}.${config.escapeName(typeName)}`;
    // Map in the original row/field order before transposing. A later encoder
    // must never run before an earlier native expression or encoder fails.
    const mapped = values.map(value => value === null ? null :
      columns.map(({ key, column, type: columnType }) => mapping(value[key], columnType, column)));
    return tupleArray(mapped, columns.map(column => column.type), type, array);
  };
}
const rowTuple = compileTupleParameters(fxAppRowRevisions, "fx_app_row_write");
const indexTuple = compileTupleParameters(fxAppIndexEntryRevisions, "fx_app_index_write");
const uniqueTuple = compileTupleParameters(fxAppUniqueKeys, "fx_app_unique_write");
const searchTuple = compileTupleParameters(fxAppSearchEntryCurrent, "fx_app_search_write");
const jsonTuple = compileTupleParameters(fxAppJsonEntryCurrent, "fx_app_json_write");

/** This is a complete top-level installed publication statement. Drizzle walks
 * nested SQL chunks itself, so a nested custom SQL renderer would be ignored.
 * Only immutable column mechanics are retained; every render binds fresh values
 * through the real dialect and native codecs in their original evaluation order. */
class ApplicationPublicationStatement extends SQL {
  constructor(private readonly schemaName: string, private readonly prefix: SQL,
    private readonly intrinsic: SQL, private readonly stop: string | null,
    private readonly value: ApplicationMaterializationValues) { super([]); }

  override toQuery(input: BuildQueryConfig): QueryWithTypings {
    const config = { ...input, paramStartIndex: input.paramStartIndex ?? { value: 0 } };
    const prefix = this.prefix.toQuery(config);
    const intrinsic = this.intrinsic.toQuery(config);
    const params = [...prefix.params, ...intrinsic.params];
    const typings: QueryTypingsValue[] = [...prefix.typings ?? [], ...intrinsic.typings ?? []];
    const namespace = config.escapeName(this.schemaName);
    const mapping: PublicationMapping = (value, type, column) => {
      const mapped: unknown = value === null || column === undefined ? value : column.mapToDriverValue(value);
      // The installed columns encode scalars, bytes and JSON. Preserve Drizzle's
      // expression-returning encoder contract if a native codec ever uses it.
      if (is(mapped, SQL)) {
        const nested = mapped.toQuery(config);
        params.push(...nested.params);
        typings.push(...nested.typings ?? []);
        return { kind: "expression", sql: `${nested.sql}::${type}` };
      }
      return { kind: "value", value: mapped };
    };
    const literalParameter = (value: unknown, type: string, column?: PgColumn): string => {
      params.push(value);
      typings.push(column === undefined || config.prepareTyping === undefined ? "none" : config.prepareTyping(column));
      return `${config.escapeParam(config.paramStartIndex.value++, value)}::${type}`;
    };
    const parameter: PublicationParameter = (value, type, column) => {
      const mapped = mapping(value, type, column);
      return mapped.kind === "expression" ? mapped.sql : literalParameter(mapped.value, type, column);
    };
    const array: PublicationArray = (values, type) => {
      if (values.length === 0) return `array[]::${type}[]`;
      // Native SQL-returning encoders retain expression semantics. Their own
      // rendering already happened at the original row/field frontier.
      if (!values.every(value => value.kind === "value")) return `array[${values.map(value =>
        value.kind === "expression" ? value.sql : literalParameter(value.value, type)).join(", ")}]::${type}[]`;
      const encoded = values.map(value => value.value === null || value.value === undefined ? null
        : isUint8Array(value.value) ? `\\x${encodeBytesToLowercaseHex(value.value)}` : String(value.value));
      return literalParameter(makePgArray(encoded), `${type}[]`);
    };
    const scalarArray = (values: readonly unknown[], type: string, column?: PgColumn) =>
      array(values.map(value => mapping(value, type, column)), type);
    const owners = (values: ApplicationMaterializationValues["unique"]["owners"]) => {
      const type = `${namespace}.fx_app_unique_owner`;
      const columns = fxAppUniqueKeys;
      return tupleArray(values.map(value => [
        mapping(value.scopeUuid, "uuid", columns.scopeUuid), mapping(value.constraintId, "integer", columns.constraintId),
        mapping(value.localeKey, "text", columns.localeKey), mapping(value.tableId, "integer", columns.tableId),
        mapping(value.rowId, "bytea", columns.rowId),
      ]), ["uuid", "integer", "text", "integer", "bytea"], type, array);
    };
    const indexCoverage = (values: ApplicationMaterializationValues["indexCoverage"]) => {
      const type = `${namespace}.fx_app_index_coverage`; const columns = fxSystemIndexBuildStates;
      return tupleArray(values.map(value => [
        mapping(value.scopeId, "text", columns.scopeId), mapping(value.indexDefinitionId, "integer", columns.indexDefinitionId),
        mapping(value.attemptFence, "bigint", columns.attemptFence), mapping(value.epoch, "text", columns.epoch),
        mapping(value.storageGenerationFence, "bigint", columns.storageGenerationFence),
      ]), ["text", "integer", "bigint", "text", "bigint"], type, array);
    };
    const uniqueCoverage = (values: ApplicationMaterializationValues["uniqueCoverage"]) => {
      const type = `${namespace}.fx_app_unique_coverage`; const columns = fxSystemUniqueConstraintBuilds;
      return tupleArray(values.map(value => [
        mapping(value.scopeId, "text", columns.scopeId), mapping(value.uniqueConstraintDefinitionId, "integer", columns.uniqueConstraintDefinitionId),
        mapping(value.attemptFence, "bigint", columns.attemptFence), mapping(value.epoch, "text", columns.epoch),
        mapping(value.storageGenerationFence, "bigint", columns.storageGenerationFence),
      ]), ["text", "integer", "bigint", "text", "bigint"], type, array);
    };
    const stop = parameter(this.stop, "text");
    const value = this.value;
    const tail = [
      rowTuple(value.rows, namespace, config, mapping, array), scalarArray(value.rowPages, "integer"),
      indexTuple(value.indexes.map(entry => entry.row), namespace, config, mapping, array), scalarArray(value.indexes.map(entry => entry.prior), "bigint"),
      scalarArray(value.indexes.map(entry => entry.historical), "boolean"), owners(value.unique.owners),
      uniqueTuple(value.unique.previous, namespace, config, mapping, array), uniqueTuple(value.unique.next, namespace, config, mapping, array),
      indexCoverage(value.validation), indexCoverage(value.indexCoverage), uniqueCoverage(value.uniqueCoverage),
      parameter(value.commitSeq, "bigint", fxAppRowRevisions.commitSeq), parameter(value.scopeUuid, "uuid", fxAppRowRevisions.scopeUuid),
      scalarArray(value.search.map(search => search.definition.tableId), "integer", fxAppSearchEntryCurrent.tableId),
      scalarArray(value.search.map(search => search.definition.logicalIndexId), "integer", fxAppSearchEntryCurrent.logicalIndexId),
      scalarArray(value.search.map(search => search.definition.sourceSha256), "text", fxAppSearchEntryCurrent.sourceSha256),
      scalarArray(value.search.map(search => search.definition.kind === "jsonContainment"), "boolean"),
      scalarArray(value.search.map(search => search.ids.length), "integer"),
      scalarArray(value.search.flatMap(search => search.ids), "bytea", fxAppSearchEntryCurrent.rowId),
      scalarArray(value.search.map(search => search.textPages.flat().length), "integer"),
      searchTuple(value.search.flatMap(search => search.textPages.flat()), namespace, config, mapping, array),
      scalarArray(value.search.map(search => search.jsonPages.flat().length), "integer"),
      jsonTuple(value.search.flatMap(search => search.jsonPages.flat()), namespace, config, mapping, array),
    ].join(", ");
    return { sql: `select kind,coverage_ordinal,coverage_definition,
    coverage_attempt::text,coverage_epoch,coverage_fence::text,reason,row_count,index_count,unique_count,validation_count,coverage_count,search_count,search_build_count,intrinsic_count,
    intrinsic_live_count,intrinsic_tombstone_count,intrinsic_key_bytes,index_coverage_count,unique_coverage_count
    from ${namespace}.fx_apply_app_publication(${prefix.sql},${intrinsic.sql},${stop},${tail})`, params, typings };
  }
}

export function buildApplicationPublicationStatement(schemaName: string, prefix: SQL, intrinsic: SQL,
  stop: string | null, value: ApplicationMaterializationValues): SQL {
  return new ApplicationPublicationStatement(schemaName, prefix, intrinsic, stop, value);
}
