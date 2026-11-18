import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { expect, inject, it } from "vitest";
import { nativeShippingOptionRuleSourceTargets } from "./support/native-shipping-option-rule-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  files: Schema.Array(Schema.Struct({ target: Schema.String, targetSha256: Schema.String })),
}));

it("resolves the promoted Rule Batch and all executing native step imports", () => {
  const evidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema)(inject("nativeShippingOptionRuleSource"));
  expect(evidence.entries).toHaveLength(nativeShippingOptionRuleSourceTargets.length);
  const manifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
  const { files } = decodeManifest(JSON.parse(readFileSync(manifest, "utf8")));
  for (const entry of evidence.entries) {
    for (const [target, targetSha256] of [[entry.entry, entry.entrySha256], [entry.leaf, entry.leafSha256]]) {
      expect(files.filter(file => file.target === target)).toEqual([{ target, targetSha256 }]);
    }
  }
});