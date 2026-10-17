import { Result, Schema } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { isRelationalColumnValue, relationalHasIndexedScalarPrefix,
  type RelationalPersistenceCapability, type RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { encodeOrderedIndexComponentsV1, orderedIndexKeyHexV1ToBytes,
  orderedIndexValueFromFlarexValueV1, OrderedIndexKeyTooLargeError } from "flarex-protocol/ordered-index";
import type { Json, JsonObject } from "flarex-protocol/json";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { LogicalDocumentFailure } from "./model";
import { prepareLogicalRelationalRowValues, relationalTextIdentity, hasPreparedLogicalRelationalTableMechanics,
  inspectLogicalRelationalCanonicalRow, type PreparedLogicalRelationalTableMechanics } from "./relationalRows";
import { hasMandatorySearchTrigram, type LogicalSearchPattern } from "./searchReads";
import { jsonbContains } from "./jsonContains";
import { relationalReadLimits } from "../../../execution/preparation/frameworkExecutionPolicy";
import type { LogicalSelectionValues } from "./query";

/** The admitted indexed text relational profile. Other predicate families require
 * their own indexed execution contract before they can be enabled here. */
export { relationalReadLimits } from "../../../execution/preparation/frameworkExecutionPolicy";
const Window = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const StorageInsertionOrderSchema = Schema.Struct({ kind: Schema.Literal("storageInsertion"), direction: Schema.Literals(["asc", "desc"]) });
export type StorageInsertionOrder = typeof StorageInsertionOrderSchema.Type;
const Envelope = Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String)), predicate: Schema.optionalKey(Schema.Unknown),
  skip: Schema.optionalKey(Window), take: Schema.optionalKey(Window),
  order: Schema.Union([Schema.Struct({ column: Schema.String, direction: Schema.Literals(["asc", "desc"]) }), StorageInsertionOrderSchema]),
});
const Node = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["and", "or"]), children: Schema.Array(Schema.Unknown) }),
  Schema.Struct({ kind: Schema.Literal("in"), column: Schema.String,
    values: Schema.Array(Schema.Union([Schema.String, Schema.Boolean])) }),
  Schema.Struct({ kind: Schema.Literal("indexedPoints"),
    columns: Schema.Array(Schema.String).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
    values: Schema.Array(Schema.Array(Schema.Union([Schema.String, Schema.Boolean]))).check(Schema.isMaxLength(16)) }),
  Schema.Struct({ kind: Schema.Literal("isNull"), column: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("textNotEqual"), column: Schema.String, value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("greaterThan"), column: Schema.String, value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("textLikeAscii"), column: Schema.String, pattern: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("jsonContains"), column: Schema.String, value: Schema.Json }),
]);
const decodeEnvelope = Schema.decodeUnknownResult(Envelope, { onExcessProperty: "error" });
const decodeNode = Schema.decodeUnknownResult(Node, { onExcessProperty: "error" });
interface ScalarSelection {
  readonly kind?: never;
  readonly column: string;
  readonly value: string | boolean | Readonly<{ gt: string }>;
  readonly nullColumn?: string;
}
interface PointSelection {
  readonly kind: "point";
  readonly columns: readonly string[];
  readonly values: readonly (string | boolean)[];
  readonly nullColumn?: string;
}
type Selection = ScalarSelection | PointSelection;
/** The validated compiler lends its original selection values directly; no
 * synthetic document-query envelope or second query decoder is involved. */
export function logicalRelationalSelectionValues(selection: Selection): LogicalSelectionValues {
  const fields = selection.kind === "point" ? selection.columns : [selection.column];
  return Object.freeze({ fields: selection.nullColumn === undefined ? fields : [...fields, selection.nullColumn],
    value: (field: string) => field === selection.nullColumn ? null : selection.kind === "point"
      ? selection.values[selection.columns.indexOf(field)] : field === selection.column ? selection.value : undefined });
}
export interface LogicalRelationalReadAccess {
  readonly indexes: RelationalTableDefinition["indexes"];
  readonly keys: RelationalTableDefinition["keys"];
  readonly scalarColumns: readonly string[];
}
/** The validated compiler's metadata needs, before access-path selection. */
export interface LogicalRelationalReadDemand {
  readonly fields: readonly string[];
  readonly nulls: readonly string[];
  readonly points: readonly (readonly string[])[];
}
interface SelectionPlan {
  /** null needs another indexed conjunct, or an admitted bounded full-set read. */
  readonly selections: readonly Selection[] | null;
  readonly unindexedText: boolean;
}
interface Filter<Failure> {
  /** null denotes no indexed selection; an empty list matches no rows. */
  readonly select: (requiredNulls: ReadonlySet<string>, access?: LogicalRelationalReadAccess) => Result.Result<SelectionPlan, Failure>;
  /** Every matching row has these null fields, including across OR branches. */
  readonly requiredNulls: ReadonlySet<string>;
  readonly search: readonly LogicalSearchPattern[] | null;
  /** Scalar memberships implied by this conjunct; OR branches stay separate. */
  readonly equalities?: ReadonlyMap<string, readonly (string | boolean)[]>;
  readonly json?: Readonly<{ column: string; value: Json }>;
  readonly matches: (row: JsonObject) => boolean;
}

