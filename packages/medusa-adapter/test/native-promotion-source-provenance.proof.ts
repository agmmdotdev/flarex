import { readFileSync } from "node:fs";
import { Effect, Result, Schema } from "effect";
import { expect, inject, it } from "vitest";
import { portablePromotionRuleQueryFilter } from "@medusajs/promotion/prefilter";
import { PromotionModuleService } from "@medusajs/promotion/services";
import { promotionModuleExports, promotionModuleModels, promotionStaticResources } from "@medusajs/promotion/static-manifest";
import { capturePromotionMetadata, compilePromotionCoreDefinition, compilePromotionDefinition } from "../src/modules/promotion/schema";
import { preparePromotionPrefilterPort } from "../src/modules/promotion/prefilter-port";
import { nativePromotionSourceTargets } from "./support/native-promotion-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  files: Schema.Array(Schema.Struct({ target: Schema.String, targetSha256: Schema.String })),
}));

it("executes the promoted Promotion service, prefilter, model closure and DML compiler", () => {
  const evidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema)(inject("nativePromotionSource"));
  expect(evidence.entries).toHaveLength(nativePromotionSourceTargets.length);
  const manifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
  const { files } = decodeManifest(JSON.parse(readFileSync(manifest, "utf8")));
  for (const entry of evidence.entries) {
    for (const [target, targetSha256] of [[entry.entry, entry.entrySha256], [entry.leaf, entry.leafSha256]]) {
      expect(files.filter(file => file.target === target)).toEqual([{ target, targetSha256 }]);
    }
  }
  expect(promotionModuleExports.service).toBe(PromotionModuleService);
  expect(promotionStaticResources.models).toBe(promotionModuleModels);
  expect(promotionModuleModels).toHaveLength(7);
  expect(portablePromotionRuleQueryFilter).toBeTypeOf("function");
});

it("authenticates the complete Promotion source with its generated pivot identities and Rule Value key", async () => {
  const target = { scopeUuid: "98f9ef45-9cc8-4a23-883f-0be3a3a2ad69", epochUuid: "bda6935a-b2a6-4c08-b934-1f51d5301da8" };
  const [native, compiled, metadata] = await Effect.runPromise(Effect.all([
    compilePromotionCoreDefinition(target), compilePromotionDefinition(), capturePromotionMetadata(),
  ]));
  expect(native.identity).toMatchObject({ ...target, sourceKey: "medusa.promotion" });
  expect(native.source).toMatchObject({ key: "medusa.promotion", writeProfile: "medusa.promotion", owner: "medusa",
    definition: { kind: "relational", schema: compiled.schema }, evidence: { provenance: compiled.provenance, profile: "medusa.promotion" } });
  expect(native.applicationRead).toBe(false);
  expect(native.commands).toEqual([]);
  expect(native.source.bindings).toHaveLength(10);
  expect(native.tables.map(table => table.localName).toSorted()).toEqual([
    "application_method_buy_rules", "application_method_target_rules", "promotion", "promotion_application_method",
    "promotion_campaign", "promotion_campaign_budget", "promotion_campaign_budget_usage", "promotion_promotion_rule",
    "promotion_rule", "promotion_rule_value",
  ]);
  for (const [table, owner] of [["application_method_buy_rules", "application_method_id"],
    ["application_method_target_rules", "application_method_id"], ["promotion_promotion_rule", "promotion_id"]] as const) {
    const declaration = native.tables.find(candidate => candidate.localName === table);
    expect(declaration?.rowKey?.fields.toSorted()).toEqual([owner, "promotion_rule_id"]);
  }
  const port = Result.getOrThrow(preparePromotionPrefilterPort(metadata.frame));
  const rule = native.tables.find(table => table.localName === "promotion_rule");
  const value = native.tables.find(table => table.localName === "promotion_rule_value");
  expect(value?.foreignKeys).toEqual(expect.arrayContaining([expect.objectContaining({
    descriptor: port.foreignKey, sourceTable: value?.name, sourceFields: ["promotion_rule_id"],
    targetTable: rule?.name, targetFields: ["id"],
  })]));
});
