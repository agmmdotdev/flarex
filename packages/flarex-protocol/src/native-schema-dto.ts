/** Convex common/schemas/json.rs DatabaseSchemaJson at db914cf06; FSL-1.1-Apache-2.0. */
import { Result } from "effect";
import { decodeValidatorSourceDto, type SourceIssue, type SourceJsonNode, type SourceResult,
  type ValidatorSourceDto } from "./validator-source";

export interface IndexSchemaSourceDto {
  readonly indexDescriptor: string;
  readonly fields: readonly string[];
}
export interface TextIndexSchemaSourceDto {
  readonly indexDescriptor: string;
  readonly searchField: string;
  readonly filterFields: readonly string[];
}
export interface VectorIndexSchemaSourceDto {
  readonly indexDescriptor: string;
  readonly vectorField: string;
  readonly dimensions?: number;
  readonly dimension?: number;
  readonly filterFields: readonly string[];
}
export interface TableDefinitionSourceDto {
  readonly tableName: string;
  readonly indexes: readonly IndexSchemaSourceDto[];
  readonly stagedDbIndexes: readonly IndexSchemaSourceDto[];
  readonly searchIndexes: readonly TextIndexSchemaSourceDto[];
  readonly stagedSearchIndexes: readonly TextIndexSchemaSourceDto[];
  readonly vectorIndexes: readonly VectorIndexSchemaSourceDto[];
  readonly stagedVectorIndexes: readonly VectorIndexSchemaSourceDto[];
  readonly documentType?: ValidatorSourceDto;
  readonly stagedDocumentType?: ValidatorSourceDto;
}
export interface DatabaseSchemaSourceDto {
  readonly tables: readonly TableDefinitionSourceDto[];
  readonly schemaValidation?: boolean;
}

const issue = (path: string, message: string): SourceIssue => ({ phase: "raw", reason: "invalidSchemaDto", path, message });
const failure = (path: string, message: string) => Result.fail(issue(path, message));
const fromSource = <T>(value: SourceResult<T>): Result.Result<T, SourceIssue> =>
  value.ok ? Result.succeed(value.value) : Result.fail(value.issue);
const string = (node: SourceJsonNode, path: string): Result.Result<string, SourceIssue> =>
  node.kind === "scalar" && typeof node.value === "string" ? Result.succeed(node.value) : failure(path, "Expected a string");
const boolean = (node: SourceJsonNode, path: string): Result.Result<boolean, SourceIssue> =>
  node.kind === "scalar" && typeof node.value === "boolean" ? Result.succeed(node.value) : failure(path, "Expected a boolean");
const uint32 = (node: SourceJsonNode, path: string): Result.Result<number, SourceIssue> =>
  node.kind === "scalar" && typeof node.value === "number" && Number.isInteger(node.value)
    && node.value >= 0 && node.value <= 0xffff_ffff
    && (node.numberToken === undefined || /^(?:0|[1-9][0-9]*)$/.test(node.numberToken))
    ? Result.succeed(node.value) : failure(path, "Expected an unsigned 32-bit integer");
const nullable = <T>(decode: (node: SourceJsonNode, path: string) => Result.Result<T, SourceIssue>) =>
  (node: SourceJsonNode, path: string): Result.Result<T | undefined, SourceIssue> =>
    node.kind === "scalar" && node.value === null ? Result.succeed(undefined) : decode(node, path);
function array<T>(node: SourceJsonNode, path: string,
  decode: (node: SourceJsonNode, path: string) => Result.Result<T, SourceIssue>): Result.Result<readonly T[], SourceIssue> {
  return Result.gen(function* () {
    if (node.kind !== "array") return yield* failure(path, "Expected an array");
    const values: T[] = [];
    for (const [ordinal, item] of node.items.entries()) values.push(yield* decode(item, `${path}[${ordinal}]`));
    return Object.freeze(values);
  });
}
const strings = (node: SourceJsonNode, path: string) => array(node, path, string);

