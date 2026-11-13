import { Result } from "effect";
import type { Effect } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { captureJoinerServiceConfigs } from "@medusajs/orchestration/joiner";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { decodeCompiledDml } from "../schema/compiled";
import { captureCommerceInput } from "../value/input";
import type { GraphModuleDefinition } from "./model";

const nativeMetadataBrand: unique symbol = Symbol("Medusa.nativeGraphMetadata");
export interface NativeGraphMetadata {
  readonly [nativeMetadataBrand]: true;
  readonly identity: Json;
}
type DmlTable = Effect.Success<ReturnType<typeof decodeCompiledDml>>["tables"][number];
type Tables = readonly (Pick<DmlTable, "name"> & Partial<Pick<DmlTable, "relationships">>)[];
const issued = new WeakMap<object, Readonly<{
  metadata: NativeGraphMetadata;
  configs: readonly ModuleJoinerConfig[];
  entityRelations: ReadonlyMap<string, ReadonlyMap<string, string>>;
}>>();

function issueMetadata(configs: readonly ModuleJoinerConfig[], entityRelations: ReadonlyMap<string, ReadonlyMap<string, string>>) {
  return Result.gen(function* () {
    const snapshot = yield* Result.try({ try: () => captureJoinerServiceConfigs(configs),
      catch: cause => commerceError("unsupportedProfile", cause) });
    const identity = yield* captureCommerceInput({ configs: snapshot,
      entityRelations: [...entityRelations].map(([entity, relations]) => ({ entity, relations: Object.fromEntries(relations) })) });
    const native: NativeGraphMetadata = Object.freeze({ [nativeMetadataBrand]: true as const, identity });
    issued.set(native, { metadata: native, configs: snapshot, entityRelations });
    return native;
  });
}

/** Actual module/link declarations supply query semantics. Checked DML supplies
 * relation model names; neither metadata source grants a command capability. */
export function withNativeGraphMetadata(graph: GraphModuleDefinition, configs: readonly ModuleJoinerConfig[], tables: Tables) {
  return Result.gen(function* () {
    if (graph.reads.some(read => read.paths.length > 0 && tables.find(table => table.name === read.table.name)?.relationships === undefined))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const modelByTable = new Map<string, string>();
    const retain = (table: string, model: string) => {
      const previous = modelByTable.get(table);
      if (previous !== undefined && previous !== model) return Result.fail(commerceError("unsupportedProfile"));
      modelByTable.set(table, model);
      return Result.succeed(undefined);
    };
    for (const read of graph.reads) yield* retain(read.table.name, read.model);
    for (const table of tables) for (const relation of table.relationships ?? [])
      yield* retain(relation.targetTable, relation.targetModel);
    const entityRelations = new Map<string, ReadonlyMap<string, string>>();
    for (const table of tables) {
      const model = modelByTable.get(table.name);
      if (model === undefined) continue;
      entityRelations.set(model, new Map((table.relationships ?? []).map(relation => [relation.name, relation.targetModel])));
    }
    const native = yield* issueMetadata(configs, entityRelations);
    return { ...graph, native };
  });
}

/** Read-only native Link extensions are metadata, without another stored source
 * or read grant. Composition retains their exact declarations alongside owners. */
export function extendNativeGraphMetadata(graph: GraphModuleDefinition, configs: readonly ModuleJoinerConfig[]) {
  return Result.gen(function* () {
    const metadata = graph.native === undefined ? undefined : issued.get(graph.native);
    if (metadata === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    return { ...graph, native: yield* issueMetadata([...metadata.configs, ...configs], metadata.entityRelations) };
  });
}

/** Immutable issuer evidence survives module composition; native execution gets
 * fresh copies because RemoteJoiner owns its reference-building mutations. */
export function captureGraphNativeMetadata(value: unknown) {
  const metadata = typeof value === "object" && value !== null ? issued.get(value)?.metadata : undefined;
  return metadata === undefined ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(metadata);
}
export function graphNativeConfiguration(metadata: NativeGraphMetadata) {
  const value = issued.get(metadata);
  return value === undefined ? Result.fail(commerceError("invalidAuthority")) : Result.succeed({
    servicesConfig: captureJoinerServiceConfigs(value.configs), entitiesMap: new Map<string, unknown>(),
    entityRelations: new Map([...value.entityRelations].map(([entity, relations]) => [entity, new Map(relations)])),
  });
}
