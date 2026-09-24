import { Result, Schema } from "effect";
import { isRelationalColumnValue, relationalHasIndexedScalarPrefix,
  type RelationalPersistenceCapability, type RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { encodeOrderedIndexComponentsV1, orderedIndexKeyHexV1ToBytes,
  orderedIndexValueFromFlarexValueV1, OrderedIndexKeyTooLargeError } from "flarex-protocol/ordered-index";
import type { JsonObject } from "flarex-protocol/json";
import type { LogicalDocumentFailure } from "./model";
import { prepareLogicalRelationalRowValues, relationalTextIdentity } from "./relationalRows";

/** The admitted indexed text relational profile. Other predicate families require
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
  Schema.Struct({ kind: Schema.Literal("in"), column: Schema.String,
    values: Schema.Array(Schema.Union([Schema.String, Schema.Boolean])) }),
  Schema.Struct({ kind: Schema.Literal("isNull"), column: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("textNotEqual"), column: Schema.String, value: Schema.String }),
]);
const decodeEnvelope = Schema.decodeUnknownResult(Envelope, { onExcessProperty: "error" });
const decodeNode = Schema.decodeUnknownResult(Node, { onExcessProperty: "error" });
interface Selection {
  readonly column: string;
  readonly value: string | boolean;
  readonly nullColumn?: string;
}
interface SelectionPlan {
  /** null needs another indexed conjunct, or an admitted bounded full-set read. */
  readonly selections: readonly Selection[] | null;
  readonly unindexedText: boolean;
}
interface Filter<Failure> {
  /** null denotes no indexed selection; an empty list matches no rows. */
  readonly select: (requiredNulls: ReadonlySet<string>) => Result.Result<SelectionPlan, Failure>;
  /** Every matching row has these null fields, including across OR branches. */
  readonly requiredNulls: ReadonlySet<string>;
  readonly matches: (row: JsonObject) => boolean;
}

