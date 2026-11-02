import { randomUUID } from "node:crypto";
import { Effect, Result } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { compilePricingCoreDefinition } from "../../src/modules/pricing/schema";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { compileVariantPricingLinkCoreDefinition } from "../../src/composition/product-variant-pricing-schema";
import { prepareVariantPricingLink } from "../../src/links/variant-pricing-service";
import { createCoreNativeWorkflowFixture } from "./core-native-workflow-fixture";
import { coreNativeRelationalRow } from "../../../persistence-postgres/src/core/nativeRelationalQuery";

type PricingRuntime = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
type LinkRuntime = Effect.Success<ReturnType<typeof prepareVariantPricingLink>>;
interface PricingMaintenanceInput {
  readonly pricing: PricingRuntime;
  readonly seedRows: readonly Readonly<{ table: string; row: JsonObject }>[];
  readonly link?: LinkRuntime;
  readonly linkRows?: readonly Readonly<{ table: string; row: JsonObject }>[];
}

/** Complete native Pricing and its standalone flat Link share one Core owner.
 * This fixture assembles production owners and observes their actual evidence.
 * Canonical Core revisions replace old row-change observations; ordinary index
 * entries and complete private event families/deliveries replace the displaced
 * physical-family snapshots. Committed nativeRoot outcomes prove settlement. */
export async function prepareCorePricingMaintenance(driver: "pglite" | "postgres",
  close: (cleanup: () => Promise<void>) => void, input: PricingMaintenanceInput) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const pricingDefinition = await Effect.runPromise(compilePricingCoreDefinition(target));
  const linkDefinition = await Effect.runPromise(compileVariantPricingLinkCoreDefinition(target));
  const link = input.link ?? await Effect.runPromise(prepareVariantPricingLink());
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [
    { name: "pricing", definition: pricingDefinition, initialCommands: input.pricing.commands, rows: input.seedRows },
    { name: "variant_pricing_link", definition: linkDefinition, initialCommands: link.commands, rows: input.linkRows ?? [] },
  ] });
  close(fixture.close);
  const tableNames = new Map([...pricingDefinition.tables, ...linkDefinition.tables].map(table =>
    [table.name, table.localName ?? table.name]));
  const readRows = async (ids?: readonly string[]) => {
    const selected = ids === undefined ? undefined : new Set(ids);
    return (await fixture.inventory()).rows.flatMap(entry => {
      const table = tableNames.get(entry.table);
      if (table === undefined) return [];
      const row = structuredClone(Result.getOrThrow(coreNativeRelationalRow(entry.value)));
      if (typeof row.id !== "string") throw new Error("Missing stored native business identity");
      if (selected !== undefined && !selected.has(row.id)) return [];
      return [{ table, row }];
    }).toSorted((left, right) => (left.table + "/" + left.row.id).localeCompare(right.table + "/" + right.row.id));
  };
  const readStorageOrder = async (tableName: string, ids: readonly string[]) => {
    const table = pricingDefinition.tables.find(table => table.localName === tableName);
    if (table === undefined) throw new Error("Unknown Pricing storage-order table");
    const selected = new Set(ids);
    return (await fixture.inventory()).rows.filter(row => row.table === table.name)
      .map(row => {
        const id = row.value.id, internalId = row.value._id, creationTime = row.value._creationTime;
        if (typeof id !== "string" || typeof internalId !== "string" || typeof creationTime !== "number" || !Number.isFinite(creationTime))
          throw new Error("Missing actual Core insertion identity/time");
        return { id, internalId, creationTime };
      }).filter(row => selected.has(row.id)).toSorted((left, right) => left.creationTime - right.creationTime
        || (left.internalId < right.internalId ? -1 : left.internalId > right.internalId ? 1 : 0)).map(row => row.id);
  };
  return { fixture, target, execution: fixture.execution, pricingDefinition, linkDefinition,
    pricing: { runtime: input.pricing, source: fixture.source("pricing") },
    link: { runtime: link, source: fixture.source("variant_pricing_link") },
    read: async (ids?: readonly string[]) => (await readRows(ids)).map(entry => entry.row)
      .toSorted((left, right) => String(left.id).localeCompare(String(right.id))), readRows, readStorageOrder };
}
