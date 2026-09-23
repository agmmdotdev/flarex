import { Result, Schema } from "effect";
import { isRelationalColumnValue, type RelationalPersistenceCapability, type RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { encodeOrderedIndexComponentsV1, orderedIndexValueFromFlarexValueV1, OrderedIndexKeyTooLargeError } from "flarex-protocol/ordered-index";
import type { JsonObject } from "flarex-protocol/json";
import type { LogicalDocumentFailure } from "./model";
import { prepareLogicalRelationalRowValues, relationalTextPrimaryKey } from "./relationalRows";

/** The admitted text-key relational profile. Other predicate families require
 * their own indexed execution contract before they can be enabled here. */
export const relationalReadLimits = Object.freeze({ filterNodes: 64, filterDepth: 8, filterOperands: 256 });
const Window = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Envelope = Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String)), predicate: Schema.optionalKey(Schema.Unknown),
  skip: Schema.optionalKey(Window), take: Schema.optionalKey(Window),
  order: Schema.Struct({ column: Schema.String, direction: Schema.Literals(["asc", "desc"]) }),
});
const Node = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["and", "or"]), children: Schema.Array(Schema.Unknown) }),
  Schema.Struct({ kind: Schema.Literal("in"), column: Schema.String, values: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("isNull"), column: Schema.String }),
]);
const decodeEnvelope = Schema.decodeUnknownResult(Envelope, { onExcessProperty: "error" });
const decodeNode = Schema.decodeUnknownResult(Node, { onExcessProperty: "error" });
interface Filter {
  /** null denotes an unbounded key domain, not an unknown or failed parse. */
  readonly keys: ReadonlySet<string> | null;
  /** Every matching row has these null fields, including across OR branches. */
  readonly requiredNulls: ReadonlySet<string>;
  readonly matches: (row: JsonObject) => boolean;
}

export function compileLogicalRelationalRead<Failure>(table: RelationalTableDefinition, capabilities: readonly RelationalPersistenceCapability[], input: unknown,
  pageRows: number, error: LogicalDocumentFailure<Failure>) {
  return Result.gen(function* () {
    const key = yield* relationalTextPrimaryKey(table, error);
    const validate = prepareLogicalRelationalRowValues(table, capabilities, error);
    const query = yield* decodeEnvelope(input).pipe(Result.mapError(cause => error("invalidInput", cause)));
    const fields = query.fields ?? table.columns.map(column => column.identity.columnId);
    if (fields.length === 0 || fields.length > table.columns.length || new Set(fields).size !== fields.length ||
        fields.some(field => !table.columns.some(column => column.identity.columnId === field)) || query.order.column !== key)
      return yield* Result.fail(error("invalidInput"));
    const take = query.take ?? pageRows;
    if (take > pageRows) return yield* Result.fail(error("limitExceeded"));
    let nodes = 0;
    let operands = 0;
    const visit = (inputNode: unknown, depth: number): Result.Result<Filter, Failure> => Result.gen(function* () {
      if (++nodes > relationalReadLimits.filterNodes || depth > relationalReadLimits.filterDepth)
        return yield* Result.fail(error("limitExceeded"));
      const node = yield* decodeNode(inputNode).pipe(Result.mapError(cause => error("invalidInput", cause)));
      if (node.kind === "in") {
        operands += node.values.length;
        if (operands > relationalReadLimits.filterOperands) return yield* Result.fail(error("limitExceeded"));
        if (node.column !== key || node.values.some(value => !isRelationalColumnValue("text", false, value)))
          return yield* Result.fail(error("invalidInput"));
        const keys = new Set(node.values);
        return { keys, requiredNulls: new Set<string>(), matches: row => typeof row[key] === "string" && keys.has(row[key]) };
      }
      if (node.kind === "isNull") {
        const column = table.columns.find(candidate => candidate.identity.columnId === node.column);
        if (column === undefined) return yield* Result.fail(error("invalidInput"));
        return { keys: column.nullable ? null : new Set<string>(),
          requiredNulls: column.nullable ? new Set([node.column]) : new Set<string>(),
          matches: row => row[node.column] === null };
      }
      const children: Filter[] = [];
      for (const child of node.children) children.push(yield* visit(child, depth + 1));
      let keys: ReadonlySet<string> | null = node.kind === "and" ? null : new Set<string>();
      const requiredNulls = new Set<string>(node.kind === "or" ? children[0]?.requiredNulls ?? [] : []);
      for (const child of children) {
        if (node.kind === "and") {
          if (child.keys !== null) keys = keys === null ? child.keys : new Set([...keys].filter(value => child.keys?.has(value)));
          for (const field of child.requiredNulls) requiredNulls.add(field);
        } else keys = keys === null || child.keys === null ? null : new Set([...keys, ...child.keys]);
        if (node.kind === "or") for (const field of requiredNulls) if (!child.requiredNulls.has(field)) requiredNulls.delete(field);
      }
      return { keys, requiredNulls,
        matches: row => node.kind === "and" ? children.every(child => child.matches(row)) : children.some(child => child.matches(row)) };
    });
    const filter = yield* visit(query.predicate ?? { kind: "and", children: [] }, 0);
    return Object.freeze({ key, keys: filter.keys === null ? null : Object.freeze([...filter.keys]),
      requiredNulls: Object.freeze([...filter.requiredNulls]),
      offset: query.skip ?? 0, limit: take, direction: query.order.direction, fields: Object.freeze([...fields]),
      inspect: (row: JsonObject) => Result.gen(function* () {
        // Read the complete native row before projecting, including exact numeric
        // companions; projection cannot hide malformed persisted data.
        const { _id: _internalId, _creationTime: _internalTime, ...native } = row;
        yield* validate(native, "storedCorruption");
        const value = row[key];
        if (typeof value !== "string") return yield* Result.fail(error("storedCorruption"));
        const order = yield* Result.try({ try: () => encodeOrderedIndexComponentsV1([orderedIndexValueFromFlarexValueV1(value)]),
          catch: cause => { if (cause instanceof OrderedIndexKeyTooLargeError) return error("limitExceeded", cause); throw cause; } });
        return { matches: filter.matches(row), order };
      }),
    });
  });
}
