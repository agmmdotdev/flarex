import { Result, Schema } from "effect";
import { CatalogTableNamespaceSchema } from "./catalog";
import { encodeCanonicalJson, isJson, JsonValue } from "./json";
import { snapshotDecodedProtocolPlainData } from "./decoded-protocol-snapshot";
import { RelationDeclarationsV1Schema } from "./relation-declaration-v1";
import {
  SchemaManifestAppTableDeclarationV1Schema,
  SchemaManifestAppIndexDeclarationV1Schema,
  SchemaManifestJsonSchema,
  decodeSchemaManifestAppTableDeclarationsV1Result,
  decodeSchemaManifestAppIndexDeclarationsV1Result,
  schemaManifestAppValidatorCanContainFieldPathV1,
} from "./schema-manifest";
import {
  normalizeRelationalSchema,
  relationalSchemaSourceFromDefinition,
  type RelationalSchema,
} from "./relational-schema/index";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
export const MAX_LOGICAL_SCHEMA_CANDIDATE_TABLES = 256;
export const MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES = 4_194_304;
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512),
  Schema.makeFilter(value => value.trim().length > 0 && !value.includes("\0")));
const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const QualifiedLogicalTableSchema = Schema.Struct({
  namespace: CatalogTableNamespaceSchema,
  logicalName: Name,
}).annotate(strict);
export type QualifiedLogicalTable = typeof QualifiedLogicalTableSchema.Type;

// This boundary receives owned JSON from the manifest capture owner. Reconstruct
// through the existing bounded semantic normalizer and compare EVERY identity,
// predicate and capability, including fields the reconstruction does not read.
const RelationalDefinition = Schema.declare<RelationalSchema>((value): value is RelationalSchema => {
  if (!isJson(value)) return false;
  const normalized = normalizeRelationalSchema(relationalSchemaSourceFromDefinition(value));
  return Result.isSuccess(normalized) && canonical(value) === canonical(normalized.success);
});
const DocumentDefinition = Schema.Struct({
  kind: Schema.Literal("documents"),
  tables: Schema.Array(SchemaManifestAppTableDeclarationV1Schema).check(Schema.isMaxLength(10_000)),
  indexes: Schema.Array(SchemaManifestAppIndexDeclarationV1Schema).check(Schema.isMaxLength(10_000)),
  relations: RelationDeclarationsV1Schema,
}).annotate(strict);
const SourceDefinition = Schema.Union([
  DocumentDefinition,
  Schema.Struct({ kind: Schema.Literal("relational"), schema: RelationalDefinition }).annotate(strict),
]);
const SourceBinding = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("definition"), localName: Name, table: QualifiedLogicalTableSchema }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("view"), localName: Name, table: QualifiedLogicalTableSchema,
    mode: Schema.Literal("readOnly") }).annotate(strict),
]);
export const LogicalSchemaSourceSchema = Schema.Struct({
  key: Name,
  owner: Schema.Literals(["application", "payload", "medusa", "system"]),
  // Verified native provenance/configuration or Application analysis evidence.
  // These are values, not function-source authority or installation artifacts.
  evidence: JsonValue,
  sourceSha256: Sha256,
  writeProfile: Name,
  definition: SourceDefinition,
  bindings: Schema.Array(SourceBinding).check(Schema.isMaxLength(10_000)),
}).annotate(strict);
const Endpoint = Schema.Struct({ table: QualifiedLogicalTableSchema, field: Name }).annotate(strict);
export const LogicalSchemaExtensionSchema = Schema.Struct({
  name: Name,
  sourceKey: Name,
  source: Endpoint,
  target: Endpoint,
  policy: Schema.Literal("strongReference"),
  // This records a dependency requirement; traversal/enforcement stays unready.
  onTargetDelete: Schema.Literal("restrict"),
}).annotate(strict);

export const LogicalSchemaCandidateSchema = Schema.Struct({
  kind: Schema.Literal("logicalSchemaCandidate"),
  definitionVersion: Schema.Literal(1),
  state: Schema.Literal("candidate"),
  deploymentId: Name,
  scopeId: Name,
  applicationAnalysis: Schema.Struct({ candidateId: Name, analysisId: Name,
    manifestSha256: Sha256, sourceArtifactRootSha256: Sha256 }).annotate(strict),
  sources: Schema.Array(LogicalSchemaSourceSchema).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  extensions: Schema.Array(LogicalSchemaExtensionSchema).check(Schema.isMaxLength(1024)),
}).annotate(strict);
export type LogicalSchemaCandidate = typeof LogicalSchemaCandidateSchema.Type;
export type LogicalSchemaSource = typeof LogicalSchemaSourceSchema.Type;
export type LogicalSchemaExtension = typeof LogicalSchemaExtensionSchema.Type;
export type LogicalSchemaBinding = typeof SourceBinding.Type;

export function logicalTableKey(table: QualifiedLogicalTable): string {
  return JSON.stringify([table.namespace, table.logicalName]);
}

const decodeCandidate = Schema.decodeUnknownResult(LogicalSchemaCandidateSchema.check(
  Schema.makeFilter(validateCandidate),
));

/** Structural/semantic validation only. Trusted composition must verify sources. */
export function decodeLogicalSchemaCandidate(input: unknown) {
  return Result.gen(function* () {
    // Reuse the no-getter, bounded protocol JSON capture before inspecting data.
    const json = yield* Schema.decodeUnknownResult(SchemaManifestJsonSchema)(input);
    const candidate = yield* decodeCandidate(json);
    return snapshotDecodedProtocolPlainData(candidate);
  });
}

