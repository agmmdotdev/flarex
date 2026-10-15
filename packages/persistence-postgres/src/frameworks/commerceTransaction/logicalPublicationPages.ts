import { Result } from "effect";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import type { CatalogTableId, CatalogUniqueConstraintDefinitionId } from "flarex-protocol/catalog";
import type { OrderedIndexKeyHexV1 } from "flarex-protocol/ordered-index";
import { MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1, MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1 } from "../../storage/materialization/limits";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../../storage/unique/appUniqueConstraintCommitV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../../storage/unique/appUniqueConstraintDefinitions";
import type { LogicalDocumentAttempt, LogicalDocumentChange } from "../../storage/documents/logicalDocuments/workingSet";
import { commerceError } from "./model";

export interface LogicalCommercePublicationRowCost { readonly indexes: number; readonly unique: number }

function pack(groups: readonly (readonly LogicalDocumentChange[])[], costs: ReadonlyMap<CatalogTableId, LogicalCommercePublicationRowCost>) {
  return Result.gen(function* () {
    const pages: LogicalDocumentChange[][] = [];
    let page: LogicalDocumentChange[] = [], indexes = 0, unique = 0;
    for (const group of groups) {
      let groupIndexes = 0, groupUnique = 0;
      for (const row of group) {
        const cost = costs.get(row.tableId);
        if (cost === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
        groupIndexes += cost.indexes; groupUnique += cost.unique;
      }
      if (group.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1 || groupIndexes > MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1
        || groupUnique > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1) return yield* Result.fail(commerceError("limitExceeded"));
      if (page.length + group.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1
        || indexes + groupIndexes > MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1
        || unique + groupUnique > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1) {
        pages.push(page); page = []; indexes = 0; unique = 0;
      }
      page.push(...group); indexes += groupIndexes; unique += groupUnique;
    }
    pages.push(page);
    return pages;
  });
}

/** Mixed packets need explicit publication admission, independently of the
 * existing source working-set budget. The 2,048-row batch profile retains its
 * original mixed-write refusal. Key bytes come from the unique owner. */
export function planLogicalCommercePublicationPages(
  changes: readonly LogicalDocumentChange[], attempts: readonly LogicalDocumentAttempt[],
  definitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
  costs: ReadonlyMap<CatalogTableId, LogicalCommercePublicationRowCost>, maximumIdentities: number, logicalPublication?: "mixed",
) {
  return Result.gen(function* () {
    const ordinary = yield* pack(changes.map(change => [change]), costs);
    const allCreated = changes.every(change => change.kind === "live" && (change.dependency.kind === "generatedInsertion" ||
      change.dependency.observed.kind === "missing" && change.dependency.observed.basis.kind === "noVisibleRevision"));
    const allDeleted = changes.every(change => change.kind === "deleted" && change.dependency.kind === "appRowPoint" && change.dependency.observed.kind === "present");
    if (ordinary.length <= 1 || allCreated || allDeleted) return ordinary;
    if (logicalPublication !== "mixed" || maximumIdentities > 256 || changes.length > maximumIdentities || changes.length > 256)
      return yield* Result.fail(commerceError("limitExceeded", { maximumIdentities, changes: changes.length, pages: ordinary.length }));
    const parents = changes.map((_, index) => index);
    const root = (index: number): number => {
      let current = index;
      while (parents[current] !== current) {
        const parent = parents[current];
        if (parent === undefined) throw new Error("Publication component lost an identity");
        current = parent;
      }
      return current;
    };
    const originals = new Map<LogicalDocumentChange["documentId"], LogicalDocumentAttempt>();
    for (const attempt of attempts) if (!originals.has(attempt.documentId)) originals.set(attempt.documentId, attempt);
    // The nested maps distinguish the already canonical constraint/locale/key
    // identities. They introduce no hash, key codec or foreign equality rule.
    const claims = new Map<CatalogUniqueConstraintDefinitionId, Map<string, Map<OrderedIndexKeyHexV1, number>>>();
    for (const [index, change] of changes.entries()) {
      const first = originals.get(change.documentId);
      if (first === undefined || first.tableId !== change.tableId) return yield* Result.fail(commerceError("invalidAuthority"));
      const previous = change.dependency.kind === "appRowPoint" && change.dependency.observed.kind === "present" ? first.before : null;
      if (change.dependency.kind === "appRowPoint" && change.dependency.observed.kind === "present" && previous === null)
        return yield* Result.fail(commerceError("invalidAuthority"));
      for (const definition of definitions.filter(candidate => candidate.tableId === change.tableId)) {
        const locales = claims.get(definition.uniqueConstraintDefinitionId) ?? new Map<string, Map<OrderedIndexKeyHexV1, number>>();
        claims.set(definition.uniqueConstraintDefinitionId, locales);
        for (const document of [previous, change.kind === "live" ? change.document : null]) {
          if (document === null) continue;
          const key = yield* lowerCanonicalAppUniqueConstraintV1Result(definition, document)
            .pipe(Result.mapError(cause => commerceError("storedCorruption", cause)));
          if (key.kind !== "claim") continue;
          const slots = locales.get(key.localeKey) ?? new Map<OrderedIndexKeyHexV1, number>();
          locales.set(key.localeKey, slots);
          const owner = slots.get(key.encodedKey);
          if (owner === undefined) slots.set(key.encodedKey, index);
          else parents[root(index)] = root(owner);
        }
      }
    }
    const components = new Map<number, LogicalDocumentChange[]>();
    for (const [index, change] of changes.entries()) {
      const identity = root(index), group = components.get(identity) ?? [];
      group.push(change); components.set(identity, group);
    }
    // Stable first occurrence orders components; members keep source row order.
    // Facts are emitted separately in the original source order by the owner.
    const groups = [...components.values()];
    return yield* pack(groups, costs).pipe(Result.mapError(error => error.reason !== "limitExceeded" ? error :
      commerceError("limitExceeded", { maximumIdentities, changes: changes.length, pages: ordinary.length,
        componentRows: groups.reduce((maximum, group) => Math.max(maximum, group.length), 0) })));
  });
}
