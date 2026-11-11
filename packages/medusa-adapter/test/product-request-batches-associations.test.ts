import { Cause, Effect, Result, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createAdminProductHttpHandler } from "@flarex/medusa-http/admin-product";
import { CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { CoreTransactionError } from "@flarex/persistence-postgres/internal/core";
import { MedusaError } from "@medusajs/utils/common/errors";
import { RelationalRowValueError } from "flarex-protocol/internal/relational-schema";
import { describe, expect, it } from "vitest";
import { makeProductRequestScopeFactory, type ProductRequestOperations } from "../src/http/product-request";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareVariantPricingLink } from "../src/links/variant-pricing-service";
import { prepareSalesChannelCreationWorkflow } from "../src/workflows/sales-channel/create";
import { prepareCreatePriceListsWorkflow } from "../src/workflows/pricing/create-price-lists";
import { prepareProductRequestFixture } from "./support/product-request-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const withoutProductDeleteCredential = "batch-without-product-delete";
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const ids = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })));
const variant = Schema.Struct({ id: Schema.NonEmptyString, title: Schema.String, sku: Schema.String,
  price_set: Schema.Struct({ id: Schema.NonEmptyString, prices: Schema.Array(Schema.JsonObject) }),
  inventory_items: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, variant_id: Schema.NonEmptyString,
    inventory_item_id: Schema.NonEmptyString, required_quantity: Schema.Number, inventory: Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String }) })) });
const product = Schema.Struct({ id: Schema.NonEmptyString, title: Schema.String, variants: Schema.Array(variant) });
const decodeProduct = Schema.decodeUnknownSync(product);
const graphFields = ["id", "title", "variants.id", "variants.title", "variants.sku", "variants.price_set.id", "variants.price_set.prices.*",
  "variants.inventory_items.*", "variants.inventory_items.inventory.*"];
type Tested = Awaited<ReturnType<typeof prepareProductRequestFixture>>;
type Snapshot = Awaited<ReturnType<Tested["fixture"]["snapshot"]>>;
const business = ({ outcomes: _outcomes, ...rows }: Snapshot) => rows;
const readProduct = Effect.fn("BatchAssociationProof.product")(function* (operations: ProductRequestOperations, id: string) {
  return decodeProduct((yield* operations.query.graph({ entity: "product", fields: graphFields, filters: { id } })).data[0]);
});
const nativeProduct = (prefix: string, title: string, sizes: readonly string[] = ["One"], amount: number | string = 1001) => ({ title,
  handle: prefix, options: [{ title: "Size", values: [...new Set([...sizes, "Next", "Last"])] }], variants: sizes.map(size => ({
    title: title + " " + size, sku: prefix + "-" + size, options: { Size: size }, prices: [{ currency_code: "usd", amount }],
  })) });
