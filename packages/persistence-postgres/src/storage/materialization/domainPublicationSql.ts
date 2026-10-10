import { getTableColumns, is, SQL, type BuildQueryConfig, type QueryWithTypings, type QueryTypingsValue } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { fxAppRowRevisions, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxAppSearchEntryCurrent, fxAppJsonEntryCurrent, fxSystemIndexBuildStates,
  fxSystemUniqueConstraintBuilds } from "../../database/schema";
import type { ApplicationMaterializationValues } from "./domainApplication";

type PublicationParameter = (value: unknown, type: string, column?: PgColumn) => string;
function compileTupleParameters<Table extends PgTable>(table: Table, typeName: string) {
  // SAFETY: Drizzle's table column keys describe this same inferred insert row.
  const columns = Object.entries(getTableColumns(table)).map(([key, column]) => ({
    key: key as keyof Table["$inferInsert"], column, type: column.getSQLType(),
  }));
  return (values: readonly (Table["$inferInsert"] | null)[], namespace: string,
    config: BuildQueryConfig, parameter: PublicationParameter): string => {
    const type = `${namespace}.${config.escapeName(typeName)}`;
    return `array[${values.map(value => value === null ? `null::${type}` :
      `row(${columns.map(({ key, column, type: columnType }) => parameter(value[key], columnType, column)).join(", ")})::${type}`).join(", ")}]::${type}[]`;
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
    const parameter = (value: unknown, type: string, column?: PgColumn): string => {
      const mapped: unknown = value === null || column === undefined ? value : column.mapToDriverValue(value);
      // The installed columns encode scalars, bytes and JSON. Preserve Drizzle's
      // expression-returning encoder contract if a native codec ever uses it.
      if (is(mapped, SQL)) {
        const nested = mapped.toQuery(config);
        params.push(...nested.params);
        typings.push(...nested.typings ?? []);
        return `${nested.sql}::${type}`;
      }
      params.push(mapped);
      typings.push(column === undefined || config.prepareTyping === undefined ? "none" : config.prepareTyping(column));
      return `${config.escapeParam(config.paramStartIndex.value++, mapped)}::${type}`;
    };
    const scalarArray = (values: readonly unknown[], type: string, column?: PgColumn) =>
      `array[${values.map(value => parameter(value, type, column)).join(", ")}]::${type}[]`;
    const owners = (values: ApplicationMaterializationValues["unique"]["owners"]) => {
      const type = `${namespace}.fx_app_unique_owner`;
      const columns = fxAppUniqueKeys;
      return `array[${values.map(value => `row(${[
        parameter(value.scopeUuid, "uuid", columns.scopeUuid), parameter(value.constraintId, "integer", columns.constraintId),
        parameter(value.localeKey, "text", columns.localeKey), parameter(value.tableId, "integer", columns.tableId),
        parameter(value.rowId, "bytea", columns.rowId),
      ].join(", ")})::${type}`).join(", ")}]::${type}[]`;
    };
    const indexCoverage = (values: ApplicationMaterializationValues["indexCoverage"]) => {
      const type = `${namespace}.fx_app_index_coverage`; const columns = fxSystemIndexBuildStates;
      return `array[${values.map(value => `row(${[
        parameter(value.scopeId, "text", columns.scopeId), parameter(value.indexDefinitionId, "integer", columns.indexDefinitionId),
        parameter(value.attemptFence, "bigint", columns.attemptFence), parameter(value.epoch, "text", columns.epoch),
        parameter(value.storageGenerationFence, "bigint", columns.storageGenerationFence),
      ].join(", ")})::${type}`).join(", ")}]::${type}[]`;
    };
    const uniqueCoverage = (values: ApplicationMaterializationValues["uniqueCoverage"]) => {
      const type = `${namespace}.fx_app_unique_coverage`; const columns = fxSystemUniqueConstraintBuilds;
      return `array[${values.map(value => `row(${[
        parameter(value.scopeId, "text", columns.scopeId), parameter(value.uniqueConstraintDefinitionId, "integer", columns.uniqueConstraintDefinitionId),
        parameter(value.attemptFence, "bigint", columns.attemptFence), parameter(value.epoch, "text", columns.epoch),
        parameter(value.storageGenerationFence, "bigint", columns.storageGenerationFence),
      ].join(", ")})::${type}`).join(", ")}]::${type}[]`;
    };
    const stop = parameter(this.stop, "text");
    const value = this.value;
    const tail = [
      rowTuple(value.rows, namespace, config, parameter), scalarArray(value.rowPages, "integer"),
      indexTuple(value.indexes.map(entry => entry.row), namespace, config, parameter), scalarArray(value.indexes.map(entry => entry.prior), "bigint"),
      scalarArray(value.indexes.map(entry => entry.historical), "boolean"), owners(value.unique.owners),
      uniqueTuple(value.unique.previous, namespace, config, parameter), uniqueTuple(value.unique.next, namespace, config, parameter),
      indexCoverage(value.validation), indexCoverage(value.indexCoverage), uniqueCoverage(value.uniqueCoverage),
      parameter(value.commitSeq, "bigint", fxAppRowRevisions.commitSeq), parameter(value.scopeUuid, "uuid", fxAppRowRevisions.scopeUuid),
      scalarArray(value.search.map(search => search.definition.tableId), "integer", fxAppSearchEntryCurrent.tableId),
      scalarArray(value.search.map(search => search.definition.logicalIndexId), "integer", fxAppSearchEntryCurrent.logicalIndexId),
      scalarArray(value.search.map(search => search.definition.sourceSha256), "text", fxAppSearchEntryCurrent.sourceSha256),
      scalarArray(value.search.map(search => search.definition.kind === "jsonContainment"), "boolean"),
      scalarArray(value.search.map(search => search.ids.length), "integer"),
      scalarArray(value.search.flatMap(search => search.ids), "bytea", fxAppSearchEntryCurrent.rowId),
      scalarArray(value.search.map(search => search.textPages.flat().length), "integer"),
      searchTuple(value.search.flatMap(search => search.textPages.flat()), namespace, config, parameter),
      scalarArray(value.search.map(search => search.jsonPages.flat().length), "integer"),
      jsonTuple(value.search.flatMap(search => search.jsonPages.flat()), namespace, config, parameter),
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
