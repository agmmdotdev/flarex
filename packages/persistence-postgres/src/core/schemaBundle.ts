import { Effect, Result, Schema } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { requirePreparedApplicationSchemaSource, type PreparedApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { encodeLogicalSchemaSource, logicalTableKey, type QualifiedLogicalTable } from "flarex-protocol/internal/logical-schema-candidate";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { captureCoreSchema, CoreSchemaError, type CoreSchemaDefinition } from "./schemaTypes";
import { captureCoreTableNamespace, coreNamespaceKey, type CoreTableNamespace } from "./namespace";
import { isCoreNativeDefinitionSuccessor, requireCoreNativeDefinition, type CoreNativeDefinition } from "./nativePolicy";
import { encodeValidatorJsonV1 } from "flarex-protocol/validator-json";
import { coreNativeTableName } from "./schemaTableName";
import { serializeCoreSchema } from "./schemaJson";
import { compileCoreApplicationIndexes } from "../application/coreSchema";

export interface CoreSchemaTableBinding {
  readonly sourceKey: string;
  readonly localName: string;
  readonly table: QualifiedLogicalTable;
  readonly coreTableName: string;
}
export type CoreSchemaSource =
  | Readonly<{ kind: "application"; definition: PreparedApplicationSchemaSource }>
  | Readonly<{ kind: "native"; definition: CoreNativeDefinition }>;
export interface CoreSchemaBundle {
  readonly namespace: CoreTableNamespace;
  readonly schema: CoreSchemaDefinition;
  readonly sources: readonly CoreSchemaSource[];
  readonly bindings: readonly CoreSchemaTableBinding[];
  readonly nativeDefinitions: readonly CoreNativeDefinition[];
  readonly metadata: string;
}
const bundles = new WeakSet<CoreSchemaBundle>();
const unsupported = (message: string, cause?: unknown) => new CoreSchemaError({ reason: "unsupportedCapability", message,
  ...(cause === undefined ? {} : { cause }) });
const canonical = (value: Json) => encodeCanonicalJson(value, issue => { throw new Error(`Schema bundle lost JSON: ${issue.reason}`); });
const SourceEnvelope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("application"), definition: Schema.declare<PreparedApplicationSchemaSource>(
    (value): value is PreparedApplicationSchemaSource => Result.isSuccess(requirePreparedApplicationSchemaSource(value))) }),
  Schema.Struct({ kind: Schema.Literal("native"), definition: Schema.declare<CoreNativeDefinition>(
    (value): value is CoreNativeDefinition => Result.isSuccess(requireCoreNativeDefinition(value))) }),
]);
const decodeSourceEnvelope = Schema.decodeUnknownResult(SourceEnvelope, { onExcessProperty: "error" });
const decodeSourceCount = Schema.decodeUnknownResult(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })));

/** Capture only the envelope. Opaque definitions retain their exact issuer
 * identity; foreign getters and wrappers never survive into asynchronous work. */
function captureSchemaSources(input: readonly CoreSchemaSource[]): Result.Result<readonly CoreSchemaSource[], CoreSchemaError> {
  return Result.gen(function* () {
    if (!Array.isArray(input))
      return yield* Result.fail(unsupported("Schema bundle source limit exceeded"));
    const length = yield* Result.try({ try: () => Object.getOwnPropertyDescriptor(input, "length"),
      catch: cause => unsupported("Schema source count could not be captured", cause) });
    const count = yield* Result.mapError(decodeSourceCount(length?.value), cause => unsupported("Schema bundle source limit exceeded", cause));
    const sources: CoreSchemaSource[] = [];
    for (let index = 0; index < count; index++) {
      const envelope = yield* Result.try({ try: () => {
        const item = Object.getOwnPropertyDescriptor(input, String(index));
        if (item === undefined || !item.enumerable || !("value" in item)) return undefined;
        const value: unknown = item.value;
        if (value === null || typeof value !== "object") return undefined;
        const properties = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(properties).length !== 2) return undefined;
        const kind = properties.kind, definition = properties.definition;
        if (kind === undefined || definition === undefined || !kind.enumerable || !definition.enumerable
          || !("value" in kind) || !("value" in definition)) return undefined;
        const capturedKind: unknown = kind.value, capturedDefinition: unknown = definition.value;
        return { kind: capturedKind, definition: capturedDefinition };
      }, catch: cause => unsupported("Schema source envelope could not be captured", cause) });
      const source = yield* Result.mapError(decodeSourceEnvelope(envelope), cause => unsupported("Schema source has no matching issuer proof", cause));
      sources.push(Object.freeze(source));
    }
    return Object.freeze(sources);
  });
}