/** Serde structs accept maps or sequences; map fields decode before a later duplicate is inspected. */
function fields(node: SourceJsonNode, path: string, names: readonly string[],
  visit: (name: string, node: SourceJsonNode, path: string) => Result.Result<void, SourceIssue>): Result.Result<void, SourceIssue> {
  return Result.gen(function* () {
    if (node.kind === "object") {
      const seen = new Set<string>();
      for (const [name, value] of node.entries) {
        if (!names.includes(name)) continue;
        if (seen.has(name)) return yield* failure(`${path}.${name}`, `Duplicate field ${name}`);
        seen.add(name);
        yield* visit(name, value, `${path}.${name}`);
      }
      return;
    }
    if (node.kind !== "array") return yield* failure(path, "Expected a schema struct");
    for (const [ordinal, value] of node.items.entries()) {
      const name = names[ordinal];
      if (name === undefined) return yield* failure(path, "Too many schema struct sequence elements");
      yield* visit(name, value, `${path}[${ordinal}]`);
    }
  });
}

function index(node: SourceJsonNode, path: string): Result.Result<IndexSchemaSourceDto, SourceIssue> {
  return Result.gen(function* () {
    let indexDescriptor: string | undefined;
    let indexFields: readonly string[] | undefined;
    yield* fields(node, path, ["indexDescriptor", "fields"], (name, value, childPath) => name === "indexDescriptor"
      ? Result.map(string(value, childPath), result => { indexDescriptor = result; })
      : Result.map(strings(value, childPath), result => { indexFields = result; }));
    if (indexDescriptor === undefined) return yield* failure(path, "Missing indexDescriptor");
    if (indexFields === undefined) return yield* failure(path, "Missing fields");
    return Object.freeze({ indexDescriptor, fields: indexFields });
  });
}
function textIndex(node: SourceJsonNode, path: string): Result.Result<TextIndexSchemaSourceDto, SourceIssue> {
  return Result.gen(function* () {
    let indexDescriptor: string | undefined;
    let searchField: string | undefined;
    let filterFields: readonly string[] | undefined;
    yield* fields(node, path, ["indexDescriptor", "searchField", "filterFields"], (name, value, childPath) => {
      if (name === "indexDescriptor") return Result.map(string(value, childPath), result => { indexDescriptor = result; });
      if (name === "searchField") return Result.map(string(value, childPath), result => { searchField = result; });
      return Result.map(strings(value, childPath), result => { filterFields = Object.freeze([...new Set(result)].toSorted()); });
    });
    if (indexDescriptor === undefined || searchField === undefined || filterFields === undefined)
      return yield* failure(path, "Missing text index field");
    return Object.freeze({ indexDescriptor, searchField, filterFields });
  });
}
function vectorIndex(node: SourceJsonNode, path: string): Result.Result<VectorIndexSchemaSourceDto, SourceIssue> {
  return Result.gen(function* () {
    let indexDescriptor: string | undefined;
    let vectorField: string | undefined;
    let dimensions: number | undefined;
    let dimension: number | undefined;
    let filterFields: readonly string[] | undefined;
    yield* fields(node, path, ["indexDescriptor", "vectorField", "dimensions", "dimension", "filterFields"], (name, value, childPath) => {
      if (name === "indexDescriptor") return Result.map(string(value, childPath), result => { indexDescriptor = result; });
      if (name === "vectorField") return Result.map(string(value, childPath), result => { vectorField = result; });
      if (name === "dimensions") return Result.map(nullable(uint32)(value, childPath), result => { dimensions = result; });
      if (name === "dimension") return Result.map(nullable(uint32)(value, childPath), result => { dimension = result; });
      return Result.map(strings(value, childPath), result => { filterFields = result; });
    });
    if (indexDescriptor === undefined || vectorField === undefined || filterFields === undefined)
      return yield* failure(path, "Missing vector index field");
    return Object.freeze({ indexDescriptor, vectorField, filterFields,
      ...(dimensions === undefined ? {} : { dimensions }), ...(dimension === undefined ? {} : { dimension }) });
  });
}
const validator = (node: SourceJsonNode, path: string) => fromSource(decodeValidatorSourceDto(node, path));
function table(node: SourceJsonNode, path: string): Result.Result<TableDefinitionSourceDto, SourceIssue> {
  return Result.gen(function* () {
    let tableName: string | undefined;
    let indexes: readonly IndexSchemaSourceDto[] | undefined;
    let stagedDbIndexes: readonly IndexSchemaSourceDto[] | undefined;
    let searchIndexes: readonly TextIndexSchemaSourceDto[] | undefined;
    let stagedSearchIndexes: readonly TextIndexSchemaSourceDto[] | undefined;
    let vectorIndexes: readonly VectorIndexSchemaSourceDto[] | undefined;
    let stagedVectorIndexes: readonly VectorIndexSchemaSourceDto[] | undefined;
    let documentType: ValidatorSourceDto | undefined;
    let stagedDocumentType: ValidatorSourceDto | undefined;
    yield* fields(node, path, ["tableName", "indexes", "stagedDbIndexes", "searchIndexes", "stagedSearchIndexes",
      "vectorIndexes", "stagedVectorIndexes", "documentType", "stagedDocumentType"], (name, value, childPath) => {
      switch (name) {
        case "tableName": return Result.map(string(value, childPath), result => { tableName = result; });
        case "indexes": return Result.map(array(value, childPath, index), result => { indexes = result; });
        case "stagedDbIndexes": return Result.map(nullable((item, itemPath) => array(item, itemPath, index))(value, childPath), result => { stagedDbIndexes = result; });
        case "searchIndexes": return Result.map(nullable((item, itemPath) => array(item, itemPath, textIndex))(value, childPath), result => { searchIndexes = result; });
        case "stagedSearchIndexes": return Result.map(nullable((item, itemPath) => array(item, itemPath, textIndex))(value, childPath), result => { stagedSearchIndexes = result; });
        case "vectorIndexes": return Result.map(nullable((item, itemPath) => array(item, itemPath, vectorIndex))(value, childPath), result => { vectorIndexes = result; });
        case "stagedVectorIndexes": return Result.map(nullable((item, itemPath) => array(item, itemPath, vectorIndex))(value, childPath), result => { stagedVectorIndexes = result; });
        case "documentType": return Result.map(nullable(validator)(value, childPath), result => { documentType = result; });
        default: return Result.map(nullable(validator)(value, childPath), result => { stagedDocumentType = result; });
      }
    });
    if (tableName === undefined || indexes === undefined) return yield* failure(path, "Missing tableName or indexes");
    return Object.freeze({ tableName, indexes, stagedDbIndexes: stagedDbIndexes ?? Object.freeze([]),
      searchIndexes: searchIndexes ?? Object.freeze([]), stagedSearchIndexes: stagedSearchIndexes ?? Object.freeze([]),
      vectorIndexes: vectorIndexes ?? Object.freeze([]), stagedVectorIndexes: stagedVectorIndexes ?? Object.freeze([]),
      ...(documentType === undefined ? {} : { documentType }), ...(stagedDocumentType === undefined ? {} : { stagedDocumentType }) });
  });
}

/** Complete DatabaseSchemaJson deserialization precedes every validator/name/index semantic conversion. */
export function decodeDatabaseSchemaSourceDto(node: SourceJsonNode): SourceResult<DatabaseSchemaSourceDto> {
  return Result.match(Result.gen(function* () {
    let tables: readonly TableDefinitionSourceDto[] | undefined;
    let schemaValidation: boolean | undefined;
    yield* fields(node, "$", ["tables", "schemaValidation"], (name, value, path) => name === "tables"
      ? Result.map(array(value, path, table), result => { tables = result; })
      : Result.map(nullable(boolean)(value, path), result => { schemaValidation = result; }));
    if (tables === undefined) return yield* failure("$", "Missing tables");
    return Object.freeze({ tables, ...(schemaValidation === undefined ? {} : { schemaValidation }) });
  }), { onSuccess: value => ({ ok: true, value }), onFailure: error => ({ ok: false, issue: error }) });
}