export function compileLogicalRelationalRead<Failure>(table: RelationalTableDefinition, capabilities: readonly RelationalPersistenceCapability[], input: unknown,
  pageRows: number, error: LogicalDocumentFailure<Failure>) {
  return Result.gen(function* () {
    const identity = yield* relationalTextIdentity(table, error);
    const key = identity[0];
    if (key === undefined) return yield* Result.fail(error("invalidInput"));
    const validate = prepareLogicalRelationalRowValues(table, capabilities, error);
    const query = yield* decodeEnvelope(input).pipe(Result.mapError(cause => error("invalidInput", cause)));
    const fields = query.fields ?? table.columns.map(column => column.identity.columnId);
    const orderColumn = table.columns.find(column => column.identity.columnId === query.order.column);
    if (fields.length === 0 || fields.length > table.columns.length || new Set(fields).size !== fields.length ||
        fields.some(field => !table.columns.some(column => column.identity.columnId === field)) ||
        (orderColumn?.type !== "text" && orderColumn?.type !== "integer") || orderColumn.nullable)
      return yield* Result.fail(error("invalidInput"));
    const take = query.take ?? pageRows;
    if (take > pageRows) return yield* Result.fail(error("limitExceeded"));
    let nodes = 0;
    let operands = 0;
    const visit = (inputNode: unknown, depth: number): Result.Result<Filter<Failure>, Failure> => Result.gen(function* () {
      if (++nodes > relationalReadLimits.filterNodes || depth > relationalReadLimits.filterDepth)
        return yield* Result.fail(error("limitExceeded"));
      const node = yield* decodeNode(inputNode).pipe(Result.mapError(cause => error("invalidInput", cause)));
      if (node.kind === "in") {
        operands += node.values.length;
        if (operands > relationalReadLimits.filterOperands) return yield* Result.fail(error("limitExceeded"));
        const column = table.columns.find(candidate => candidate.identity.columnId === node.column);
        if (column === undefined || (column.type !== "text" && column.type !== "boolean") ||
            node.values.some(value => !isRelationalColumnValue(column.type, false, value)))
          return yield* Result.fail(error("invalidInput"));
        const keys = new Set(node.values);
        return { select: (requiredNulls: ReadonlySet<string>) => {
          const unconditional = relationalHasIndexedScalarPrefix(table, node.column);
          const conditional = unconditional ? undefined : table.indexes.find(candidate => candidate.columns[0]?.columnId === node.column &&
            candidate.predicate?.kind === "isNull" && requiredNulls.has(candidate.predicate.column.columnId));
          if (!unconditional && conditional === undefined)
            return Result.succeed({ selections: null, unindexedText: column.type === "text" });
          const nullColumn = conditional?.predicate?.kind === "isNull" ? conditional.predicate.column.columnId : undefined;
          return Result.succeed({ selections: [...keys].map(value => ({ column: node.column, value,
            ...(nullColumn === undefined ? {} : { nullColumn }) })), unindexedText: false });
        }, requiredNulls: new Set<string>(),
          matches: row => { const value = row[node.column]; return (typeof value === "string" || typeof value === "boolean") && keys.has(value); } };
      }
      if (node.kind === "isNull") {
        const column = table.columns.find(candidate => candidate.identity.columnId === node.column);
        if (column === undefined) return yield* Result.fail(error("invalidInput"));
        return { select: () => Result.succeed({ selections: column.nullable ? null : [], unindexedText: false }),
          requiredNulls: column.nullable ? new Set([node.column]) : new Set<string>(),
          matches: row => row[node.column] === null };
      }
      if (node.kind === "textNotEqual") {
        const column = table.columns.find(candidate => candidate.identity.columnId === node.column);
        if (column?.type !== "text" || !isRelationalColumnValue("text", false, node.value))
          return yield* Result.fail(error("invalidInput"));
        return { select: () => Result.succeed({ selections: null, unindexedText: false }), requiredNulls: new Set<string>(),
          matches: row => typeof row[node.column] === "string" && row[node.column] !== node.value };
      }
      const children: Filter<Failure>[] = [];
      for (const child of node.children) children.push(yield* visit(child, depth + 1));
      const requiredNulls = new Set<string>(node.kind === "or" ? children[0]?.requiredNulls ?? [] : []);
      for (const child of children) {
        if (node.kind === "and") {
          for (const field of child.requiredNulls) requiredNulls.add(field);
        }
        if (node.kind === "or") for (const field of requiredNulls) if (!child.requiredNulls.has(field)) requiredNulls.delete(field);
      }
      return { select: (inheritedNulls: ReadonlySet<string>) => Result.gen(function* () {
        const available = node.kind === "and" ? new Set([...inheritedNulls, ...requiredNulls]) : inheritedNulls;
        let selections: readonly Selection[] | null = node.kind === "and" ? null : [];
        let unindexedText = false;
        for (const child of children) {
          const candidate = yield* child.select(available);
          unindexedText ||= candidate.unindexedText;
          if (node.kind === "and") {
            if (candidate.selections !== null && (selections === null || candidate.selections.length < selections.length)) selections = candidate.selections;
          } else selections = selections === null || candidate.selections === null ? null : [...selections, ...candidate.selections];
        }
        return { selections, unindexedText };
      }), requiredNulls,
        matches: row => node.kind === "and" ? children.every(child => child.matches(row)) : children.some(child => child.matches(row)) };
    });
    const filter = yield* visit(query.predicate ?? { kind: "and", children: [] }, 0);
    const planned = yield* filter.select(new Set());
    if (planned.selections === null && planned.unindexedText && filter.requiredNulls.size === 0)
      return yield* Result.fail(error("invalidInput"));
    const selections = planned.selections === null ? null : Object.freeze([...new Map(planned.selections.map(selection =>
      [JSON.stringify([selection.column, selection.value, selection.nullColumn ?? null]), selection] as const)).values()]);
    return Object.freeze({ key, selections,
      requiresIndexedNullAnchor: selections === null && planned.unindexedText,
      requiredNulls: Object.freeze([...filter.requiredNulls]),
      offset: query.skip ?? 0, limit: take, direction: query.order.direction, fields: Object.freeze([...fields]),
      inspect: (row: JsonObject) => Result.gen(function* () {
        // Read the complete native row before projecting, including exact numeric
        // companions; projection cannot hide malformed persisted data.
        const { _id: _internalId, _creationTime: _internalTime, ...native } = row;
        yield* validate(native, "storedCorruption");
        const value = row[query.order.column];
        if (!isRelationalColumnValue(orderColumn.type, false, value ?? null)) return yield* Result.fail(error("storedCorruption"));
        // Compare complete UTF-8 bytes for native text order. JS code-unit
        // order differs for supplementary characters; neither path needs a
        // bounded ordered-index key for in-memory row sorting.
        if (orderColumn.type === "text" && typeof value === "string")
          return { matches: filter.matches(row), order: new TextEncoder().encode(value) };
        const order = yield* Result.try({ try: () => orderedIndexKeyHexV1ToBytes(
          encodeOrderedIndexComponentsV1([orderedIndexValueFromFlarexValueV1(value)])),
          catch: cause => { if (cause instanceof OrderedIndexKeyTooLargeError) return error("limitExceeded", cause); throw cause; } });
        return { matches: filter.matches(row), order };
      }),
    });
  });
}