export function requireCoreSchemaBundle(bundle: CoreSchemaBundle): Result.Result<void, CoreSchemaError> {
  return bundles.has(bundle) ? Result.succeed(undefined) : Result.fail(unsupported("Schema bundle was not issued by the source owner"));
}
export function coreSchemaBundleNative(bundle: CoreSchemaBundle, definition: CoreNativeDefinition): boolean {
  return bundles.has(bundle) && Result.isSuccess(requireCoreNativeDefinition(definition))
    && bundle.nativeDefinitions.some(candidate => candidate.metadata === definition.metadata);
}

/** Expected targets are captured by the trusted database constructor; an issued
 * source bundle alone does not authorize adding it to that database. */
export function coreSchemaBundleExpectedTarget(bundle: CoreSchemaBundle, namespace: CoreTableNamespace,
  expectedBundles: readonly CoreSchemaBundle[]): boolean {
  return bundles.has(bundle) && coreNamespaceKey(bundle.namespace) === coreNamespaceKey(namespace)
    && expectedBundles.some(expected => bundles.has(expected) && expected.metadata === bundle.metadata);
}

function compatibleApplicationSource(prior: CoreSchemaSource, next: CoreSchemaSource): boolean {
  if (prior.kind !== "application" || next.kind !== "application") return false;
  const before = prior.definition.source, after = next.definition.source;
  if (before.key !== after.key || before.owner !== after.owner || before.writeProfile !== after.writeProfile
    || before.definition.kind !== "documents" || after.definition.kind !== "documents"
    || canonical(before.bindings) !== canonical(after.bindings)
    || canonical(before.definition.indexes) !== canonical(after.definition.indexes)
    || canonical(before.definition.uniqueConstraints) !== canonical(after.definition.uniqueConstraints)
    || before.definition.relations.length !== 0 || after.definition.relations.length !== 0
    || before.definition.tables.length !== after.definition.tables.length) return false;
  let additions = 0;
  return before.definition.tables.every((table, position) => {
    const candidate = after.definition.kind === "documents" ? after.definition.tables[position] : undefined;
    if (candidate === undefined || table.logicalName !== candidate.logicalName) return false;
    const previous = table.definition.documentType, validator = candidate.definition.documentType;
    if (canonical(encodeValidatorJsonV1(previous)) === canonical(encodeValidatorJsonV1(validator))) return true;
    if (previous.type !== "object" || validator.type !== "object") return false;
    const extra = Object.keys(validator.value).filter(field => !Object.hasOwn(previous.value, field));
    if (extra.length !== 1 || ++additions !== 1) return false;
    const field = extra[0];
    if (field === undefined || validator.value[field]?.optional !== true || validator.value[field]?.fieldType.type !== "string") return false;
    const fields = Object.fromEntries(Object.entries(validator.value).filter(([key]) => key !== field));
    return canonical(encodeValidatorJsonV1(previous)) === canonical(encodeValidatorJsonV1({ type: "object", value: fields }));
  });
}

/** Structural compatibility only. Installation separately requires the complete
 * target bundle in the trusted expected-source set captured by the database. */
export function isCoreSchemaBundleSuccessor(prior: CoreSchemaBundle, next: CoreSchemaBundle): boolean {
  if (Result.isFailure(requireCoreSchemaBundle(prior)) || Result.isFailure(requireCoreSchemaBundle(next))
    || coreNamespaceKey(prior.namespace) !== coreNamespaceKey(next.namespace)) return false;
  if (prior.metadata === next.metadata) return true;
  const added = next.sources.filter(source => !prior.sources.some(previous => previous.definition.source.key === source.definition.source.key));
  if (next.sources.length !== prior.sources.length + added.length || added.length > 1 || added.some(source => source.kind !== "native")) return false;
  return prior.sources.every(source => {
    const candidate = next.sources.find(selected => selected.definition.source.key === source.definition.source.key);
    if (candidate === undefined || source.kind !== candidate.kind || source.definition.source.key !== candidate.definition.source.key) return false;
    return source.kind === "native" && candidate.kind === "native"
      ? added.length === 0 ? isCoreNativeDefinitionSuccessor(source.definition, candidate.definition) : source.definition.metadata === candidate.definition.metadata
      : added.length === 0 ? compatibleApplicationSource(source, candidate)
        : source.definition.source.sourceSha256 === candidate.definition.source.sourceSha256;
  });
}