const compoundIndexes = (equalities: ReadonlyMap<string, readonly (string | boolean)[]>,
  indexes: RelationalTableDefinition["indexes"]) => {
  return indexes.filter(index => {
    if (index.kind !== "uniqueBtree" || index.columns.length < 2 || index.columns.length > 4 ||
      !index.columns.every(column => equalities.has(column.columnId))) return false;
    const count = index.columns.reduce((size, column) => size * (equalities.get(column.columnId)?.length ?? 0), 1);
    return count > 0 && count <= 16;
  });
};

/** Match the pinned SQL LIKE contract: ASCII-only case folding, percent and
 * underscore wildcards, and literal backslashes. Greedy wildcard matching
 * avoids a regular-expression backtracking path on untrusted search input. */
const foldAscii = (input: string) => [...input.replace(/[A-Z]/g, letter => letter.toLowerCase())];
function matchesTextLikeAscii(value: string, pattern: string): boolean {
  const text = foldAscii(value), expression = foldAscii(pattern);
  let textIndex = 0, patternIndex = 0, wildcard = -1, retry = 0;
  while (textIndex < text.length) {
    const token = expression[patternIndex];
    if (token === "_" || token !== undefined && token !== "%" && token === text[textIndex]) {
      textIndex++; patternIndex++;
    } else if (token === "%") { wildcard = patternIndex++; retry = textIndex; }
    else if (wildcard !== -1) { patternIndex = wildcard + 1; textIndex = ++retry; }
    else return false;
  }
  while (expression[patternIndex] === "%") patternIndex++;
  return patternIndex === expression.length;
}

export function compileLogicalRelationalRead<Failure>(table: RelationalTableDefinition, capabilities: readonly RelationalPersistenceCapability[], input: unknown,
  pageRows: number, error: LogicalDocumentFailure<Failure>, mechanics?: PreparedLogicalRelationalTableMechanics, access?: LogicalRelationalReadAccess) {
  return prepareLogicalRelationalRead(table, capabilities, input, pageRows, error, mechanics)
    .pipe(Result.flatMap(prepared => prepared.compile(access)));
}

/** Validate with the same row/query owner before acquiring immutable facts.
 * Access eligibility is deferred; no second predicate validator is involved. */
