import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { expect, inject, it } from "vitest";
import { nativeServiceZoneSourceTargets } from "./support/native-service-zone-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  files: Schema.Array(Schema.Struct({ target: Schema.String, targetSha256: Schema.String })),
}));

it("resolves the promoted native Zone workflows and their executing step imports", () => {
  const evidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema)(inject("nativeServiceZoneSource"));
  expect(evidence.entries).toHaveLength(nativeServiceZoneSourceTargets.length);
  const manifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
  const { files } = decodeManifest(JSON.parse(readFileSync(manifest, "utf8")));
  for (const entry of evidence.entries) {
    for (const [target, targetSha256] of [[entry.entry, entry.entrySha256], [entry.leaf, entry.leafSha256]]) {
      expect(files.filter(file => file.target === target)).toEqual([{ target, targetSha256 }]);
    }
  }
});