/** Trusted source composition before Source's existing single-schema lifecycle. */
export const makeCoreSchemaBundle = Effect.fn("CoreSchemaBundle.make")(function* (input: Readonly<{
  namespace?: CoreTableNamespace;
  sources: readonly CoreSchemaSource[];
}>) {
  // Both captures execute before the first Effect yield. Async digest calls may
  // not reread mutable caller envelopes after their source proof was checked.
  const capturedNamespace = captureCoreTableNamespace(input.namespace ?? null);
  const capturedSources = captureSchemaSources(input.sources);
  const namespace = yield* Effect.fromResult(capturedNamespace)
    .pipe(Effect.mapError(cause => unsupported("Invalid schema bundle namespace", cause)));
  const sources = (yield* Effect.fromResult(capturedSources))
    .toSorted((left, right) => compareUtf16Strings(left.definition.source.key, right.definition.source.key));
  if (new Set(sources.map(source => source.definition.source.key)).size !== sources.length)
    return yield* unsupported("Schema bundle sources require distinct keys");
  const nativeDefinitions = sources.flatMap(source => source.kind === "native" ? [source.definition] : []);
  const target = nativeDefinitions[0]?.identity;
  if (target !== undefined && nativeDefinitions.some(definition => definition.identity.scopeUuid !== target.scopeUuid
    || definition.identity.epochUuid !== target.epochUuid)) return yield* unsupported("Schema bundle native targets differ");
  const bindings: CoreSchemaTableBinding[] = [], tables: CoreSchemaDefinition["tables"][number][] = [];
  const names = new Set<string>(), coordinates = new Set<string>();
  for (const selected of sources) {
    const source = selected.definition.source;
    if (source.bindings.some(binding => binding.kind !== "definition")) return yield* unsupported("Schema bundle views are not admitted");
    if (selected.kind === "application") {
      if (source.definition.kind !== "documents" || source.definition.relations.length !== 0)
        return yield* unsupported("Schema-only Application relationships are not admitted");
      const definition = source.definition;
      if (definition.indexes.some(index => (index.decimalFields?.length ?? 0) > 0))
        return yield* unsupported("Application decimal indexes are not admitted");
      const compiled = [];
      for (const table of definition.tables) {
        const indexes = yield* Effect.fromResult(compileCoreApplicationIndexes(definition.indexes
          .filter(index => index.tableLogicalName === table.logicalName)
          .map(index => ({ name: index.descriptor, fields: index.fields }))))
          .pipe(Effect.mapError(cause => unsupported("Application index lowering failed", cause)));
        compiled.push({ tableName: table.logicalName, documentType: table.definition.documentType, indexes, stagedDbIndexes: [] });
      }
      const schema = yield* Effect.fromResult(captureCoreSchema({ schemaValidation: true, tables: compiled }));
      tables.push(...schema.tables);
    } else tables.push(...selected.definition.schema.tables);
    for (const binding of source.bindings) {
      const coreTableName = yield* coreNativeTableName(binding.table);
      const coordinate = logicalTableKey(binding.table);
      if (names.has(coreTableName) || coordinates.has(coordinate)) return yield* unsupported("Schema source table identities collide");
      if (selected.kind === "native" && !selected.definition.tables.some(table => table.name === coreTableName
        && (table.localName ?? table.name) === binding.localName)) return yield* unsupported("Native source table binding differs from its definition");
      names.add(coreTableName); coordinates.add(coordinate);
      bindings.push(Object.freeze({ sourceKey: source.key, localName: binding.localName,
        table: Object.freeze({ ...binding.table }), coreTableName }));
    }
  }
  if (bindings.length > 256 || tables.length !== bindings.length || tables.some(table => !names.has(table.tableName)))
    return yield* unsupported("Schema bundle table closure differs from source bindings");
  const schema = yield* Effect.fromResult(captureCoreSchema({ schemaValidation: true, tables }));
  const metadata = canonical({ format: "flarex.core-schema-bundle", version: 1, loweringVersion: 1, namespace,
    sources: sources.map(source => source.kind === "application" ? { kind: source.kind, source: encodeLogicalSchemaSource(source.definition.source) }
      : { kind: source.kind, source: encodeLogicalSchemaSource(source.definition.source), native: source.definition.metadata }),
    bindings: bindings.map(binding => ({ ...binding, table: { ...binding.table } })),
    schema: yield* Effect.fromResult(serializeCoreSchema(schema)) });
  const bundle: CoreSchemaBundle = Object.freeze({ namespace, schema,
    sources: Object.freeze(sources.map(source => Object.freeze({ ...source }))), bindings: Object.freeze(bindings),
    nativeDefinitions: Object.freeze(nativeDefinitions), metadata });
  bundles.add(bundle);
  return bundle;
});
