import { Cause, Effect, Exit, Result, Schema } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { createContainer } from "@medusajs/deps/awilix-portable";
import { MedusaError } from "@medusajs/utils/common/errors";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { describe, expect, it } from "vitest";
import { makeProductRequestScopeFactory, type ProductRequestOperations } from "../src/http/product-request";
import { prepareVariantImagesWorkflow } from "../src/workflows/product/variant-images";
import type { AtomicWorkflowExecution } from "../src/workflow/host";
import { prepareProductRequestFixture } from "./support/product-request-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
type Tested = Awaited<ReturnType<typeof prepareProductRequestFixture>>;
type NativeEngine = { run(name: string, options: { input: unknown }): Promise<{ result: unknown }> };
const fields = ["id", "title", "images.id", "images.url", "variants.id", "variants.sku", "variants.thumbnail", "variants.manage_inventory",
  "variants.price_set.id", "variants.price_set.prices.id", "variants.price_set.prices.amount", "variants.price_set.prices.currency_code",
  "variants.price_set.prices.raw_amount", "variants.inventory_items.id", "variants.inventory_items.variant_id",
  "variants.inventory_items.inventory_item_id", "variants.inventory_items.required_quantity", "variants.inventory_items.inventory.id",
  "variants.inventory_items.inventory.sku"];
const decodeIds = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })));
const decodeProduct = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, title: Schema.String,
  images: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, url: Schema.String })),
  variants: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String, thumbnail: Schema.NullOr(Schema.String),
    manage_inventory: Schema.Boolean, price_set: Schema.Struct({ id: Schema.NonEmptyString,
      prices: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, amount: Schema.Number, currency_code: Schema.String,
        raw_amount: Schema.Struct({ value: Schema.String, precision: Schema.Number }) })) }),
    inventory_items: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, variant_id: Schema.NonEmptyString,
      inventory_item_id: Schema.NonEmptyString, required_quantity: Schema.Number,
      inventory: Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String }) })) })) }));
const decodeAssignment = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, variant_id: Schema.NonEmptyString, image_id: Schema.NonEmptyString }));

const makeEngine = Effect.fn("ProductRequestImages.makeEngine")(function* (operations: ProductRequestOperations) {
  const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer() });
  const scope = scopes.createRequestScope();
  const engine = scope.resolve<NativeEngine>(Modules.WORKFLOW_ENGINE);
  return Effect.fn("ProductRequestImages.run")((name: string, input: unknown) => Effect.tryPromise({
    try: () => engine.run(name, { input }), catch: error => error,
  }).pipe(Effect.tapError(error => error instanceof MedusaError ? Effect.void : Effect.sync(() => {
    console.error("Unexpected native Product image assembly failure", { name, input },
      error instanceof Error && Cause.isCause(error.cause) ? Cause.pretty(error.cause) : error);
  }))));
});
type Run = Effect.Success<ReturnType<typeof makeEngine>>;
const readProduct = Effect.fn("ProductRequestImages.readProduct")(function* (operations: ProductRequestOperations, id: string) {
  return decodeProduct((yield* operations.query.graph({ entity: "product", fields, filters: { id } })).data[0]);
});
const seed = Effect.fn("ProductRequestImages.seed")(function* (operations: ProductRequestOperations, run: Run, prefix: string) {
  const created = decodeIds((yield* run("create-products", { products: ["First", "Other"].map((name, index) => ({
    title: `${prefix} ${name}`, handle: `${prefix}-${name.toLowerCase()}`, options: [{ title: "Size", values: ["One"] }],
    images: [{ url: `https://images.test/${prefix}-${name}-one.png` }, { url: `https://images.test/${prefix}-${name}-two.png` }],
    variants: [{ title: `${name} managed`, sku: `${prefix}-${name}`, manage_inventory: true, options: { Size: "One" },
      prices: [{ currency_code: "usd", amount: 1234 + index }] }],
  })) })).result);
  const products = [];
  for (const { id } of created) {
    const product = yield* readProduct(operations, id), variant = product.variants[0], image = product.images[0];
    if (variant === undefined || image === undefined || product.images.length !== 2)
      return yield* Effect.die(new Error("Native image seed omitted its two Images or managed Variant"));
    yield* run("update-product-variants", { selector: { id: variant.id, product_id: id }, update: { thumbnail: image.url } });
    products.push({ product: yield* readProduct(operations, id), variant, image });
  }
  return products;
});
const assignments = async (tested: Tested) => (await tested.fixture.readRows("product"))
  .filter(row => typeof row.variant_id === "string" && typeof row.image_id === "string").map(row => decodeAssignment(row));