function nativeFailureDetails(error: unknown, depth = 0): JsonObject | null {
  if (depth >= 6) return null;
  if (error instanceof RelationalRowValueError) return { tag: error._tag, reason: error.reason, column: error.column };
  if (error instanceof CommerceTransactionError || error instanceof CoreTransactionError)
    return { tag: error._tag, reason: error.reason, cause: nativeFailureDetails(error.cause, depth + 1) };
  if (error instanceof MedusaError) return { type: error.type, cause: nativeFailureDetails(error.cause, depth + 1) };
  return error instanceof Error ? { name: error.name } : null;
}
function logNativeHttpFailure(error: unknown) {
    const fullCause = Cause.isCause(error) ? error : error instanceof Error && Cause.isCause(error.cause) ? error.cause : undefined;
    const rendered = fullCause === undefined ? error instanceof Error ? error.stack ?? error.message : String(error) : Cause.pretty(fullCause);
    const secrets = [process.env.FLAREX_POSTGRES_DATABASE_URL, process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL, "batch-admin", "batch-auth"];
    const redacted = secrets.reduce<string>((text, secret) => secret === undefined ? text : text.replaceAll(secret, "[redacted]"), rendered)
      .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, "[redacted PostgreSQL endpoint]").replace(/Bearer\s+[^\s"'<>]+/g, "Bearer [redacted]");
    const reasons = fullCause?.reasons.map(reason => {
      if (!Cause.isFailReason(reason)) return { kind: reason._tag };
      const failure = reason.error;
      return failure instanceof CommerceTransactionError ? { kind: reason._tag, error: failure._tag, reason: failure.reason,
        nativeType: failure.cause instanceof MedusaError ? failure.cause.type : undefined,
        nativeName: failure.cause instanceof Error ? failure.cause.name : undefined,
        nestedReason: failure.cause instanceof MedusaError && failure.cause.cause instanceof CommerceTransactionError ? failure.cause.cause.reason : undefined }
        : { kind: reason._tag, error: failure instanceof Error ? failure.name : typeof failure };
    });
    const details = fullCause?.reasons.map(reason => Cause.isFailReason(reason) ? nativeFailureDetails(reason.error) : { kind: reason._tag });
    console.error("Native batch and association HTTP failure", JSON.stringify({ reasons, details }), redacted);
}
const makeHttp = Effect.fn("BatchAssociationProof.http")(function* (operations: ProductRequestOperations) {
  // Native HTTP logs only 500 responses. Observe the exact read operation so
  // admitted 400 projections retain their original nested Cause as well.
  const observed = { ...operations, remoteQuery: Effect.fn("BatchAssociationProof.observeRemoteQuery")((query: unknown) =>
    operations.remoteQuery(query).pipe(Effect.tapCause(cause => Effect.sync(() => logNativeHttpFailure(cause))))) };
  const scopes = yield* makeProductRequestScopeFactory({ operations: observed, container: createContainer().register({
    logger: asValue({ error: logNativeHttpFailure, info() {} }),
  }) });
  return createAdminProductHttpHandler({ ...scopes, adminCors: "https://admin.test",
    resolveAdminPrincipal: request => request.headers.get("x-batch-fixture-token") === withoutProductDeleteCredential
      ? { actor_id: "batch-admin-without-product-delete", actor_type: "user", auth_identity_id: "batch-auth-without-product-delete",
        app_metadata: { fixture_role: "without-product-delete" }, user_metadata: {} }
      : { actor_id: "batch-admin", actor_type: "user", auth_identity_id: "batch-auth", app_metadata: {}, user_metadata: {} },
    evaluateAdminPolicies: (principal, policies) => principal.app_metadata.fixture_role !== "without-product-delete"
      || policies.every(policy => policy.resource === "product"
        && (Array.isArray(policy.operation) ? policy.operation : [policy.operation]).every(operation => ["read", "create", "update"].includes(operation))),
    admitProductRefetchFields: operations.admitProductRefetchFields,
    admitVariantRefetchFields: operations.admitVariantRefetchFields, admitCatalogRefetchFields: operations.admitCatalogRefetchFields,
    admitSalesChannelRefetchFields: operations.admitSalesChannelRefetchFields, admitPriceListRefetchFields: operations.admitPriceListRefetchFields });
});
describe(`native Product batch and association HTTP operations (${driver})`, () => {
  it("runs both native mixed and empty batches, refuses foreign update/delete before children, and rolls back failed sibling creation", async () => {
    const tested = await prepareProductRequestFixture(driver);
    const primary: unknown[] = [];
    let phase = "compose";
    try {
      await tested.use(operations => Effect.gen(function* () {
        phase = "seed";
        const seeded = yield* operations.runWorkflow("create-products", { products: [nativeProduct("http-batch-selected", "Selected", ["One", "Two"]),
          nativeProduct("http-batch-delete", "Delete"), nativeProduct("http-batch-other", "Other", ["One"], 9876)] });
        const selectedId = seeded.result[0]?.id, deletedId = seeded.result[1]?.id, otherId = seeded.result[2]?.id;
        if (selectedId === undefined || deletedId === undefined || otherId === undefined) return yield* Effect.die(new Error("Native batch seed omitted Products"));
        const selected = yield* readProduct(operations, selectedId), other = yield* readProduct(operations, otherId);
        const first = selected.variants[0], removed = selected.variants[1], foreign = other.variants[0];
        if (first === undefined || removed === undefined || foreign === undefined) return yield* Effect.die(new Error("Native batch seed omitted Variants"));
        const http = yield* makeHttp(operations);
        const post = Effect.fn("BatchAssociationProof.post")(function* (path: string, body: unknown, status = 200) {
          phase = "POST " + path;
          const response = yield* Effect.promise(() => http.handle(new Request("https://private.test" + path, { method: "POST",
            headers: { "content-type": "application/json" }, body: JSON.stringify(body) })));
          const json = object(yield* Effect.promise(() => response.json()));
          expect(response.status, JSON.stringify(json)).toBe(status);
          return json;
        });
        const productsPath = "/admin/products/batch", variantsPath = `/admin/products/${selectedId}/variants/batch`;
        const beforeDeleteDenied = yield* Effect.promise(() => tested.fixture.inventory());
        const beforeDeleteDeniedEvents = yield* Effect.promise(() => tested.fixture.snapshot());
        phase = "POST Product batch without delete permission";
        const deleteDenied = yield* Effect.promise(() => http.handle(new Request("https://private.test" + productsPath, { method: "POST",
          headers: { "content-type": "application/json", "x-batch-fixture-token": withoutProductDeleteCredential },
          body: JSON.stringify({ delete: [deletedId] }) })));
        expect(deleteDenied.status, JSON.stringify(yield* Effect.promise(() => deleteDenied.json()))).toBe(403);
        expect(yield* Effect.promise(() => tested.fixture.inventory())).toEqual(beforeDeleteDenied);
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(beforeDeleteDeniedEvents);
        const createVariant = { title: "Next", sku: "http-batch-next", options: { Size: "Next" }, prices: [{ amount: 3333, currency_code: "usd" }] };
        const tombstoneProduct = (yield* operations.runWorkflow("create-products", { products: [nativeProduct("http-batch-tombstone", "Tombstone")] })).result[0];
        if (tombstoneProduct === undefined) return yield* Effect.die(new Error("Native tombstone seed omitted Product"));
        const tombstoneVariant = (yield* readProduct(operations, tombstoneProduct.id)).variants[0];
        if (tombstoneVariant === undefined) return yield* Effect.die(new Error("Native tombstone seed omitted Variant"));
        yield* operations.runWorkflow("delete-product-variants", { ids: [tombstoneVariant.id], product_id: tombstoneProduct.id });
        const tombstoneBefore = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(yield* post(variantsPath, { create: [createVariant], update: [{ id: tombstoneVariant.id, title: "Must not resurrect foreign Variant" }] }, 400))
          .toMatchObject({ type: "invalid_data" });
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(tombstoneBefore);
        expect(yield* post(variantsPath, { delete: [tombstoneVariant.id] })).toEqual({ created: [], updated: [],
          deleted: { ids: [tombstoneVariant.id], object: "variant", deleted: true } });
        expect(business(yield* Effect.promise(() => tested.fixture.snapshot()))).toEqual(business(tombstoneBefore));
        const upsert = tested.catalog.productRuntime.commands.upsertVariants;
        const raw = yield* Effect.acquireRelease(tested.fixture.openWriteHost("product", [upsert]), host => host.close);
        const beforeRaw = yield* Effect.promise(() => tested.fixture.snapshot());
        const beforeRawInventory = yield* Effect.promise(() => tested.fixture.inventory());
        const refusedRaw = yield* Effect.result(raw.run(raw.newRequestKey(), upsert, [{ id: foreign.id, product_id: selectedId, title: "Late foreign refusal" }]));
        expect(Result.isFailure(refusedRaw)).toBe(true);
        if (Result.isFailure(refusedRaw)) {
          expect(refusedRaw.failure).toMatchObject({ reason: "adapterFailure" });
          expect(refusedRaw.failure.cause).toBeInstanceOf(MedusaError);
          expect(refusedRaw.failure.cause).toMatchObject({ type: MedusaError.Types.INVALID_DATA, message: "Cannot update variants outside the specified Product" });
        }
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(beforeRaw);
        const afterRawInventory = yield* Effect.promise(() => tested.fixture.inventory());
        expect(afterRawInventory.outcomes.slice(0, beforeRawInventory.outcomes.length)).toEqual(beforeRawInventory.outcomes);
        expect(afterRawInventory.outcomes.slice(beforeRawInventory.outcomes.length)).toEqual([
          expect.objectContaining({ value: expect.objectContaining({ kind: "native", state: "failed" }) }),
        ]);
        for (const path of [productsPath, variantsPath]) for (const body of [{}, { create: [], update: [], delete: [] }]) {
          const before = yield* Effect.promise(() => tested.fixture.snapshot());
          expect(yield* post(path, body)).toEqual({ created: [], updated: [], deleted: { ids: [], object: path === productsPath ? "product" : "variant", deleted: true } });
          expect(business(yield* Effect.promise(() => tested.fixture.snapshot()))).toEqual(business(before));
        }
        const preclaim = yield* Effect.promise(() => tested.fixture.snapshot());
        const preclaimOutcomes = (yield* Effect.promise(() => tested.fixture.inventory())).outcomes;
        for (const path of [productsPath, variantsPath]) {
          yield* post(path + "?fields=unsupported_field", {}, 400);
          yield* post(path + "?fields=__proto__.x", {}, 400);
          yield* post(path, { delete: Array.from({ length: 5 }, (_, index) => `outside-${index}`) }, 400);
        }
        yield* post(productsPath, { create: [{ title: "Outside nested Variant bound", variants: Array.from({ length: 5 }, (_, index) => ({
          title: "Outside " + index, sku: "outside-nested-" + index, options: {}, prices: [{ amount: 1, currency_code: "usd" }],
        })) }] }, 400);
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(preclaim);
        expect((yield* Effect.promise(() => tested.fixture.inventory())).outcomes).toEqual(preclaimOutcomes);
        for (const arm of ["update", "delete"] as const) {
          const before = yield* Effect.promise(() => tested.fixture.snapshot());
          const body = arm === "update" ? { create: [createVariant], update: [{ id: first.id, title: "Must roll back" }, { id: foreign.id, title: "Foreign" }] }
            : { create: [createVariant], delete: [removed.id, foreign.id] };
          expect(yield* post(variantsPath, body, 404)).toMatchObject({ type: "not_found" });
          expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(before);
        }
        const completeId = "prod_http_complete_missing_update";
        const beforeComplete = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(yield* post(productsPath, { update: [{ id: completeId, title: "Complete Missing Update", handle: "http-complete-missing-update" }] }))
          .toMatchObject({ created: [], updated: [expect.objectContaining({ id: completeId, title: "Complete Missing Update", handle: "http-complete-missing-update",
            status: "draft", variants: [] })], deleted: { ids: [], object: "product", deleted: true } });
        expect(yield* readProduct(operations, completeId)).toEqual({ id: completeId, title: "Complete Missing Update", variants: [] });
        const afterComplete = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(afterComplete.outcomes).toHaveLength(beforeComplete.outcomes.length + 1);
        const completePublication = afterComplete.outcomes.at(-1);
        if (completePublication === undefined) return yield* Effect.die(new Error("Native complete upsert omitted its publication"));
        const inserted = afterComplete.revisions.filter(row => row.value?.id === completeId && !beforeComplete.revisions.some(prior =>
          prior.id === row.id && prior.timestamp === row.timestamp));
        expect(inserted).toHaveLength(1);
        expect(inserted[0]).toMatchObject({ previous: null, deleted: false });
        const completeEvents = afterComplete.events.filter(event => !beforeComplete.events.some(prior => prior.familyId === event.familyId && prior.ordinal === event.ordinal));
        expect(completeEvents.map(event => event.envelope.contract)).toEqual(expect.arrayContaining([tested.catalog.productRuntime.metadata.product.createdEvent, "product.updated"]));
        expect(completeEvents).toHaveLength(2);
        expect(new Set([...inserted.map(row => row.timestamp), ...completeEvents.map(event => event.timestamp)]).size).toBe(1);
        const mixedUpsertId = "prod_http_mixed_missing_update";
        const mixedUpsert = yield* post(productsPath, { update: [{ id: selectedId, title: "Selected Mixed Upsert" },
          { id: mixedUpsertId, title: "Mixed Missing Update", handle: "http-mixed-missing-update" }] });
        expect(mixedUpsert).toMatchObject({ created: [], updated: expect.arrayContaining([
          expect.objectContaining({ id: selectedId, title: "Selected Mixed Upsert" }),
          expect.objectContaining({ id: mixedUpsertId, title: "Mixed Missing Update", handle: "http-mixed-missing-update", variants: [] }),
        ]), deleted: { ids: [], object: "product", deleted: true } });
        expect(ids(mixedUpsert.updated)).toHaveLength(2);
        expect(yield* readProduct(operations, selectedId)).toEqual({ ...selected, title: "Selected Mixed Upsert" });
        expect(yield* readProduct(operations, mixedUpsertId)).toEqual({ id: mixedUpsertId, title: "Mixed Missing Update", variants: [] });
        const afterMixedUpsert = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(afterMixedUpsert.outcomes).toHaveLength(afterComplete.outcomes.length + 1);
        const mixedRevisions = afterMixedUpsert.revisions.filter(row => row.timestamp > completePublication.timestamp &&
          (row.value?.id === selectedId || row.value?.id === mixedUpsertId));
        expect(mixedRevisions).toHaveLength(2);
        expect(mixedRevisions).toEqual(expect.arrayContaining([
          expect.objectContaining({ previous: null, value: expect.objectContaining({ id: mixedUpsertId }) }),
          expect.objectContaining({ previous: expect.any(BigInt), value: expect.objectContaining({ id: selectedId }) }),
        ]));
        const mixedEvents = afterMixedUpsert.events.filter(event => !afterComplete.events.some(prior => prior.familyId === event.familyId && prior.ordinal === event.ordinal));
        expect(mixedEvents.filter(event => event.envelope.contract === tested.catalog.productRuntime.metadata.product.createdEvent)).toHaveLength(1);
        expect(mixedEvents.filter(event => event.envelope.contract === tested.catalog.productRuntime.metadata.product.updatedEvent)).toHaveLength(1);
        expect(mixedEvents.filter(event => event.envelope.contract === "product.updated")).toHaveLength(2);
        expect(new Set([...mixedRevisions.map(row => row.timestamp), ...mixedEvents.map(event => event.timestamp)]).size).toBe(1);
        for (const [path, body] of [
          [productsPath, { create: [nativeProduct("http-batch-rollback", "Rollback")], update: [{ id: "product_missing_batch", title: "Missing" }] }],
          [variantsPath, { create: [createVariant], update: [{ id: "variant_missing_batch", title: "Missing" }] }],
        ] as const) {
          const before = yield* Effect.promise(() => tested.fixture.snapshot());
          expect(yield* post(path, body, 400)).toMatchObject({ type: "invalid_data" });
          expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(before);
        }
        const beforeProductBatch = yield* Effect.promise(() => tested.fixture.snapshot());
        const mixedProducts = yield* post(productsPath, { create: [nativeProduct("http-batch-created", "Created", ["One"], 4567)],
          update: [{ id: selectedId, title: "Selected Updated" }], delete: [deletedId, "product_missing_mixed_delete"] });
        expect(mixedProducts).toMatchObject({ created: [expect.objectContaining({ title: "Created", variants: [expect.objectContaining({
          prices: [expect.objectContaining({ amount: 4567, variant_id: expect.any(String), price_set_id: expect.any(String) })] })] })],
          updated: [expect.objectContaining({ id: selectedId, title: "Selected Updated" })], deleted: { ids: [deletedId, "product_missing_mixed_delete"], object: "product", deleted: true } });
        const createdProduct = ids(mixedProducts.created)[0];
        if (createdProduct === undefined) return yield* Effect.die(new Error("Native Product batch omitted created Product"));
        expect((yield* readProduct(operations, selectedId))).toEqual({ ...selected, title: "Selected Updated" });
        expect(yield* readProduct(operations, otherId)).toEqual(other);
        expect((yield* operations.query.graph({ entity: "product", fields: ["id"], filters: { id: deletedId } })).data).toEqual([]);
        const afterProductBatch = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(afterProductBatch.outcomes).toHaveLength(beforeProductBatch.outcomes.length + 1);
        const productEvents = afterProductBatch.events.filter(event => !beforeProductBatch.events.some(prior => prior.familyId === event.familyId && prior.ordinal === event.ordinal));
        expect(new Set(productEvents.map(event => event.timestamp)).size).toBe(1);
        for (const contract of ["product.created", "product.updated", "product.deleted"]) expect(productEvents.some(event => event.envelope.contract === contract)).toBe(true);
        const createdGraph = yield* readProduct(operations, createdProduct.id);
        const beforeVariantBatch = yield* Effect.promise(() => tested.fixture.snapshot());
        const mixedVariants = yield* post(variantsPath, { create: [createVariant],
          update: [{ id: first.id, title: "One Updated" }], delete: [removed.id, "variant_missing_mixed_delete"] });
        expect(mixedVariants).toMatchObject({ created: [expect.objectContaining({ title: "Next", product_id: selectedId,
          prices: [expect.objectContaining({ amount: 3333, variant_id: expect.any(String) })] })],
          updated: [expect.objectContaining({ id: first.id, title: "One Updated", product_id: selectedId })], deleted: { ids: [removed.id, "variant_missing_mixed_delete"], object: "variant", deleted: true } });
        const afterVariantBatch = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(afterVariantBatch.outcomes).toHaveLength(beforeVariantBatch.outcomes.length + 1);
        const decodeEventId = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }));
        const deletedEvents = afterVariantBatch.events.filter(event => event.envelope.contract === "product-variant.deleted" &&
          !beforeVariantBatch.events.some(prior => prior.familyId === event.familyId && prior.ordinal === event.ordinal));
        expect(deletedEvents.flatMap(event => { const id = decodeEventId(event.envelope.message).data.id; return typeof id === "string" ? [id] : id; })).toEqual([removed.id]);
        const retained = (yield* readProduct(operations, selectedId)).variants.find(row => row.id === first.id);
        expect(retained).toEqual({ ...first, title: "One Updated" });
        const selectedGraph = yield* readProduct(operations, selectedId);
        expect(selectedGraph.variants).toHaveLength(2);
        expect(new Set(selectedGraph.variants.map(row => row.price_set.id)).size).toBe(2);
        expect(new Set(selectedGraph.variants.flatMap(row => row.inventory_items.map(link => link.inventory_item_id))).size).toBe(2);
        for (const row of selectedGraph.variants) {
          expect(row.price_set.prices).toEqual([expect.objectContaining({ amount: row.id === first.id ? 1001 : 3333, currency_code: "usd" })]);
          expect(row.inventory_items).toEqual([expect.objectContaining({ variant_id: row.id, required_quantity: 1,
            inventory: { id: expect.any(String), sku: row.sku } })]);
        }
        expect(yield* readProduct(operations, otherId)).toEqual(other);
        expect(yield* readProduct(operations, createdProduct.id)).toEqual(createdGraph);
        expect(yield* post(productsPath + "?fields=id,id", { update: [{ id: selectedId, title: "Selected Updated" }] }))
          .toEqual({ created: [], updated: [{ id: selectedId }], deleted: { ids: [], object: "product", deleted: true } });
        expect(yield* post(variantsPath + "?fields=id,id", { update: [{ id: first.id, title: "One Updated" }] }))
          .toEqual({ created: [], updated: [{ id: first.id }], deleted: { ids: [], object: "variant", deleted: true } });
        for (const path of [productsPath, variantsPath]) expect(yield* post(path, { delete: ["missing_native_delete"] }))
          .toEqual({ created: [], updated: [], deleted: { ids: ["missing_native_delete"], object: path === productsPath ? "product" : "variant", deleted: true } });
        const maximum = yield* post(productsPath, { create: [{ title: "Four nested Variants", handle: "http-batch-four-nested",
          options: [{ title: "Size", values: ["A", "B", "C", "D"] }], variants: ["A", "B", "C", "D"].map((size, index) => ({ title: size,
            sku: "http-batch-max-" + size, options: { Size: size }, prices: [{ amount: 7000 + index, currency_code: "usd" }] })),
        }] });
        expect(maximum).toMatchObject({ created: [expect.objectContaining({ variants: expect.any(Array) })], updated: [], deleted: { ids: [], object: "product", deleted: true } });
        const maximumId = ids(maximum.created)[0]?.id;
        if (maximumId === undefined) return yield* Effect.die(new Error("Native maximum batch omitted Product"));
        const maximumGraph = yield* readProduct(operations, maximumId);
        expect(maximumGraph.variants).toHaveLength(4);
        expect(new Set(maximumGraph.variants.map(row => row.price_set.id)).size).toBe(4);
        expect(new Set(maximumGraph.variants.flatMap(row => row.inventory_items.map(link => link.inventory_item_id))).size).toBe(4);
        for (const row of maximumGraph.variants) {
          const index = ["A", "B", "C", "D"].indexOf(row.title);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(row.price_set.prices).toEqual([expect.objectContaining({ amount: 7000 + index, currency_code: "usd" })]);
          expect(row.inventory_items).toEqual([expect.objectContaining({ variant_id: row.id, required_quantity: 1,
            inventory: { id: expect.any(String), sku: row.sku } })]);
        }
      }));
    } catch (cause) { primary.push(cause); console.error("Native Product batch HTTP proof failed", { driver, phase }); throw cause; }
    finally {
      try { await tested.fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Native batch HTTP proof cleanup failed"); }
    }
  }, 300_000);

  it("refetches real Sales Channel and Price List defaults, removes membership last, and scopes Product price removal to the selected list", async () => {
    const tested = await prepareProductRequestFixture(driver);
    const primary: unknown[] = [];
    let phase = "compose";
    try {
      await tested.use(operations => Effect.gen(function* () {
        phase = "seed Product graph";
        const created = yield* operations.runWorkflow("create-products", { products: [nativeProduct("http-association-selected", "Selected", ["One"], "123.4567890123456789"),
          nativeProduct("http-association-other", "Other", ["One"], "987.6543210987654321")] });
        const selectedId = created.result[0]?.id, otherId = created.result[1]?.id;
        if (selectedId === undefined || otherId === undefined) return yield* Effect.die(new Error("Association seed omitted Products"));
        const selected = yield* readProduct(operations, selectedId), other = yield* readProduct(operations, otherId);
        const selectedVariant = selected.variants[0], otherVariant = other.variants[0];
        if (selectedVariant === undefined || otherVariant === undefined) return yield* Effect.die(new Error("Association seed omitted Variants"));
        const options = { execution: tested.fixture.execution, revision: "a".repeat(64), subscribers: [{ id: "product-association-seed", revision: "b".repeat(64) }] };
        const sales = yield* Effect.acquireRelease(prepareSalesChannelCreationWorkflow({ ...options,
          modules: { sales_channel: tested.catalog.modules.sales_channel } }), host => host.close);
        const channels = yield* sales.run(sales.newRequestKey(), { salesChannelsData: [{ name: "Selected Channel", description: "native description", metadata: { keep: "yes" } },
          { name: "Other Channel" }] });
        const firstChannel = channels[0], otherChannel = channels[1];
        if (firstChannel === undefined || otherChannel === undefined) return yield* Effect.die(new Error("Native Sales Channel seed omitted IDs"));
        const pricing = yield* makeLocalPricingCommands("price-list-creations"), pricingLink = yield* prepareVariantPricingLink();
        const lists = yield* Effect.acquireRelease(prepareCreatePriceListsWorkflow({ ...options, modules: {
          pricing: { module: pricing.workflow, nativeStorage: tested.catalog.modules.pricing.nativeStorage },
          link: { module: pricingLink.workflow, nativeStorage: tested.catalog.modules.variant_links.nativeStorage },
        } }), host => host.close);
        const priceLists = yield* lists.run(lists.newRequestKey(), { price_lists_data: ["Selected List", "Other List"].map(title => ({ title, description: "native Price List",
          rules: { customer_group_id: ["group-a", "group-a"], region_id: ["region-a"] },
          prices: [{ variant_id: selectedVariant.id, currency_code: "usd", amount: 1.25, rules: { region_id: "region-a" } },
            { variant_id: otherVariant.id, currency_code: "usd", amount: 2.5 }],
        })) });
        const firstList = priceLists[0], otherList = priceLists[1];
        if (firstList === undefined || otherList === undefined) return yield* Effect.die(new Error("Native Price List seed omitted IDs"));
        const http = yield* makeHttp(operations);
        const post = Effect.fn("BatchAssociationProof.membership")(function* (path: string, body: unknown, status = 200) {
          phase = "POST " + path;
          const response = yield* Effect.promise(() => http.handle(new Request("https://private.test" + path, { method: "POST",
            headers: { "content-type": "application/json" }, body: JSON.stringify(body) })));
          const json = object(yield* Effect.promise(() => response.json()));
          expect(response.status, JSON.stringify(json)).toBe(status);
          return json;
        });
        const channelPath = `/admin/sales-channels/${firstChannel.id}/products`, listPath = `/admin/price-lists/${firstList.id}/products`;
        const beforeInvalid = yield* Effect.promise(() => tested.fixture.snapshot());
        const beforeInvalidOutcomes = (yield* Effect.promise(() => tested.fixture.inventory())).outcomes;
        for (const path of [channelPath, listPath]) for (const query of ["fields=unsupported_field", "fields=__proto__.x"]) yield* post(`${path}?${query}`, { remove: [selectedId] }, 400);
        yield* post(channelPath, { add: Array.from({ length: 5 }, (_, index) => `product_outside_${index}`) }, 400);
        yield* post(listPath, { remove: Array.from({ length: 5 }, (_, index) => `product_outside_${index}`) }, 400);
        yield* post(listPath, {}, 400);
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(beforeInvalid);
        expect((yield* Effect.promise(() => tested.fixture.inventory())).outcomes).toEqual(beforeInvalidOutcomes);
        expect(yield* post(channelPath, { add: [selectedId, otherId] })).toEqual({ sales_channel: firstChannel });
        expect(yield* post(`/admin/sales-channels/${otherChannel.id}/products`, { add: [selectedId] })).toEqual({ sales_channel: otherChannel });
        expect(yield* post(channelPath, { add: [selectedId], remove: [selectedId] })).toEqual({ sales_channel: firstChannel });
        expect(yield* post(channelPath, {})).toEqual({ sales_channel: firstChannel });
        expect(yield* post(channelPath + "?fields=id,name,name", {})).toEqual({ sales_channel: { id: firstChannel.id, name: firstChannel.name } });
        const linkRows = yield* Effect.promise(() => tested.fixture.readRows("product_links"));
        expect(linkRows.filter(row => row.sales_channel_id === firstChannel.id && row.deleted_at === null)).toEqual([
          expect.objectContaining({ product_id: otherId, sales_channel_id: firstChannel.id })]);
        expect(linkRows.filter(row => row.sales_channel_id === otherChannel.id && row.deleted_at === null)).toEqual([
          expect.objectContaining({ product_id: selectedId, sales_channel_id: otherChannel.id })]);
        expect(linkRows.find(row => row.sales_channel_id === firstChannel.id && row.product_id === selectedId)).toMatchObject({ deleted_at: expect.any(String) });
        const beforeRemoval = yield* Effect.promise(() => tested.fixture.snapshot());
        const pricingBefore = yield* Effect.promise(() => tested.fixture.readRows("pricing"));
        const selectedBeforeRemoval = yield* readProduct(operations, selectedId), otherBeforeRemoval = yield* readProduct(operations, otherId);
        const expanded = yield* post(listPath + "?fields=id,title,prices.id,prices.id,prices.amount,prices.raw_amount,prices.currency_code,prices.price_rules.attribute,prices.price_rules.value", { remove: ["product_missing_association"] });
        const expandedList = Schema.decodeUnknownSync(Schema.Struct({ price_list: Schema.Struct({ id: Schema.NonEmptyString, title: Schema.String,
          prices: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, amount: Schema.Number, raw_amount: Schema.Struct({ value: Schema.String, precision: Schema.Number }),
            currency_code: Schema.String, rules: Schema.Record(Schema.String, Schema.String) })) }) }))(expanded).price_list;
        expect(expandedList).toMatchObject({ id: firstList.id, title: "Selected List", prices: expect.arrayContaining([
          expect.objectContaining({ amount: 1.25, currency_code: "usd", rules: { region_id: "region-a" } }),
          expect.objectContaining({ amount: 2.5, currency_code: "usd", rules: {} }),
        ]) });
        expect(expandedList.prices).toHaveLength(2);
        expect(expanded).not.toHaveProperty("price_list.prices.0.price_rules");
        expect(expanded).not.toHaveProperty("price_list.prices.0.price_set");
        const response = yield* post(listPath, { remove: [selectedId] });
        expect(response).toMatchObject({ price_list: { id: firstList.id, title: "Selected List", description: "native Price List", type: "sale", status: "draft",
          starts_at: null, ends_at: null, rules: { customer_group_id: ["group-a", "group-a"], region_id: ["region-a"] } } });
        expect(response).not.toHaveProperty("price_list.price_list_rules");
        expect(response).not.toHaveProperty("price_list.prices");
        const pricingAfter = yield* Effect.promise(() => tested.fixture.readRows("pricing"));
        const removedPrice = Schema.decodeUnknownSync(Schema.Struct({ prices: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, price_set_id: Schema.NonEmptyString })) }))(firstList)
          .prices.find(row => row.price_set_id === selectedVariant.price_set.id);
        if (removedPrice === undefined) return yield* Effect.die(new Error("Native seeded list omitted selected Price"));
        expect(pricingAfter.find(row => row.id === removedPrice.id)).toMatchObject({ deleted_at: expect.any(String) });
        const closure = (row: JsonObject) => row.id === removedPrice.id || row.price_id === removedPrice.id;
        expect(pricingAfter.filter(closure).every(row => typeof row.deleted_at === "string")).toBe(true);
        expect(pricingAfter.filter(row => !closure(row))).toEqual(pricingBefore.filter(row => !closure(row)));
        const selectedAfter = yield* readProduct(operations, selectedId);
        expect(selectedAfter.variants.map(row => row.inventory_items)).toEqual(selectedBeforeRemoval.variants.map(row => row.inventory_items));
        expect(selectedAfter.variants.map(row => row.price_set.id)).toEqual(selectedBeforeRemoval.variants.map(row => row.price_set.id));
        expect(yield* readProduct(operations, otherId)).toEqual(otherBeforeRemoval);
        const afterRemoval = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(afterRemoval.outcomes).toHaveLength(beforeRemoval.outcomes.length + 2);
        expect(afterRemoval.events.slice(beforeRemoval.events.length).some(event => event.envelope.contract === "pricing.price.deleted")).toBe(true);
        expect(yield* post(listPath, { remove: [selectedId] })).toEqual(response);
      }));
    } catch (cause) { primary.push(cause); console.error("Native Product association HTTP proof failed", { driver, phase }); throw cause; }
    finally {
      try { await tested.fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Native association HTTP proof cleanup failed"); }
    }
  }, 300_000);
});