export function prepareLogicalRelationalRead<Failure>(sourceTable: RelationalTableDefinition, capabilities: readonly RelationalPersistenceCapability[], input: unknown,
  pageRows: number, error: LogicalDocumentFailure<Failure>, mechanics?: PreparedLogicalRelationalTableMechanics) {
  return Result.gen(function* () {
    if (mechanics !== undefined && !hasPreparedLogicalRelationalTableMechanics(mechanics, sourceTable))
      return yield* Result.fail(error("invalidAuthority"));
    const table = mechanics?.table ?? sourceTable;
    const identity = yield* (mechanics === undefined ? relationalTextIdentity(table, error) :
      mechanics.identity.pipe(Result.mapError(cause => error(cause.reason, cause.cause))));
    const key = identity[0];
    if (key === undefined) return yield* Result.fail(error("invalidInput"));
    const validate = mechanics === undefined ? prepareLogicalRelationalRowValues(table, capabilities, error) :
      (row: JsonObject, reason: "documentInvalid" | "storedCorruption") => mechanics.validate(row, reason)
        .pipe(Result.mapError(cause => error(cause.reason, cause.cause)));
    const query = yield* decodeEnvelope(input).pipe(Result.mapError(cause => error("invalidInput", cause)));
    const columnForName = mechanics?.column ?? ((name: string) => table.columns.find(column => column.identity.columnId === name));
    const fields = query.fields ?? mechanics?.columnNames ?? table.columns.map(column => column.identity.columnId);
    const storageInsertion = "kind" in query.order;
    const orderColumnName = "column" in query.order ? query.order.column : key;
    const orderColumn = columnForName(orderColumnName);
    if (fields.length === 0 || fields.length > table.columns.length || new Set(fields).size !== fields.length ||
        fields.some(field => columnForName(field) === undefined) ||
        (!storageInsertion && ((orderColumn?.type !== "text" && orderColumn?.type !== "integer" && orderColumn?.type !== "doublePrecision") || orderColumn.nullable)))
      return yield* Result.fail(error("invalidInput"));
    const take = query.take ?? pageRows;
    if (take > pageRows) return yield* Result.fail(error("limitExceeded"));
    const isBoundedUniquePoints = (selections: readonly Selection[] | null, access?: LogicalRelationalReadAccess) => {
      const indexes = access?.indexes ?? table.indexes, tableKeys = access?.keys ?? table.keys;
      return selections !== null &&
        selections.length > 0 && selections.length <= 16 && selections.every(selection => {
        if (selection.kind === "point") return indexes.some(index => index.kind === "uniqueBtree" &&
          index.columns.length === selection.columns.length && index.columns.every((column, offset) =>
            column.columnId === selection.columns[offset]) && (index.predicate === null ||
              index.predicate.kind === "isNull" && index.predicate.column.columnId === selection.nullColumn));
        if (typeof selection.value === "object") return false;
        if (tableKeys.some(tableKey => tableKey.columns.length === 1 && tableKey.columns[0]?.columnId === selection.column)) return true;
        return indexes.some(index => index.kind === "uniqueBtree" && index.columns.length === 1 &&
          index.columns[0]?.columnId === selection.column && (index.predicate === null ||
            index.predicate.kind === "isNull" && index.predicate.column.columnId === selection.nullColumn));
      });
    };
    const demandedFields = new Set<string>(), demandedNulls = new Set<string>();
    const demandedPoints = new Map<string, readonly string[]>();
    const equalityGroups: ReadonlyMap<string, readonly (string | boolean)[]>[] = [];
    const pointPlan = (columns: readonly string[], values: readonly (readonly (string | boolean)[])[],
      requiredNulls: ReadonlySet<string>, access?: LogicalRelationalReadAccess): SelectionPlan | null => {
      const index = (access?.indexes ?? table.indexes).find(candidate => candidate.kind === "uniqueBtree" &&
        candidate.columns.length === columns.length && candidate.columns.every((column, offset) => column.columnId === columns[offset]) &&
        (candidate.predicate === null || candidate.predicate.kind === "isNull" && requiredNulls.has(candidate.predicate.column.columnId)));
      if (index === undefined) return null;
      const nullColumn = index.predicate?.kind === "isNull" ? index.predicate.column.columnId : undefined;
      return { selections: values.map(point => ({ kind: "point", columns, values: point,
        ...(nullColumn === undefined ? {} : { nullColumn }) })), unindexedText: false };
    };
    let nodes = 0;
    let operands = 0;
    const visit = (inputNode: unknown, depth: number): Result.Result<Filter<Failure>, Failure> => Result.gen(function* () {
      if (++nodes > relationalReadLimits.filterNodes || depth > relationalReadLimits.filterDepth)
        return yield* Result.fail(error("limitExceeded"));
      const node = yield* decodeNode(inputNode).pipe(Result.mapError(cause => error("invalidInput", cause)));
      if (node.kind === "in") {
        operands += node.values.length;
        if (operands > relationalReadLimits.filterOperands) return yield* Result.fail(error("limitExceeded"));
        const column = columnForName(node.column);
        if (column === undefined || (column.type !== "text" && column.type !== "boolean") ||
            node.values.some(value => !isRelationalColumnValue(column.type, false, value)))
          return yield* Result.fail(error("invalidInput"));
        demandedFields.add(node.column);
        const keys = new Set(node.values);
        return { select: (requiredNulls: ReadonlySet<string>, access?: LogicalRelationalReadAccess) => {
          const indexes = access?.indexes ?? table.indexes, tableKeys = access?.keys ?? table.keys;
          const declaredUnconditional = tableKeys.some(tableKey => tableKey.columns[0]?.columnId === node.column) ||
            indexes.some(index => index.predicate === null && index.kind !== "jsonContainment" && index.columns[0]?.columnId === node.column);
          const unconditional = access === undefined ? relationalHasIndexedScalarPrefix(table, node.column) :
            declaredUnconditional || access.scalarColumns.includes(node.column);
          // Derived reverse access supplies the missing all-row path. It must
          // not displace a native active-row index and expand an active query's
          // bounded candidate set to deleted rows. Keep declared prefix order.
          const conditional = declaredUnconditional ? undefined : indexes.find(candidate => candidate.columns[0]?.columnId === node.column &&
            candidate.predicate?.kind === "isNull" && requiredNulls.has(candidate.predicate.column.columnId));
          if (!unconditional && conditional === undefined)
            return Result.succeed({ selections: null, unindexedText: column.type === "text" });
          const nullColumn = conditional?.predicate?.kind === "isNull" ? conditional.predicate.column.columnId : undefined;
          return Result.succeed({ selections: [...keys].map(value => ({ column: node.column, value,
            ...(nullColumn === undefined ? {} : { nullColumn }) })), unindexedText: false });
        }, requiredNulls: new Set<string>(), search: null, equalities: new Map([[node.column, [...keys]]]),
          matches: row => { const value = row[node.column]; return (typeof value === "string" || typeof value === "boolean") && keys.has(value); } };
      }
      if (node.kind === "indexedPoints") {
        operands += node.values.length * node.columns.length;
        if (operands > relationalReadLimits.filterOperands) return yield* Result.fail(error("limitExceeded"));
        if (new Set(node.columns).size !== node.columns.length || node.values.some(point => point.length !== node.columns.length))
          return yield* Result.fail(error("invalidInput"));
        for (const [offset, name] of node.columns.entries()) {
          const column = columnForName(name);
          if (column === undefined || (column.type !== "text" && column.type !== "boolean") ||
            node.values.some(point => { const value = point[offset];
              return value === undefined || !isRelationalColumnValue(column.type, false, value); }))
            return yield* Result.fail(error("invalidInput"));
        }
        for (const column of node.columns) demandedFields.add(column);
        demandedPoints.set(JSON.stringify(node.columns), Object.freeze([...node.columns]));
        const points = new Set(node.values.map(point => JSON.stringify(point)));
        return { select: (requiredNulls: ReadonlySet<string>, access?: LogicalRelationalReadAccess) => {
          const plan = pointPlan(node.columns, node.values, requiredNulls, access);
          return plan === null ? Result.fail(error("invalidInput")) : Result.succeed(plan);
        }, requiredNulls: new Set<string>(), search: null,
          matches: row => points.has(JSON.stringify(node.columns.map(column => row[column]))) };
      }
      if (node.kind === "isNull") {
        const column = columnForName(node.column);
        if (column === undefined) return yield* Result.fail(error("invalidInput"));
        if (column.nullable) demandedNulls.add(node.column);
        return { select: () => Result.succeed({ selections: column.nullable ? null : [], unindexedText: false }),
          requiredNulls: column.nullable ? new Set([node.column]) : new Set<string>(),
          search: null,
          matches: row => row[node.column] === null };
      }
      if (node.kind === "textNotEqual") {
        const column = columnForName(node.column);
        if (column?.type !== "text" || !isRelationalColumnValue("text", false, node.value))
          return yield* Result.fail(error("invalidInput"));
        return { select: () => Result.succeed({ selections: null, unindexedText: false }), requiredNulls: new Set<string>(), search: null,
          matches: row => typeof row[node.column] === "string" && row[node.column] !== node.value };
      }
      if (node.kind === "greaterThan") {
        const column = columnForName(node.column);
        if ((column?.type !== "text" && column?.type !== "timestamptz") ||
          !isRelationalColumnValue(column.type, false, node.value))
          return yield* Result.fail(error("invalidInput"));
        demandedFields.add(node.column);
        const bound = new TextEncoder().encode(node.value);
        return { select: (_requiredNulls: ReadonlySet<string>, access?: LogicalRelationalReadAccess) => {
          const indexed = (access?.indexes ?? table.indexes).some(index => index.predicate === null &&
            index.kind !== "textEquality" && index.kind !== "jsonContainment" &&
            index.columns[0]?.columnId === node.column);
          return Result.succeed({ selections: indexed
            ? [{ column: node.column, value: { gt: node.value } }] : null, unindexedText: !indexed });
        },
          requiredNulls: new Set<string>(),
          search: null,
          matches: row => { const value = row[node.column]; return typeof value === "string" &&
            compareBytesLexicographically(new TextEncoder().encode(value), bound) > 0; } };
      }
      if (node.kind === "textLikeAscii") {
        const column = columnForName(node.column);
        if (column?.type !== "text" || !isRelationalColumnValue("text", false, node.pattern))
          return yield* Result.fail(error("invalidInput"));
        if ([...node.pattern].length > 256) return yield* Result.fail(error("limitExceeded"));
        return { select: () => Result.succeed({ selections: null, unindexedText: true }),
          requiredNulls: new Set<string>(), search: [{ column: node.column, pattern: node.pattern }],
          matches: row => { const value = row[node.column]; return typeof value === "string" &&
            matchesTextLikeAscii(value, node.pattern); } };
      }
      if (node.kind === "jsonContains") {
        const column = columnForName(node.column);
        if (column?.type !== "jsonb") return yield* Result.fail(error("invalidInput"));
        const encoded = new TextEncoder().encode(JSON.stringify(node.value));
        if (encoded.byteLength > 4096) return yield* Result.fail(error("limitExceeded"));
        demandedFields.add(node.column);
        return { select: () => Result.succeed({ selections: null, unindexedText: true }),
          requiredNulls: new Set<string>(), search: null,
          json: { column: node.column, value: node.value },
          matches: row => row[node.column] !== null && row[node.column] !== undefined &&
            jsonbContains(row[node.column]!, node.value) };
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
      const equalities = new Map<string, readonly (string | boolean)[]>();
      if (node.kind === "and") for (const child of children) for (const [column, values] of child.equalities ?? []) {
        const prior = equalities.get(column);
        equalities.set(column, prior === undefined ? values : prior.filter(value => values.includes(value)));
      }
      if (equalities.size >= 2) {
        equalityGroups.push(equalities);
        for (const index of compoundIndexes(equalities, table.indexes)) {
          const columns = Object.freeze(index.columns.map(column => column.columnId));
          demandedPoints.set(JSON.stringify(columns), columns);
        }
      }
      const jsonChild = node.kind === "and" ? children.find(child => child.json !== undefined) : undefined;
      return { select: (inheritedNulls: ReadonlySet<string>, access?: LogicalRelationalReadAccess) => Result.gen(function* () {
        const available = node.kind === "and" ? new Set([...inheritedNulls, ...requiredNulls]) : inheritedNulls;
        let selections: readonly Selection[] | null = node.kind === "and" ? null : [];
        let unindexedText = false;
        for (const child of children) {
          const candidate = yield* child.select(available, access);
          unindexedText ||= candidate.unindexedText;
          if (node.kind === "and") {
            if (candidate.selections !== null && (selections === null ||
              candidate.selections.length === 0 ||
              selections.length !== 0 && isBoundedUniquePoints(candidate.selections, access) && !isBoundedUniquePoints(selections, access) ||
              selections.length !== 0 && !isBoundedUniquePoints(selections, access) && candidate.selections.length < selections.length))
              selections = candidate.selections;
          } else selections = selections === null || candidate.selections === null ? null : [...selections, ...candidate.selections];
        }
        if (node.kind === "and") {
          if ([...equalities.values()].some(values => values.length === 0)) selections = [];
          // Retain empty and previously selected unique points. Otherwise a
          // complete admitted tuple avoids hydrating a broad scalar prefix.
          else if (selections?.length !== 0 && !isBoundedUniquePoints(selections, access)) {
            for (const index of compoundIndexes(equalities, access?.indexes ?? table.indexes)) {
              const columns = index.columns.map(column => column.columnId);
              let points: readonly (readonly (string | boolean)[])[] = [[]];
              for (const column of columns) points = points.flatMap(point => (equalities.get(column) ?? []).map(value => [...point, value]));
              const plan = pointPlan(columns, points, available, access);
              if (plan !== null) { selections = plan.selections; break; }
            }
          }
        }
        return { selections, unindexedText };
      }), requiredNulls, ...(node.kind === "and" ? { equalities } : {}),
        search: node.kind === "and"
          ? children.find(child => child.search !== null && child.search.every(pattern => hasMandatorySearchTrigram(pattern.pattern)))?.search
            ?? children.find(child => child.search !== null)?.search ?? null
          : children.length > 0 && children.every(child => child.search !== null)
            ? children.flatMap(child => child.search ?? []) : null,
        ...(jsonChild?.json === undefined ? {} : { json: jsonChild.json }),
        matches: row => node.kind === "and" ? children.every(child => child.matches(row)) : children.some(child => child.matches(row)) };
    });
    const filter = yield* visit(query.predicate ?? { kind: "and", children: [] }, 0);
    const demand: LogicalRelationalReadDemand = Object.freeze({ fields: Object.freeze([...demandedFields].toSorted()),
      nulls: Object.freeze([...demandedNulls].toSorted()), points: Object.freeze([...demandedPoints].toSorted(([left], [right]) =>
        left === right ? 0 : left < right ? -1 : 1).map(([, columns]) => columns)) });
    // Compact read frames intentionally omit native indexes. Their existing
    // scalar access facts can reveal an eligible ordered tuple; request that
    // exact nativePoint facet before compiling, without catalog enumeration.
    const pointDemand = (access?: LogicalRelationalReadAccess): LogicalRelationalReadDemand => {
      const points = new Map(demand.points.map(columns => [JSON.stringify(columns), columns]));
      for (const equalities of equalityGroups) for (const index of compoundIndexes(equalities, access?.indexes ?? table.indexes)) {
        const columns = Object.freeze(index.columns.map(column => column.columnId));
        points.set(JSON.stringify(columns), columns);
      }
      return points.size === demand.points.length ? demand : Object.freeze({ ...demand,
        points: Object.freeze([...points].toSorted(([left], [right]) => left === right ? 0 : left < right ? -1 : 1).map(([, columns]) => columns)) });
    };
    const compile = (access?: LogicalRelationalReadAccess) => Result.gen(function* () {
      const indexes = access?.indexes ?? table.indexes;
      const planned = yield* filter.select(new Set(), access);
      const searchCandidate = planned.selections?.length === 0 ? null : filter.search;
      const uniquePoint = isBoundedUniquePoints(planned.selections, access);
      const search = !uniquePoint && searchCandidate !== null && searchCandidate.every(pattern => hasMandatorySearchTrigram(pattern.pattern))
        ? searchCandidate : null;
      const json = planned.selections?.length !== 0 && !uniquePoint && filter.json !== undefined && indexes.some(index =>
        index.kind === "jsonContainment" && index.columns[0]?.columnId === filter.json?.column &&
        (index.predicate === null || index.predicate.kind === "isNull" &&
          filter.requiredNulls.has(index.predicate.column.columnId))) ? filter.json : null;
      if (planned.selections === null && searchCandidate !== null && search === null && json === null && filter.requiredNulls.size === 0)
        return yield* Result.fail(error("limitExceeded"));
      if (planned.selections === null && planned.unindexedText && filter.requiredNulls.size === 0 && search === null && json === null)
        return yield* Result.fail(error("invalidInput"));
      const selections = search !== null && json === null || planned.selections === null ? null : Object.freeze([...new Map(planned.selections.map(selection =>
        [JSON.stringify(selection), selection] as const)).values()]);
      if (storageInsertion && (selections === null || search !== null || json !== null))
        return yield* Result.fail(error("invalidInput"));
      return Object.freeze({ key, identityColumns: identity, selections, search: json !== null ? null : search, json, storageInsertion,
        requiresIndexedNullAnchor: selections === null && planned.unindexedText && search === null && json === null,
        requiredNulls: Object.freeze([...filter.requiredNulls]),
        // Native text access unions its validated patterns; JSON access uses
        // the same containment owner as the complete predicate below.
        matchesSearchAnchor: (row: JsonObject) => {
          if (json !== null) {
            const value = row[json.column];
            return value !== null && value !== undefined && jsonbContains(value, json.value);
          }
          return search?.some(pattern => {
            const value = row[pattern.column];
            return typeof value === "string" && matchesTextLikeAscii(value, pattern.pattern);
          }) ?? false;
        },
        offset: query.skip ?? 0, limit: take, direction: query.order.direction, orderColumn: orderColumnName, fields: Object.freeze([...fields]),
        inspect: (row: JsonObject, document?: CanonicalFlarexValueV1) => Result.gen(function* () {
          // Read the complete native row before projecting, including exact numeric
          // companions; projection cannot hide malformed persisted data.
          const retained = mechanics === undefined || document === undefined ? undefined : yield* inspectLogicalRelationalCanonicalRow(
            mechanics, document, row, "storedCorruption").pipe(Result.mapError(cause => error(cause.reason, cause.cause)));
          if (retained === undefined) {
            const { _id: _internalId, _creationTime: _internalTime, ...native } = row;
            yield* validate(native, "storedCorruption");
          }
          if (storageInsertion) return { matches: filter.matches(row), order: new Uint8Array() };
          if (orderColumn === undefined) return yield* Result.fail(error("invalidInput"));
          const value = row[orderColumnName];
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
    return Object.freeze({ demand, pointDemand, compile });
  });
}
