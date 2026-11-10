import { Cause, Effect, Exit, Schema } from "effect";
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
        operations.admitProductRefetchFields(["id", "variants.price_set.prices.amount"]);
        expect(() => operations.admitProductRefetchFields(["id", "variants.price_set.unadmitted"]))
          .toThrow("requires supported response fields");
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

  it("admits linked projections and updates real scalar, variant pricing and Sales Channel links while preserving Inventory links", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const linkedFields = ["id", "title", "sales_channels.id", "variants.id", "variants.price_set.id",
          "variants.price_set.prices.id", "variants.price_set.prices.amount", "variants.price_set.prices.currency_code",
          "variants.inventory_items.*", "variants.inventory_items.inventory.*"];
        operations.admitProductRefetchFields(linkedFields);
        const sales = yield* prepareSalesChannelCreationWorkflow({ execution: tested.fixture.execution,
          modules: { sales_channel: tested.catalog.modules.sales_channel }, revision: "d".repeat(64),
          subscribers: [{ id: "product-request-update-channel", revision: "e".repeat(64) }] });
        const channels = yield* sales.run(sales.newRequestKey(), { salesChannelsData: [{ name: "Old channel" }, { name: "New channel" }] });
        const oldChannel = channels[0], newChannel = channels[1];
        if (oldChannel === undefined || newChannel === undefined) return yield* Effect.die(new Error("Missing native Sales Channel IDs"));
        const created = yield* operations.runWorkflow("create-products", { products: [{ title: "Before update", handle: "request-update",
          sales_channels: [{ id: oldChannel.id }], options: [{ title: "Size", values: ["One"] }],
          variants: [{ title: "Managed variant", sku: "request-update-managed", options: { Size: "One" },
            prices: [{ amount: 1234, currency_code: "usd" }] }] }] });
        const id = created.result[0]?.id;
        if (id === undefined) return yield* Effect.die(new Error("Missing created Product ID"));
        const query = { entity: "product", fields: linkedFields, filters: { id } };
        const before = yield* operations.query.graph(query, { throwIfKeyNotFound: true });
        const decode = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String,
          sales_channels: Schema.Array(Schema.Struct({ id: Schema.String })),
          variants: Schema.Array(Schema.Struct({ id: Schema.String,
            price_set: Schema.Struct({ id: Schema.String, prices: Schema.Array(Schema.Struct({ id: Schema.String,
              amount: Schema.Number, currency_code: Schema.String })) }),
            inventory_items: Schema.Array(Schema.JsonObject),
          })),
        }));
        const original = decode(before.data[0]), variant = original.variants[0], price = variant?.price_set.prices[0];
        if (variant === undefined || price === undefined) return yield* Effect.die(new Error("Missing created native Variant/Price"));
        expect(original.sales_channels).toEqual([{ id: oldChannel.id }]);
        expect(variant.inventory_items).toEqual([expect.objectContaining({ required_quantity: 1,
          inventory: expect.objectContaining({ sku: "request-update-managed" }) })]);
        const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer() });
        const engine = scopes.createRequestScope().resolve<{ run(name: string, options: { input: unknown }): Promise<unknown> }>(Modules.WORKFLOW_ENGINE);
        yield* Effect.promise(() => engine.run("update-products", { input: { selector: { id }, update: {
          title: "After update", status: "published", sales_channels: [{ id: newChannel.id }],
          variants: [{ id: variant.id, prices: [{ id: price.id, amount: 4242, currency_code: "usd" }] }],
        }, additional_data: { trace: "native-http-update" } } }));
        const updated = decode((yield* operations.query.graph(query, { throwIfKeyNotFound: true })).data[0]);
        expect(updated.title).toBe("After update");
        expect(updated.sales_channels).toEqual([{ id: newChannel.id }]);
        expect(updated.variants).toEqual([{ ...variant, price_set: { ...variant.price_set,
          prices: [{ ...price, amount: 4242 }] } }]);
        yield* operations.runWorkflow("update-products", { products: [{ id, subtitle: "Native batch form" }] });
        expect((yield* operations.query.graph({ entity: "product", fields: ["id", "subtitle"], filters: { id } })).data)
          .toEqual([{ id, subtitle: "Native batch form" }]);
        expect((yield* operations.query.graph(query)).data[0]).toMatchObject({ title: "After update", variants: [
          expect.objectContaining({ id: variant.id, inventory_items: variant.inventory_items }),
        ] });
        yield* sales.close;
      }));
      const snapshot = await tested.fixture.snapshot();
      expect(snapshot.events.some(event => event.envelope.contract === "product.updated")).toBe(true);
      expect((await tested.fixture.readRows("product")).filter(row => row.title === "After update")).toHaveLength(1);
    } finally { await tested.fixture.close(); }
  });

  it("rejects unknown workflows and malformed or over-bound updates before native mutation or durable outcomes", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      const before = await tested.fixture.snapshot();
      await tested.use(operations => Effect.gen(function* () {
        for (const [name, input] of [
          ["delete-products", { ids: ["prod_missing"] }],
          ["update-products", { selector: { title: "not admitted" }, update: { title: "Forbidden" } }],
          ["update-products", { selector: { id: "prod_missing" }, update: { variants: Array.from({ length: 5 }, () => ({ title: "Over bound" })) } }],
          ["update-products", { products: [{ id: "prod_missing", created_at: "2020-01-01" }] }],
        ] as const) {
          const result = yield* Effect.exit(operations.runWorkflow(name, input));
          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) &&
            (name === "delete-products" ? reason.error.reason === "unsupportedProfile" : reason.error.reason === "adapterFailure" &&
              reason.error.cause instanceof MedusaError && reason.error.cause.type === MedusaError.Types.INVALID_DATA))).toBe(true);
        }
        expect(() => operations.admitProductRefetchFields(["id", "variants.price_set.unadmitted"]))
          .toThrow("requires supported response fields");
      }));
      expect(await tested.fixture.snapshot()).toEqual(before);
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
