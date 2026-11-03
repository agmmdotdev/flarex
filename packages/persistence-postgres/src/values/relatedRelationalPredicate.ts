import { Result, Schema } from "effect";
import type { RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { decodeRelatedPredicateNodeLimit, relationalReadLimits } from "../execution/preparation/frameworkExecutionPolicy";
import { prepareRelationalRead } from "./relationalQuery";
import { capturePrivateJsonData } from "./privateJsonData";
import { issuePostgresRelatedRelationalPredicate, MAX_POSTGRES_RELATIONAL_PREDICATE_BYTES,
  type NormalizedRelatedRelationalPredicate, type PostgresRelationalPredicateFailure } from "./postgresRelationalPredicate";

const Query = Schema.Struct({ childTable: Schema.String, foreignKey: Schema.String, predicate: Schema.Unknown });
const Node = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["and", "or"]), children: Schema.Array(Schema.Unknown) }),
  Schema.Struct({ kind: Schema.Literals(["parent", "child", "notInChild"]), predicate: Schema.Unknown }),
]);
export const decodeRelatedRelationalQuery = Schema.decodeUnknownResult(Query, { onExcessProperty: "error" });
const decodeNode = Schema.decodeUnknownResult(Node, { onExcessProperty: "error" });

/** The execution owner resolves both names and proves source admission before
 * compilation. The child token remains bound to the protected batch. */
export function prepareRelatedRelationalPredicate<Binding, Failure>(parent: RelationalTableDefinition,
  child: RelationalTableDefinition, childTableId: Binding, query: typeof Query.Type,
  pageRows: number, error: PostgresRelationalPredicateFailure<Failure>, selectedNodeLimit: number = relationalReadLimits.filterNodes) {
  return Result.gen(function* () {
    const nodeLimit = yield* decodeRelatedPredicateNodeLimit(selectedNodeLimit).pipe(Result.mapError(cause => error("invalidInput", cause)));
    const constraint = child.constraints.find(member => member.identity.constraintId === query.foreignKey);
    const parentPrimary = parent.keys.find(key => key.kind === "primary");
    const childPrimary = child.keys.find(key => key.kind === "primary");
    if (parent === child || constraint?.kind !== "foreignKey" || constraint.sourceColumns.length !== 1 ||
      constraint.targetColumns.length !== 1 || parentPrimary?.columns.length !== 1 || childPrimary?.columns.length !== 1)
      return yield* Result.fail(error("invalidInput"));
    const from = constraint.sourceColumns[0], to = constraint.targetColumns[0];
    const parentColumn = parentPrimary.columns[0]?.columnId;
    const childPrimaryColumn = childPrimary.columns[0]?.columnId;
    if (from === undefined || to === undefined || parentColumn === undefined || childPrimaryColumn === undefined ||
      from.owner !== child.identity.owner || from.lineageId !== child.identity.lineageId || from.tableId !== child.identity.tableId ||
      to.owner !== parent.identity.owner || to.lineageId !== parent.identity.lineageId || to.tableId !== parent.identity.tableId ||
      to.columnId !== parentColumn || child.columns.find(column => column.identity.columnId === from.columnId)?.type !== "text" ||
      child.columns.find(column => column.identity.columnId === from.columnId)?.nullable !== false ||
      parent.columns.find(column => column.identity.columnId === parentColumn)?.type !== "text")
      return yield* Result.fail(error("invalidInput"));
    let nodes = 0, operands = 0;
    const visit = (input: unknown, depth: number): Result.Result<NormalizedRelatedRelationalPredicate, Failure> => Result.gen(function* () {
      if (++nodes > nodeLimit || depth > relationalReadLimits.filterDepth)
        return yield* Result.fail(error("limitExceeded"));
      const node = yield* decodeNode(input).pipe(Result.mapError(cause => error("invalidInput", cause)));
      if ("children" in node) {
        const children: NormalizedRelatedRelationalPredicate[] = [];
        for (const member of node.children) children.push(yield* visit(member, depth + 1));
        return Object.freeze({ kind: node.kind, children: Object.freeze(children) });
      }
      const table = node.kind === "parent" ? parent : child;
      const column = node.kind === "parent" ? parentColumn : childPrimaryColumn;
      // Reuse the scalar owner's text identity, decoder, column checks,
      // normalization and complexity counters. No leaf runs in JavaScript.
      const scalar = yield* prepareRelationalRead(table,
        { predicate: node.predicate, order: { column, direction: "asc" } }, pageRows, error);
      // A PostgreSQL scalar's capture limit precedes later related nodes.
      // The completed tree below issues the only evaluation token.
      if (scalar.postgresPredicate !== undefined)
        yield* capturePrivateJsonData(scalar.postgresPredicate, MAX_POSTGRES_RELATIONAL_PREDICATE_BYTES, error);
      nodes += scalar.complexity.nodes;
      operands += scalar.complexity.operands;
      if (nodes > nodeLimit || operands > relationalReadLimits.filterOperands ||
        depth + 1 + scalar.complexity.depth > relationalReadLimits.filterDepth)
        return yield* Result.fail(error("limitExceeded"));
      return Object.freeze({ kind: node.kind, predicate: scalar.predicate });
    });
    const predicate = yield* visit(query.predicate, 0);
    const program = yield* issuePostgresRelatedRelationalPredicate(parent,
      { table: child, tableId: childTableId, parentColumn, childColumn: from.columnId }, predicate, error);
    return Object.freeze({ program, parentColumn, childPrimaryColumn });
  });
}