describe(`native Product request image assembly (${driver})`, () => {
  it("executes both scoped association directions and thumbnail removal while retaining native Pricing, Inventory and the other graph", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const run = yield* makeEngine(operations), created = yield* seed(operations, run, "request-images");
        const first = created[0], other = created[1];
        if (first === undefined || other === undefined) return yield* Effect.die(new Error("Expected two native image parents"));
        yield* run("batch-variant-images", { variant_id: other.variant.id, product_id: other.product.id, add: [other.image.id] });
        const unrelated = yield* readProduct(operations, other.product.id);
        const beforeProductRows = yield* Effect.promise(() => tested.fixture.readRows("product"));
        const retainedSources = [];
        for (const source of ["pricing", "inventory", "variant_links"] as const)
          retainedSources.push({ source, rows: yield* Effect.promise(() => tested.fixture.readRows(source)) });
        const originalPrice = first.product.variants[0]?.price_set.prices[0];
        expect(originalPrice).toMatchObject({ amount: 1234, raw_amount: { value: "1234.0000000000000000", precision: 20 } });
        expect(first.product.variants[0]?.inventory_items).toEqual([expect.objectContaining({ variant_id: first.variant.id,
          required_quantity: 1, inventory: expect.objectContaining({ sku: "request-images-First" }) })]);

        for (const direction of ["variant", "image"] as const) {
          const name = direction === "variant" ? "batch-variant-images" : "batch-image-variants";
          const own = direction === "variant" ? first.image.id : first.variant.id;
          const foreign = direction === "variant" ? other.image.id : other.variant.id;
          const primary = direction === "variant" ? { variant_id: first.variant.id } : { image_id: first.image.id };
          const foreignPrimary = direction === "variant" ? { variant_id: other.variant.id } : { image_id: other.image.id };
          const missingPrimary = direction === "variant" ? { variant_id: "variant_missing" } : { image_id: "image_missing" };
          const input = { ...primary, product_id: first.product.id };
          for (const refused of [
            { ...foreignPrimary, product_id: first.product.id, add: [own] },
            { ...missingPrimary, product_id: first.product.id, add: [own] },
            { ...input, add: [foreign] }, { ...input, remove: [foreign] },
            { ...input, add: [own, foreign] }, { ...input, add: [own], remove: [foreign] },
          ]) {
            const before = yield* Effect.promise(() => tested.fixture.snapshot());
            const result = yield* Effect.result(run(name, refused));
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result)) {
              expect(result.failure).toBeInstanceOf(MedusaError);
              expect(result.failure).toMatchObject({ type: MedusaError.Types.INVALID_DATA,
                message: "Product Image and Variant must belong to the specified Product" });
            }
            expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(before);
          }
          yield* run("update-product-variants", { selector: { id: first.variant.id, product_id: first.product.id }, update: { thumbnail: first.image.url } });
          expect(yield* run(name, { ...input, add: [own] })).toEqual({ result: { added: [own], removed: [] } });
          const added = (yield* Effect.promise(() => assignments(tested))).filter(row => row.variant_id === first.variant.id);
          expect(added).toEqual([{ id: expect.any(String), variant_id: first.variant.id, image_id: first.image.id }]);
          const beforeMixedRemoval = yield* Effect.promise(() => tested.fixture.snapshot());
          const mixedRemoval = yield* Effect.result(run(name, { ...input, remove: [own, foreign] }));
          expect(Result.isFailure(mixedRemoval)).toBe(true);
          expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(beforeMixedRemoval);
          expect(yield* run(name, { ...input, remove: [own] })).toEqual({ result: { added: [], removed: [own] } });
          expect((yield* Effect.promise(() => assignments(tested))).filter(row => row.variant_id === first.variant.id)).toEqual([]);
          expect((yield* readProduct(operations, first.product.id)).variants[0]).toEqual({ ...first.product.variants[0], thumbnail: null });
          expect(yield* readProduct(operations, other.product.id)).toEqual(unrelated);
        }
        const afterProductRows = yield* Effect.promise(() => tested.fixture.readRows("product"));
        expect(afterProductRows.filter(row => row.id !== first.variant.id)).toEqual(beforeProductRows.filter(row => row.id !== first.variant.id));
        for (const { source, rows } of retainedSources) expect(yield* Effect.promise(() => tested.fixture.readRows(source))).toEqual(rows);
        const snapshot = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(snapshot.events.some(event => event.envelope.contract === tested.catalog.productRuntime.metadata.variant.updatedEvent)).toBe(true);
      }));
    } finally { await tested.fixture.close(); }
  });

  it("refuses malformed and ordinary duplicate/intersecting inputs before outcomes while empty operations keep native no-existence-check results", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      const before = await tested.fixture.snapshot();
      await tested.use(operations => Effect.gen(function* () {
        const run = yield* makeEngine(operations);
        for (const [name, primary] of [["batch-variant-images", { variant_id: "variant_missing" }],
          ["batch-image-variants", { image_id: "image_missing" }]] as const) {
          const scopedPrimary = { ...primary, product_id: "product_missing" };
          for (const input of [{}, { ...scopedPrimary, product_id: null }, { ...scopedPrimary, product_id: "" }, { ...scopedPrimary, add: null },
            { ...scopedPrimary, add: [42] }, { ...scopedPrimary, add: Array.from({ length: 5 }, (_, index) => `over-bound-${index}`) },
            { ...scopedPrimary, extra: true }]) {
            const result = yield* Effect.result(run(name, input));
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result)) expect(result.failure).toMatchObject({ type: MedusaError.Types.INVALID_DATA,
              message: expect.stringContaining("workflow input is outside the private supported profile") });
          }
        }
        for (const arms of [{ add: ["a", "a"] }, { remove: ["a", "a"] }, { add: ["a"], remove: ["a"] }]) {
          const input = { variant_id: "missing", product_id: "product_missing", ...arms };
          const result = yield* Effect.result(run("batch-variant-images", input));
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) expect(result.failure).toMatchObject({ type: MedusaError.Types.INVALID_DATA,
            message: expect.stringContaining("workflow input is outside the private supported profile") });
        }
      }));
      expect(await tested.fixture.snapshot()).toEqual(before);
      await tested.use(operations => Effect.gen(function* () {
        const run = yield* makeEngine(operations);
        for (const [name, primary] of [["batch-variant-images", { variant_id: "variant_missing" }],
          ["batch-image-variants", { image_id: "image_missing" }]] as const) {
          for (const arms of [{}, { add: [], remove: [] }]) {
            expect(yield* run(name, { ...primary, product_id: "product_missing", ...arms })).toEqual({ result: { added: [], removed: [] } });
          }
        }
      }));
      const { outcomes: _beforeOutcomes, ...beforeBusiness } = before;
      const { outcomes: _afterOutcomes, ...afterBusiness } = await tested.fixture.snapshot();
      expect(afterBusiness).toEqual(beforeBusiness);
    } finally { await tested.fixture.close(); }
  });

  it("preserves inverse raw duplicate/intersecting arms through the real named facade and authentic assignment identities", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const run = yield* makeEngine(operations), created = yield* seed(operations, run, "request-raw-images");
        const first = created[0], other = created[1];
        if (first === undefined || other === undefined) return yield* Effect.die(new Error("Expected two native inverse parents"));
        const unrelated = yield* readProduct(operations, other.product.id);
        const input = { image_id: first.image.id, product_id: first.product.id };
        const add = [first.variant.id, first.variant.id, first.variant.id, first.variant.id];
        expect(yield* run("batch-image-variants", { ...input, add })).toEqual({ result: { added: add, removed: [] } });
        const existing = (yield* Effect.promise(() => assignments(tested))).filter(row => row.variant_id === first.variant.id);
        expect(existing).toHaveLength(4);
        expect(new Set(existing.map(row => row.id)).size).toBe(4);
        expect(existing.every(row => row.image_id === first.image.id)).toBe(true);
        const remove = [first.variant.id, first.variant.id];
        expect(yield* run("batch-image-variants", { ...input, add: [first.variant.id], remove }))
          .toEqual({ result: { added: [first.variant.id], removed: remove } });
        const remaining = (yield* Effect.promise(() => assignments(tested))).filter(row => row.variant_id === first.variant.id);
        // Both native branches remain parallel. An added assignment can be
        // observed by removal or survive it; pre-existing identities never do.
        expect(remaining.length).toBeLessThanOrEqual(1);
        expect(remaining.every(row => existing.every(previous => previous.id !== row.id))).toBe(true);
        expect((yield* readProduct(operations, first.product.id)).variants[0]).toMatchObject({ id: first.variant.id, thumbnail: null });
        expect(yield* readProduct(operations, other.product.id)).toEqual(unrelated);
      }));
    } finally { await tested.fixture.close(); }
  });

  it("rolls back the full scoped removal at a forced 64-call allowance and settles through the selected parent-qualified profile", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const run = yield* makeEngine(operations), created = yield* seed(operations, run, "request-image-budget");
        const first = created[0], other = created[1];
        if (first === undefined || other === undefined) return yield* Effect.die(new Error("Expected two native budget witness parents"));
        for (const parent of [first, other]) yield* run("batch-variant-images", {
          variant_id: parent.variant.id, product_id: parent.product.id, add: [parent.image.id],
        });
        const before = yield* Effect.promise(() => tested.fixture.snapshot());
        const beforeRows = yield* Effect.promise(() => tested.fixture.readRows("product"));
        const beforeProduct = yield* readProduct(operations, first.product.id);
        const unrelated = yield* readProduct(operations, other.product.id);
        const assignment = (yield* Effect.promise(() => assignments(tested))).find(row => row.variant_id === first.variant.id);
        const priorOutcome = before.outcomes.at(-1);
        if (assignment === undefined || priorOutcome === undefined) return yield* Effect.die(new Error("Budget witness omitted its prior assignment or root"));
        const variantCoreRow = before.rows.find(row => row.value.id === first.variant.id);
        const assignmentCoreRow = before.rows.find(row => row.value.id === assignment.id);
        if (variantCoreRow === undefined || assignmentCoreRow === undefined) return yield* Effect.die(new Error("Core observer omitted its budget witness rows"));
        const retainedSources = [];
        for (const source of ["pricing", "inventory", "variant_links"] as const)
          retainedSources.push({ source, rows: yield* Effect.promise(() => tested.fixture.readRows(source)) });
        const input = { variant_id: first.variant.id, product_id: first.product.id, remove: [first.image.id] };
        // This deliberately lower trusted test allowance preserves the complete
        // production operation, module, scheduling and other resource guards.
        const forced64: AtomicWorkflowExecution = { ...tested.fixture.execution,
          prepare: composition => tested.fixture.execution.prepare({ ...composition, requestCallLimit: 64,
            participants: composition.participants.map(participant => participant.nativeStorage === undefined ? participant : ({ ...participant,
              logicalResources: { ...(participant.logicalResources ?? defaultCommerceResources), calls: 64 } })),
          }),
        };
        const options = { modules: { product: { ...tested.catalog.modules.product,
          module: tested.catalog.productRuntime.productVariantImageWorkflow } }, admission: "parent-qualified" as const,
          revision: "d".repeat(64), subscribers: [{ id: "native-admin-product-request", revision: "e".repeat(64) }] };
        const bounded = yield* prepareVariantImagesWorkflow({ ...options, execution: forced64 });
        let refusedEntries = 0;
        const refusal = yield* Effect.exit(bounded.run(bounded.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
          observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") refusedEntries++; }).pipe(Effect.andThen(work)),
        })));
        expect(Exit.isFailure(refusal)).toBe(true);
        if (Exit.isFailure(refusal)) {
          expect(refusal.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded")).toBe(true);
          expect(refusal.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "rollbackOnly")).toBe(true);
        }
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(before);
        expect(yield* readProduct(operations, first.product.id)).toEqual(beforeProduct);
        expect((yield* Effect.promise(() => assignments(tested))).find(row => row.variant_id === first.variant.id)).toEqual(assignment);
        yield* bounded.close;

        const selected = yield* prepareVariantImagesWorkflow({ ...options, execution: tested.fixture.execution });
        let completedEntries = 0;
        const output = yield* selected.run(selected.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
          observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") completedEntries++; }).pipe(Effect.andThen(work)),
        }));
        expect(output).toEqual({ added: [], removed: [first.image.id] });
        expect(completedEntries).toBeGreaterThan(64);
        expect(completedEntries).toBeLessThanOrEqual(128);
        console.info("Parent-qualified forward image call witness", { driver, forced64Entries: refusedEntries, selected128Entries: completedEntries });
        const after = yield* Effect.promise(() => tested.fixture.snapshot());
        const publication = after.outcomes.at(-1);
        if (publication === undefined) return yield* Effect.die(new Error("Selected removal omitted its committed root"));
        expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
        const mutations = after.revisions.filter(row => row.timestamp > priorOutcome.timestamp);
        expect(mutations).toHaveLength(2);
        expect(mutations.every(row => row.timestamp === publication.timestamp)).toBe(true);
        expect(mutations).toEqual(expect.arrayContaining([
          expect.objectContaining({ table: assignmentCoreRow.table, deleted: true, value: null }),
          expect.objectContaining({ table: variantCoreRow.table, deleted: false,
            value: expect.objectContaining({ id: first.variant.id, thumbnail: null }) }),
        ]));
        const events = after.events.filter(event => event.timestamp > priorOutcome.timestamp);
        expect(events.every(event => event.timestamp === publication.timestamp)).toBe(true);
        expect(events.map(event => event.envelope.contract)).toContain(tested.catalog.productRuntime.metadata.variant.updatedEvent);
        expect((yield* Effect.promise(() => assignments(tested))).filter(row => row.variant_id === first.variant.id)).toEqual([]);
        const afterRows = yield* Effect.promise(() => tested.fixture.readRows("product"));
        expect(afterRows.filter(row => row.id !== first.variant.id))
          .toEqual(beforeRows.filter(row => row.id !== first.variant.id && row.id !== assignment.id));
        expect(yield* readProduct(operations, other.product.id)).toEqual(unrelated);
        expect((yield* readProduct(operations, first.product.id)).variants[0]).toEqual({ ...first.product.variants[0], thumbnail: null });
        for (const { source, rows } of retainedSources) expect(yield* Effect.promise(() => tested.fixture.readRows(source))).toEqual(rows);
        yield* selected.close;
      }));
    } finally { await tested.fixture.close(); }
  });
});
