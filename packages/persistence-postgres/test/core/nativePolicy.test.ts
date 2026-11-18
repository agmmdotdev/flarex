import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { CoreNativeTablePolicySchema } from "../../src/core/nativePolicyTypes";

const identity = {
  scopeUuid: "45000000-0000-4000-8000-000000000001",
  epochUuid: "45000000-0000-4000-8000-000000000002",
  sourceKey: "payload",
  sourceSha256: "a".repeat(64), configSha256: "b".repeat(64),
  provenanceSha256: "c".repeat(64), definitionHash: "d".repeat(64),
} as const;

// Schema structure is tested independently of source authenticity. Real cold
// bootstrap and source/policy agreement are exercised by the captured store.
describe("stored native policy wire boundaries", () => {
  const accepts = Schema.is(CoreNativeTablePolicySchema);
  const schemaId = Result.getOrThrow(encodeDocumentId(532, new Uint8Array(16).fill(1)));
  const policy = (constraint: unknown) => ({ state: "active", schemaId, identity,
    applicationRead: false, uniqueConstraints: [constraint] });

  it("refuses ambiguous mixed unary/tuple clauses and unrecognized constraint policy", () => {
    const unique = { descriptor: "u_title", field: "title", indexName: "by_title" };
    expect(accepts(policy(unique))).toBe(true);
    expect(accepts(policy({ descriptor: "u_tuple", fields: ["category", "amount"],
      indexName: "by_tuple", nullsDistinct: false }))).toBe(true);
    expect(accepts(policy({ ...unique, fields: ["title"], nullsDistinct: false }))).toBe(false);
    expect(accepts(policy({ ...unique, nullsDistinct: true }))).toBe(false);
    expect(accepts(policy({ descriptor: "u_tuple", fields: ["category", "amount"],
      indexName: "by_tuple", nullsDistinct: false, sparse: true }))).toBe(false);
  });
});
