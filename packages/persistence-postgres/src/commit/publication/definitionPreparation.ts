import type { CatalogTableId } from "flarex-protocol/catalog";
import type { LocatedAppIndexDefinitionV1 } from "../../storage/indexes/appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../../storage/unique/appUniqueConstraintDefinitions";

declare const preparationBrand: unique symbol;
/** Retained immutable definition mechanics. This token grants no admission,
 * locking or publication authority; the Application/source issuer owns it. */
export interface PreparedPublicationDefinitions { readonly [preparationBrand]: true }
interface PreparationState {
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly indexesByTable: ReadonlyMap<CatalogTableId, readonly number[]>;
  readonly uniqueByTable: ReadonlyMap<CatalogTableId, readonly number[]>;
  readonly definitions: Readonly<{ indexes: readonly LocatedAppIndexDefinitionV1[];
    unique: readonly LocatedAppUniqueConstraintDefinitionV1[] }>;
}
const preparations = new WeakMap<PreparedPublicationDefinitions, PreparationState>();
export function preparePublicationDefinitions(indexes: readonly LocatedAppIndexDefinitionV1[],
  unique: readonly LocatedAppUniqueConstraintDefinitionV1[]): PreparedPublicationDefinitions {
  const indexesByTable = new Map<CatalogTableId, number[]>(), uniqueByTable = new Map<CatalogTableId, number[]>();
  for (const [ordinal, definition] of indexes.entries()) {
    const members = indexesByTable.get(definition.access.tableId) ?? [];
    members.push(ordinal); indexesByTable.set(definition.access.tableId, members);
  }
  for (const [ordinal, definition] of unique.entries()) {
    const members = uniqueByTable.get(definition.tableId) ?? [];
    members.push(ordinal); uniqueByTable.set(definition.tableId, members);
  }
  // SAFETY: only this issuer registers a retained immutable preparation.
  const prepared = Object.freeze({}) as PreparedPublicationDefinitions;
  const definitions = Object.freeze({ indexes: Object.freeze([...indexes]), unique: Object.freeze([...unique]) });
  preparations.set(prepared, { ...definitions, definitions,
    indexesByTable: new Map([...indexesByTable].map(([tableId, ordinals]) => [tableId, Object.freeze(ordinals)])),
    uniqueByTable: new Map([...uniqueByTable].map(([tableId, ordinals]) => [tableId, Object.freeze(ordinals)])) });
  return prepared;
}
/** An original source issuer lends these immutable lists to its operation
 * authority without rebuilding the same definition arrays for each method. */
export function readPreparedPublicationDefinitions(prepared: PreparedPublicationDefinitions) {
  return preparations.get(prepared)?.definitions ?? null;
}
/** Binding touched membership is new for each contribution. Original definition
 * order preserves the first invalid definition/collision; later lock ordering
 * remains the settlement owner's distinct domain order. */
export function selectPreparedPublicationDefinitions(prepared: PreparedPublicationDefinitions,
  tableIds: ReadonlySet<CatalogTableId>) {
  const state = preparations.get(prepared);
  if (state === undefined) return null;
  const indexOrdinals: number[] = [], uniqueOrdinals: number[] = [];
  for (const tableId of tableIds) {
    indexOrdinals.push(...state.indexesByTable.get(tableId) ?? []);
    uniqueOrdinals.push(...state.uniqueByTable.get(tableId) ?? []);
  }
  indexOrdinals.sort((left, right) => left - right);
  uniqueOrdinals.sort((left, right) => left - right);
  const indexes: LocatedAppIndexDefinitionV1[] = [], unique: LocatedAppUniqueConstraintDefinitionV1[] = [];
  for (const ordinal of indexOrdinals) {
    const definition = state.indexes[ordinal];
    if (definition === undefined) return null;
    indexes.push(definition);
  }
  for (const ordinal of uniqueOrdinals) {
    const definition = state.unique[ordinal];
    if (definition === undefined) return null;
    unique.push(definition);
  }
  return { indexes, unique };
}
/** The issuer charges these additional retained ordinal maps, not the already
 * charged genuine catalog definitions which they reference. */
export function readPublicationDefinitionPreparationPayload(prepared: PreparedPublicationDefinitions) {
  const state = preparations.get(prepared);
  return state === undefined ? null : { indexesByTable: structuredClone([...state.indexesByTable]),
    uniqueByTable: structuredClone([...state.uniqueByTable]) };
}
export function disposePublicationDefinitions(prepared: PreparedPublicationDefinitions): void {
  preparations.delete(prepared);
}
