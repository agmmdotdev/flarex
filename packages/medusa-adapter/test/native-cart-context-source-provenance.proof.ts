import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { expect, inject, it } from "vitest";
import { findOneOrAnyRegionStep, findOneOrAnyRegionStepId } from "@medusajs/core-flows/cart/find-one-or-any-region-step";
import { findSalesChannelStep, findSalesChannelStepId } from "@medusajs/core-flows/cart/find-sales-channel-step";
import { validateSalesChannelStep } from "@medusajs/core-flows/cart/validate-sales-channel-step";
import { Country, Region } from "@medusajs/region/models";
import { RegionModuleService } from "@medusajs/region/services";
import { regionModuleExports, regionModuleModels, regionStaticResources } from "@medusajs/region/static-manifest";
import { Store, StoreCurrency, StoreLocale } from "@medusajs/store/models";
import { StoreModuleService } from "@medusajs/store/services";
import { storeModuleExports, storeModuleModels, storeStaticResources } from "@medusajs/store/static-manifest";
import { SalesChannel } from "@medusajs/sales-channel/models";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { salesChannelModuleExports, salesChannelModuleModels, salesChannelStaticResources } from "@medusajs/sales-channel/static-manifest";
import { compileRegionCoreDefinition, compileRegionDefinition } from "../src/modules/region/schema";
import { nativeCartContextSourceTargets } from "./support/native-cart-context-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  files: Schema.Array(Schema.Struct({ target: Schema.String, targetSha256: Schema.String })),
}));

it("executes the promoted Region, Store and Sales Channel sources and all three native Cart context steps", () => {
  const evidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema)(inject("nativeCartContextSource"));
  expect(evidence.entries).toHaveLength(nativeCartContextSourceTargets.length);
  const manifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
  const { files } = decodeManifest(JSON.parse(readFileSync(manifest, "utf8")));
  for (const entry of evidence.entries) {
    for (const [target, targetSha256] of [[entry.entry, entry.entrySha256], [entry.leaf, entry.leafSha256]]) {
      expect(files.filter(file => file.target === target)).toEqual([{ target, targetSha256 }]);
    }
  }
  expect(regionModuleExports.service).toBe(RegionModuleService);
  expect(regionStaticResources.models).toBe(regionModuleModels);
  expect(regionModuleModels).toEqual([Region, Country]);
  expect(storeModuleExports.service).toBe(StoreModuleService);
  expect(storeStaticResources.models).toBe(storeModuleModels);
  expect(storeModuleModels).toEqual([Store, StoreCurrency, StoreLocale]);
  expect(salesChannelModuleExports.service).toBe(SalesChannelModuleService);
  expect(salesChannelStaticResources.models).toBe(salesChannelModuleModels);
  expect(salesChannelModuleModels).toEqual([SalesChannel]);
  expect(findOneOrAnyRegionStepId).toBe("find-one-or-any-region");
  expect(findSalesChannelStepId).toBe("find-sales-channel");
  for (const step of [findOneOrAnyRegionStep, findSalesChannelStep, validateSalesChannelStep]) {
    expect(step).toBeTypeOf("function");
  }
});

it("authenticates the complete Region source with ordered Country identity, uniqueness and nullable Region reference", async () => {
  const target = { scopeUuid: "24e6ff2f-9610-488a-9544-a524c1b92d8e", epochUuid: "4c86656f-a9d5-417c-a78c-bee23f8c1d1a" };
  const [native, compiled] = await Effect.runPromise(Effect.all([compileRegionCoreDefinition(target), compileRegionDefinition()]));
  const localNames = ["region", "region_country"];
  expect(native.identity).toMatchObject({ ...target, sourceKey: "medusa.region" });
  expect(native.source).toMatchObject({ key: "medusa.region", writeProfile: "medusa.region", owner: "medusa",
    definition: { kind: "relational", schema: compiled.schema }, evidence: { provenance: compiled.provenance, profile: "medusa.region" } });
  expect(native.applicationRead).toBe(false);
  expect(native.commands).toEqual([]);
  expect(native.source.bindings.toSorted((left, right) => left.localName.localeCompare(right.localName))).toEqual(localNames.map(localName => ({
    kind: "definition", localName, table: { namespace: "medusa", logicalName: "commerce.region/" + localName },
  })));
  expect(native.tables.map(table => table.localName).toSorted()).toEqual(localNames);
  const region = native.tables.find(table => table.localName === "region");
  const country = native.tables.find(table => table.localName === "region_country");
  if (region === undefined || country === undefined) throw new Error("Missing authenticated Region closure");
  expect(region.rowKey?.fields).toEqual(["id"]);
  expect(country.rowKey?.fields).toEqual(["iso_2"]);
  expect(country.indexes).toContainEqual({ kind: "key", nativeId: "region_country.primary",
    indexName: country.rowKey?.indexName, fields: ["iso_2"] });
  expect(compiled.schema.tables.find(table => table.identity.tableId === "region_country")?.columns
    .find(column => column.identity.columnId === "region_id")).toMatchObject({ type: "text", nullable: true });
  const unique = country.uniqueConstraints?.find(constraint => constraint.fields.join(",") === "region_id,iso_2");
  const eligibility = { field: "deleted_at", value: null };
  expect(unique).toMatchObject({ fields: ["region_id", "iso_2"], nullsDistinct: true, eligibility });
  expect(country.indexes).toContainEqual({ kind: "index", nativeId: unique?.descriptor, indexName: unique?.indexName,
    fields: ["deleted_at", "region_id", "iso_2"], requiredPrefix: eligibility });
  const reference = country.indexes?.find(index => index.nativeId === "region_country_region_id_index");
  expect(reference).toEqual({ kind: "index", nativeId: "region_country_region_id_index",
    indexName: expect.any(String), fields: ["region_id"] });
  expect(country.foreignKeys).toMatchObject([{
    sourceTable: country.name, sourceFields: ["region_id"], targetTable: region.name, targetFields: ["id"],
    sourceIndexName: reference?.indexName, targetIndexName: region.rowKey?.indexName, onDelete: "noAction",
  }]);
});
