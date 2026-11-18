import assert from "node:assert/strict";
import { Schema } from "effect";
import type { MixedMutationPerformanceSeries } from "./mixedMutationProductFixture";

const decodeBusiness = Schema.decodeUnknownSync(Schema.Struct({
  updated: Schema.Struct({ id: Schema.String, title: Schema.String, handle: Schema.String, status: Schema.String }),
  pending: Schema.Struct({ id: Schema.String, title: Schema.String }),
}));
const decodeListed = Schema.decodeUnknownSync(Schema.Struct({ listed: Schema.Array(Schema.Struct({ id: Schema.String })) }));
const decodeApplicationId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const decodeApplicationDocument = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }));

/** Shared fixture verification, outside every request interval. */
export async function verifyMixedProductResult(outcome: Awaited<ReturnType<MixedMutationPerformanceSeries["runAttempt"]>>,
  profile: "product" | "productPayload" | "workflow") {
  assert.equal(outcome.publication.kind, "published");
  if (outcome.publication.kind !== "published") throw new Error("Missing publication");
  assert.deepEqual(outcome.publication.successfulResult.valueJson, outcome.returnedValue);
  assert.equal(outcome.workerConstructionMilliseconds, 0);
  assert.ok(outcome.canonicalResultBytes > 0);
  const business = decodeBusiness(outcome.returnedValue);
  const expected = { id: outcome.seed.productId, title: outcome.seed.newTitle,
    handle: outcome.seed.newHandle, status: "published" };
  assert.deepEqual(business.updated, expected);
  assert.deepEqual(business.pending, { id: expected.id, title: expected.title });
  const committedProduct = await outcome.fixture.readCurrentProduct();
  assert.deepEqual(decodeBusiness({ updated: committedProduct, pending: business.pending }).updated, expected);
  assert.notEqual(await outcome.fixture.readSettlementLedger(), null);
  if (profile !== "workflow") assert.deepEqual(decodeListed(outcome.returnedValue).listed, [{ id: expected.id }]);
  if (profile === "product") {
    const { id } = decodeApplicationId(outcome.returnedValue);
    assert.deepEqual(decodeApplicationDocument(await outcome.fixture.readCurrentApplicationDocument(id)), { name: expected.title });
  }
  return committedProduct;
}
