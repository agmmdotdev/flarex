import { Option, Result } from "effect";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceRelation, CommerceRelations, CommerceRelationLookup } from "../commerce-relations";

/** A checked model projection, never a table capability or a schema artifact. */
export interface ReadTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly primaryKeys: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly companions: Readonly<Record<string, string>>;
}

export interface ReadCatalog {
  readonly relations: CommerceRelationLookup;
  readonly table: (name: string) => Result.Result<ReadTable, CommerceTransactionError>;
  readonly relation: (table: string, name: string) => Option.Option<CommerceRelation>;
}

/** Capture checked metadata once per preparation. Maps remain private and every
 * returned descriptor owns its arrays; later mutation of source metadata cannot
 * change a prepared query's meaning. No process-global model registry exists. */
export function makeReadCatalog(tables: readonly ReadTable[], relations: CommerceRelations): Result.Result<ReadCatalog, CommerceTransactionError> {
  const captured = new Map<string, ReadTable>();
  const joins = new Map<string, Pick<ReadonlyMap<string, CommerceRelation>, "get">>();
  for (const table of tables) {
    if (captured.has(table.name) || table.primaryKeys.some(key => !table.columns.includes(key))) {
      return Result.fail(commerceError("unsupportedProfile"));
    }
    captured.set(table.name, Object.freeze({ ...table,
      columns: Object.freeze([...table.columns]), primaryKeys: Object.freeze([...table.primaryKeys]),
      foreignKeys: Object.freeze([...table.foreignKeys]), companions: Object.freeze({ ...table.companions }),
    }));
  }
  for (const [name, members] of relations) {
    const selected = new Map<string, CommerceRelation>();
    for (const [key, relation] of members) {
      const join = relation.join;
      const base = { name: relation.name, targetTable: relation.targetTable,
        sourcePrimaryKeys: Object.freeze([...relation.sourcePrimaryKeys]), targetPrimaryKeys: Object.freeze([...relation.targetPrimaryKeys]),
      };
      if (join.type === "manyToMany") selected.set(key, Object.freeze({ ...base, join: Object.freeze({ ...join,
        sourceColumns: Object.freeze([...join.sourceColumns]), targetColumns: Object.freeze([...join.targetColumns]),
      }) }));
      else if (join.type === "belongsTo") selected.set(key, Object.freeze({ ...base, join: Object.freeze({ ...join, foreignKeys: Object.freeze([...join.foreignKeys]) }) }));
      else selected.set(key, Object.freeze({ ...base, join: Object.freeze({ ...join, foreignKeys: Object.freeze([...join.foreignKeys]) }) }));
    }
    joins.set(name, Object.freeze({ get: (key: string) => selected.get(key) }));
  }
  return Result.succeed(Object.freeze({
    relations: Object.freeze({ get: (name: string) => joins.get(name) }),
    table: (name: string) => {
      const table = captured.get(name);
      return table === undefined ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(table);
    },
    relation: (table: string, name: string) => Option.fromNullishOr(joins.get(table)?.get(name)),
  }));
}
