/** Convex common/bootstrap_model/schema_registry.rs at db914cf06; FSL-1.1-Apache-2.0. */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Option, Result } from "effect";
import { encodeIndexValue } from "flarex-protocol/index-key";
import { incrementIndexKeyPrefix } from "flarex-protocol/index-range";
import type { CoreIndexRef, CoreInterval, CorePersistenceError } from "./contracts";
import { coreNamespaceKey, type CoreTableNamespace } from "./namespace";
import type { CoreSystemDocument } from "./transaction";
import { coreSchemaCorrupt, decodeCoreSchemaMetadata, type CoreSchemaDefinition,
  type CoreSchemaMetadata, type CoreSchemaUniqueState } from "./schemaTypes";
import { parseCoreSchema } from "./schemaJson";

export interface CoreSchemaSelection {
  readonly id: string;
  readonly creationTime: number;
  readonly metadata: CoreSchemaMetadata;
  readonly schema: CoreSchemaDefinition;
}
interface RegistryEntry {
  readonly id: string;
  readonly creationTime: number;
  readonly metadata: CoreSchemaMetadata;
  readonly parsed: () => Result.Result<CoreSchemaDefinition, CorePersistenceError>;
}
export interface CoreSchemaRegistryUpdate {
  readonly namespace: CoreTableNamespace;
  readonly oldDocument?: CoreSystemDocument;
  readonly newDocument?: CoreSystemDocument;
}

const uniqueState = (metadata: CoreSchemaMetadata): CoreSchemaUniqueState | undefined => {
  const state = metadata.state.state;
  return state === "pending" || state === "validated" || state === "active" ? state : undefined;
};
const key = (namespace: CoreTableNamespace, state: CoreSchemaUniqueState): string => `${coreNamespaceKey(namespace)}:${state}`;

function entryFor(document: CoreSystemDocument, metadata: CoreSchemaMetadata): RegistryEntry {
  let cached: CoreSchemaDefinition | undefined;
  const owned = Object.freeze({ ...metadata, state: Object.freeze({ ...metadata.state }) });
  return Object.freeze({ id: document.id, creationTime: document.creationTime, metadata: owned,
    parsed: (): Result.Result<CoreSchemaDefinition, CorePersistenceError> => {
      if (cached !== undefined) return Result.succeed(cached);
      return parseCoreSchema(owned.schema).pipe(Result.mapError(coreSchemaCorrupt), Result.map(schema => {
        cached = schema;
        return schema;
      }));
    } });
}

/** COW roots retain snapshot state; only successful schema parsing is memoized. */
export class CoreSchemaRegistry {
  private constructor(private readonly entries: BTree<string, RegistryEntry>) {}

  static empty(): CoreSchemaRegistry { return new CoreSchemaRegistry(new BTree<string, RegistryEntry>()); }

  static bootstrap(rows: readonly { readonly namespace: CoreTableNamespace; readonly document: CoreSystemDocument }[]):
  Result.Result<CoreSchemaRegistry, CorePersistenceError> {
    return CoreSchemaRegistry.empty().apply(rows.map(({ namespace, document }) => ({ namespace, newDocument: document })));
  }

  apply(updates: readonly CoreSchemaRegistryUpdate[]): Result.Result<CoreSchemaRegistry, CorePersistenceError> {
    return Result.gen(this, function* () {
      const decoded = [];
      for (const update of updates) {
        const old = update.oldDocument === undefined ? undefined
          : yield* Result.mapError(decodeCoreSchemaMetadata(update.oldDocument.value), coreSchemaCorrupt);
        const next = update.newDocument === undefined ? undefined
          : yield* Result.mapError(decodeCoreSchemaMetadata(update.newDocument.value), coreSchemaCorrupt);
        decoded.push({ update, old, next });
      }
      const entries = this.entries.clone();
      // Atomic activation can replace the active ID in either document ordering.
      for (const { update, old } of decoded) {
        const state = old === undefined ? undefined : uniqueState(old);
        if (state === undefined) continue;
        const entryKey = key(update.namespace, state);
        const current = entries.get(entryKey);
        if (current === undefined || current.id !== update.oldDocument?.id)
          return yield* Result.fail(coreSchemaCorrupt("Schema registry old row mismatch"));
        entries.delete(entryKey);
      }
      for (const { update, next } of decoded) {
        const state = next === undefined ? undefined : uniqueState(next);
        if (state === undefined || next === undefined || update.newDocument === undefined) continue;
        const entryKey = key(update.namespace, state);
        if (entries.has(entryKey)) return yield* Result.fail(coreSchemaCorrupt("Duplicate unique schema state"));
        entries.set(entryKey, entryFor(update.newDocument, next));
      }
      for (const { update } of decoded) if (entries.has(key(update.namespace, "pending")) && entries.has(key(update.namespace, "validated")))
        return yield* Result.fail(coreSchemaCorrupt("Pending and validated schemas coexist"));
      return new CoreSchemaRegistry(entries);
    });
  }

  withDocument(namespace: CoreTableNamespace, oldDocument?: CoreSystemDocument, newDocument?: CoreSystemDocument):
  Result.Result<CoreSchemaRegistry, CorePersistenceError> {
    return this.apply([{ namespace, ...(oldDocument === undefined ? {} : { oldDocument }),
      ...(newDocument === undefined ? {} : { newDocument }) }]);
  }

  getByState(namespace: CoreTableNamespace, state: CoreSchemaUniqueState, stateIndex: CoreIndexRef,
    recordRead: (indexId: Uint8Array, interval: CoreInterval) => void): Result.Result<Option.Option<CoreSchemaSelection>, CorePersistenceError> {
    return Result.gen(this, function* () {
      const start = yield* Result.mapError(encodeIndexValue({ state }), coreSchemaCorrupt);
      // Observe absence as well as presence. The indexed value is a state object.
      recordRead(stateIndex.id, { start, end: incrementIndexKeyPrefix(start) });
      const entry = this.entries.get(key(namespace, state));
      if (entry === undefined) return Option.none();
      const schema = yield* entry.parsed();
      return Option.some(Object.freeze({ id: entry.id, creationTime: entry.creationTime, metadata: entry.metadata, schema }));
    });
  }

  /** Trusted registry authentication does not eagerly parse unrelated Source-only schemas. */
  nativeByState(namespace: CoreTableNamespace, state: CoreSchemaUniqueState): Result.Result<Option.Option<CoreSchemaSelection>, CorePersistenceError> {
    const entry = this.entries.get(key(namespace, state));
    if (entry?.metadata.native === undefined) return Result.succeed(Option.none());
    return Result.map(entry.parsed(), schema => Option.some(Object.freeze({ id: entry.id, creationTime: entry.creationTime,
      metadata: entry.metadata, schema })));
  }
}
