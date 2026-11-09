import { Cause, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { MedusaError } from "@medusajs/utils/common/errors";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { makeProductRequestScopeFactory } from "../src/http/product-request";
import { prepareProductRequestFixture } from "./support/product-request-fixture";

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
});