type DefinitionBinding = Readonly<{ source: LogicalSchemaSource; binding: LogicalSchemaBinding }>;

function validateCandidate(candidate: LogicalSchemaCandidate): string | undefined {
  if (candidate.sources.reduce((count, source) => count + source.bindings.length, 0) > MAX_LOGICAL_SCHEMA_CANDIDATE_TABLES) {
    return "Candidate definition budget exceeded";
  }
  const sources = new Map<string, LogicalSchemaSource>();
  const definitions = new Map<string, DefinitionBinding>();
  for (const source of candidate.sources) {
    if (sources.has(source.key)) return "Duplicate source coordinate";
    sources.set(source.key, source);
    const definition = source.definition;
    const names = definition.kind === "documents"
      ? definition.tables.map(table => table.logicalName)
      : definition.schema.tables.map(table => table.identity.tableId);
    if (definition.kind === "relational" && definition.schema.coordinate.owner !== source.owner) {
      return "Relational producer owner mismatch";
    }
    if (definition.kind === "documents") {
      if (Result.isFailure(decodeSchemaManifestAppTableDeclarationsV1Result(definition.tables)) ||
          Result.isFailure(decodeSchemaManifestAppIndexDeclarationsV1Result(definition.indexes))) {
        return "Invalid document definitions";
      }
      for (const index of definition.indexes) {
        const table = definition.tables.find(entry => entry.logicalName === index.tableLogicalName);
        if (table === undefined || index.fields.some(field =>
          !schemaManifestAppValidatorCanContainFieldPathV1(table.definition.documentType, field))) {
          return "Invalid document index dependency";
        }
      }
    }
    if (source.bindings.length !== names.length || new Set(source.bindings.map(binding => binding.localName)).size !== names.length ||
        source.bindings.some(binding => !names.some(name => name === binding.localName))) return "Incomplete source table bindings";
    for (const binding of source.bindings) {
      if (binding.kind === "view") {
        if (source.owner !== "payload" || definition.kind !== "documents") return "Unsupported table view producer";
        continue;
      }
      const key = logicalTableKey(binding.table);
      if (definitions.has(key)) return "Competing table definitions or owners";
      definitions.set(key, { source, binding });
    }
  }
  for (const source of candidate.sources) {
    for (const binding of source.bindings) {
      if (binding.kind !== "view") continue;
      const target = definitions.get(logicalTableKey(binding.table));
      if (target === undefined || target.source.owner !== "application" ||
          target.source.definition.kind !== "documents" || source.definition.kind !== "documents") {
        return "A view must reference an existing Application definition";
      }
      const view = source.definition.tables.find(entry => entry.logicalName === binding.localName);
      const table = target.source.definition.tables.find(entry => entry.logicalName === target.binding.localName);
      if (view === undefined || table === undefined) return "Missing view definition";
      for (const [name, field] of Object.entries(view.definition.documentType.value)) {
        const targetField = table.definition.documentType.value[name];
        if (targetField === undefined || canonical(field) !== canonical(targetField)) return "Incompatible view field";
      }
      // No hidden index/relationship installation through an exposure binding.
      if (source.definition.indexes.some(index => index.tableLogicalName === binding.localName) ||
          source.definition.relations.some(relation => relation.source.table === binding.localName)) {
        return "View index or relationship changes require a separate capability";
      }
    }
    if (source.definition.kind === "documents") {
      for (const relation of source.definition.relations) {
        if (!source.bindings.some(binding => binding.localName === relation.source.table) ||
            !source.bindings.some(binding => binding.localName === relation.target.table)) return "Unresolved native relationship";
      }
    }
  }
  if (new Set(candidate.extensions.map(extension => extension.name)).size !== candidate.extensions.length) return "Duplicate extension identity";
  for (const extension of candidate.extensions) {
    const source = definitions.get(logicalTableKey(extension.source.table));
    const target = definitions.get(logicalTableKey(extension.target.table));
    if (source === undefined || target === undefined) return "Unresolved extension endpoint";
    if (source.source.key !== extension.sourceKey) return "Extension is not authorized by its source owner";
    const left = endpointKind(source, extension.source.field);
    const right = endpointKind(target, extension.target.field);
    if (left === undefined || right === undefined || left !== right) return "Incompatible extension endpoints";
  }
  return undefined;
}

function endpointKind({ source, binding }: DefinitionBinding, field: string): string | undefined {
  if (source.definition.kind === "documents") {
    if (field === "_id") return `identity:${logicalTableKey(binding.table)}`;
    const table = source.definition.tables.find(entry => entry.logicalName === binding.localName);
    const type = table?.definition.documentType.value[field]?.fieldType;
    if (type?.type === "id") {
      const target = source.bindings.find(entry => entry.localName === type.tableName);
      return target === undefined ? undefined : `identity:${logicalTableKey(target.table)}`;
    }
    return type?.type === "string" ? "text" : undefined;
  }
  const table = source.definition.schema.tables.find(entry => entry.identity.tableId === binding.localName);
  const column = table?.columns.find(entry => entry.identity.columnId === field);
  return column?.type === "text" ? "text" : undefined;
}

function canonical(value: unknown): string {
  if (!isJson(value)) throw new Error("Logical schema decoder lost JSON");
  return encodeCanonicalJson(value, issue => { throw new Error(`Logical schema JSON invariant: ${issue.reason}`); });
}
