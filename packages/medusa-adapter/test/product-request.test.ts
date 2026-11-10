import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { MedusaError } from "@medusajs/utils/common/errors";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { makeProductRequestScopeFactory } from "../src/http/product-request";
import { prepareProductRequestFixture } from "./support/product-request-fixture";
import { prepareSalesChannelCreationWorkflow } from "../src/workflows/sales-channel/create";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const fields = ["id", "title", "handle", "status", "options.id", "options.title", "options.values.id", "options.values.value"];
describe(`native Product HTTP data operations (${driver})`, () => {
  it("executes promoted createProductsWorkflow on Core, independently refetches native owned projections, and rejects unsupported refetch before creation", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer().register({ logger: asValue({ error() {}, info() {} }) }) });
        const scope = scopes.createRequestScope();
        operations.admitProductRefetchFields(fields);
        expect(() => operations.admitProductRefetchFields(["id", "variants.price_set.prices.amount"]))
          .toThrow("requires explicit supported Product fields");
        const engine = scope.resolve<{ run(name: string, input: { input: unknown }): Promise<{ result: Array<{ id: string }> }> }>(Modules.WORKFLOW_ENGINE);
        const created = yield* Effect.promise(() => engine.run("create-products", { input: { products: [{ title: "Core HTTP Product", handle: "core-http-product",
          options: [{ title: "Size", values: ["One"] }] }] } }));
        const id = created.result[0]?.id;
        if (id === undefined) return yield* Effect.die(new Error("Missing real native Product ID"));
        const graph = yield* operations.query.graph({ entity: "product", fields, filters: { id } }, { throwIfKeyNotFound: true });
        expect(graph.data).toEqual([expect.objectContaining({ id, title: "Core HTTP Product", handle: "core-http-product", status: "draft",
          options: [expect.objectContaining({ title: "Size", values: [expect.objectContaining({ value: "One" })] })] })]);
      }));
      const snapshot = await tested.fixture.snapshot();
      expect(snapshot.events.some(event => event.envelope.contract === "product.created")).toBe(true);
      expect((await tested.fixture.readRows("product")).filter(row => row.title === "Core HTTP Product")).toHaveLength(1);
    } finally { await tested.fixture.close(); }
  });

  it("presents only a genuine native business refusal while retaining its complete Core failure Cause", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer() });
        const engine = scopes.createRequestScope().resolve<{ run(name: string, input: { input: unknown }): Promise<unknown> }>(Modules.WORKFLOW_ENGINE);
        const bounded = yield* Effect.promise(() => engine.run("create-products", { input: { products: [{ title: "Too many native variants",
          options: [{ title: "Size", values: ["One"] }], variants: Array.from({ length: 5 }, (_value, index) => ({ title: `Variant ${index}`, options: { Size: "One" } })) }] } })
          .then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })));
        expect(bounded.ok).toBe(false);
        if (!bounded.ok) {
          expect(bounded.error).toBeInstanceOf(MedusaError);
          if (!(bounded.error instanceof MedusaError)) return yield* Effect.die(new Error("Missing admission refusal"));
          expect(bounded.error.type).toBe(MedusaError.Types.INVALID_DATA);
          expect(bounded.error.message).toContain("private supported profile");
        }
        const result = yield* Effect.promise(() => engine.run("create-products", { input: { products: [{ title: "Missing native options" }] } })
          .then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBeInstanceOf(MedusaError);
          if (!(result.error instanceof MedusaError)) return yield* Effect.die(new Error("Missing native Medusa refusal"));
          expect(result.error.type).toBe(MedusaError.Types.INVALID_DATA);
          expect(Cause.isCause(result.error.cause)).toBe(true);
        }
      }));
      expect(await tested.fixture.readRows("product")).toEqual([]);
      expect((await tested.fixture.snapshot()).events).toEqual([]);
    } finally { await tested.fixture.close(); }
  });

  it("reads native counted Product pages and stored price/inventory Link expansions", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const sales = yield* prepareSalesChannelCreationWorkflow({ execution: tested.fixture.execution,
          modules: { sales_channel: tested.catalog.modules.sales_channel }, revision: "d".repeat(64),
          subscribers: [{ id: "product-request-sales-channel", revision: "e".repeat(64) }] });
        const createdSales = yield* sales.run(sales.newRequestKey(), { salesChannelsData: [{ name: "Product request channel" }] });
        const channel = createdSales[0];
        if (channel === undefined) return yield* Effect.die(new Error("Missing real Sales Channel ID"));
        for (const [title, handle] of [["Alpha product", "alpha-read"], ["Bravo product", "bravo-read"]]) {
          yield* operations.runWorkflow("create-products", { products: [{ title, handle, status: "published",
            ...(handle === "alpha-read" ? { sales_channels: [{ id: channel.id }] } : {}),
            options: [{ title: "Size", values: ["One"] }], variants: [{ title: title + " variant", sku: handle,
              options: { Size: "One" }, prices: [{ amount: 1234, currency_code: "usd" }] }] }] });
        }
        const page = yield* operations.query.graph({ entity: "product", fields: ["id", "title", "handle"],
          filters: { status: ["published"] }, pagination: { take: 1, skip: 1, order: { title: "DESC" } } });
        expect(page.metadata).toEqual({ count: 2, skip: 1, take: 1 });
        expect(page.data).toEqual([expect.objectContaining({ title: "Alpha product", handle: "alpha-read" })]);
        expect(Object.keys(page.data[0] ?? {}).sort()).toEqual(["handle", "id", "title"]);
        const byTitle = yield* operations.query.graph({ entity: "product", fields: ["id", "title"], filters: { title: "Bravo product" } });
        expect(byTitle.data).toEqual([expect.objectContaining({ title: "Bravo product" })]);
        const searched = yield* operations.query.graph({ entity: "product", fields: ["id", "title"], filters: { q: "Bravo" } });
        expect(searched.data).toEqual([expect.objectContaining({ title: "Bravo product" })]);
        const links = yield* operations.query.graph({ entity: "product_sales_channel", fields: ["product_id"], filters: { sales_channel_id: [channel.id] } });
        expect(links.data).toHaveLength(1);
        const inChannel = yield* operations.query.graph({ entity: "product", fields: ["id", "title"],
          filters: { id: links.data.map(link => link.product_id) }, withDeleted: true });
        expect(inChannel.data).toEqual([expect.objectContaining({ title: "Alpha product" })]);
        const expanded = yield* operations.query.graph({ entity: "product", fields: ["id", "variants.id", "variants.sku",
          "variants.price_set.prices.*", "variants.inventory_items.*", "variants.inventory_items.inventory.*"], filters: { handle: "alpha-read" } });
        expect(expanded.data).toEqual([expect.objectContaining({ variants: [expect.objectContaining({ sku: "alpha-read",
          price_set: expect.objectContaining({ prices: [expect.objectContaining({ amount: 1234, currency_code: "usd" })] }),
          inventory_items: [expect.objectContaining({ required_quantity: 1, inventory: expect.objectContaining({ sku: "alpha-read" }) })],
        })] })]);
        const missing = yield* operations.query.graph({ entity: "product", fields: ["id"], filters: { id: "prod_missing" } });
        expect(missing.data).toEqual([]);
        expect(missing.metadata.count).toBe(0);
        const refusal = yield* Effect.exit(operations.query.graph({ entity: "product", fields: ["id"], filters: { id: "prod_missing" } }, { throwIfKeyNotFound: true }));
        expect(Exit.isFailure(refusal)).toBe(true);
        if (Exit.isFailure(refusal)) expect(refusal.cause.reasons.some(reason => Cause.isFailReason(reason) &&
          reason.error.reason === "adapterFailure" && reason.error.cause instanceof MedusaError && reason.error.cause.type === MedusaError.Types.NOT_FOUND)).toBe(true);
        const unsupported = yield* Effect.exit(operations.query.graph({ entity: "product", fields: ["id"], filters: { unsupported: "refuse" } }));
        expect(Exit.isFailure(unsupported)).toBe(true);
        if (Exit.isFailure(unsupported)) expect(unsupported.cause.reasons.some(reason => Cause.isFailReason(reason) &&
          reason.error.reason === "adapterFailure" && reason.error.cause instanceof MedusaError && reason.error.cause.type === MedusaError.Types.INVALID_DATA)).toBe(true);
        const priceList = yield* Effect.exit(operations.remoteQuery({ entryPoint: "price_list", fields: ["prices.price_set.variant.id"], variables: { id: ["plist_unadmitted"] } }));
        expect(Exit.isFailure(priceList)).toBe(true);
        if (Exit.isFailure(priceList)) expect(priceList.cause.reasons.some(reason => Cause.isFailReason(reason) &&
          reason.error.reason === "adapterFailure" && reason.error.cause instanceof MedusaError && reason.error.cause.type === MedusaError.Types.INVALID_DATA)).toBe(true);
        yield* sales.close;
      }));
    } finally { await tested.fixture.close(); }
  });
});
