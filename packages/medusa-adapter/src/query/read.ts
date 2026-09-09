import { Effect } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { populateCommerceRelations, readCommerceRelationRows } from "../commerce-relations";
import { resolveCommerceRelationFilter } from "../commerce-relation-filter";
import type { ReadCatalog } from "./catalog";
import { projectRows, type ReadProjection } from "./projection";

export type ReadContext = Pick<CommerceCommandContext, "manager" | "table" | "resources">;
export interface CatalogSelection {
  readonly rows: readonly JsonObject[];
  readonly count: number;
}
export type ReadWindow =
  | { readonly kind: "database"; readonly countAt: "beforePopulation" | "afterPopulation" }
  | { readonly kind: "catalog"; readonly order: string; readonly select: (rows: readonly JsonObject[]) => CatalogSelection };
export interface ReadPlan {
  readonly table: string;
  readonly query: JsonObject & { readonly predicate: { readonly kind: "and"; readonly children: readonly Json[] } };
  readonly projection: ReadProjection;
  readonly paths: readonly string[];
  readonly withDeleted: boolean;
  readonly relationFilters: readonly { readonly path: string; readonly predicate: Json }[];
  readonly ordering: ReadonlyMap<string, string>;
  readonly window: ReadWindow;
}

/** One scoped execution path. Catalog transforms are pure domain extensions;
 * they receive complete owned rows and cannot obtain a manager or issue SQL. */
export const executeRead: (
  ctx: ReadContext, catalog: ReadCatalog, plan: ReadPlan, withCount: boolean,
  boundStore?: CommerceCommandContext["store"],
) => Effect.Effect<{ readonly rows: JsonObject[]; readonly count: number | undefined }, CommerceTransactionError> = Effect.fn("MedusaRead.execute")(function* (
  ctx: ReadContext, catalog: ReadCatalog, plan: ReadPlan, withCount: boolean,
  boundStore?: CommerceCommandContext["store"],
) {
  const table = yield* Effect.fromResult(catalog.table(plan.table));
  // Table acquisition consumes a request call. Reuse an explicitly supplied
  // command-bound store; otherwise acquire before relation lookups as before.
  const window: BoundReadWindow = plan.window.kind === "catalog" ? plan.window
    : { ...plan.window, store: boundStore ?? (yield* ctx.table(plan.table)) };
  let query = plan.query;
  if (plan.relationFilters.length > 0) {
    const key = table.primaryKeys[0];
    if (table.primaryKeys.length !== 1 || key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const children: Json[] = [...query.predicate.children];
    for (const filter of plan.relationFilters) children.push({ kind: "in", column: key,
      values: yield* resolveCommerceRelationFilter(ctx, plan.table, filter.path, filter.predicate, catalog.relations, plan.withDeleted),
    });
    query = { ...query, predicate: { kind: "and", children } };
  }
  const selection = yield* readWindow(ctx, plan.table, query, window);
  const countBefore = plan.window.kind === "catalog" || plan.window.countAt === "beforePopulation";
  let count = withCount && countBefore ? yield* selection.count : undefined;
  const populated = yield* populateCommerceRelations(ctx, plan.table, selection.rows, plan.paths, catalog.relations, plan.ordering, plan.withDeleted);
  const rows = yield* Effect.fromResult(projectRows(populated, plan.projection.node));
  if (withCount && !countBefore) count = yield* selection.count;
  return { rows, count };
});

type BoundReadWindow = Extract<ReadWindow, { readonly kind: "catalog" }>
  | (Extract<ReadWindow, { readonly kind: "database" }> & { readonly store: CommerceCommandContext["store"] });

/** Keep the store and deferred count inside this request's execution boundary. */
const readWindow = Effect.fn("MedusaRead.window")(function* (
  ctx: ReadContext, table: string, query: ReadPlan["query"], window: BoundReadWindow,
) {
  if (window.kind === "catalog") {
    const rows = yield* readCommerceRelationRows(ctx, table, query.predicate, window.order);
    const selected = window.select(rows);
    return { rows: selected.rows, count: Effect.succeed(selected.count) };
  }
  const rows = yield* window.store.find(ctx.manager, query);
  return { rows, count: Effect.suspend(() => window.store.count(ctx.manager, query)) };
});

export function orderedCatalog(direction: "asc" | "desc"): (rows: readonly JsonObject[]) => CatalogSelection {
  return rows => ({ rows: direction === "desc" ? [...rows].reverse() : rows, count: rows.length });
}
