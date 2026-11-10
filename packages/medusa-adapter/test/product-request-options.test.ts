import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createContainer } from "@medusajs/deps/awilix-portable";
import { MedusaError } from "@medusajs/utils/common/errors";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeProductRequestScopeFactory } from "../src/http/product-request";
import { prepareProductRequestFixture } from "./support/product-request-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const option = Schema.Struct({ id: Schema.String, title: Schema.String, product_id: Schema.String,
  values: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String, option_id: Schema.String })) });
const decodeOption = Schema.decodeUnknownSync(option);
const fields = ["id", "title", "product_id", "values.id", "values.value", "values.option_id"];

describe(`native Product Option HTTP operations (${driver})`, () => {
  it("creates, reads and updates parent-selected Options through the real operations and native Promise scope", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const created = yield* operations.runWorkflow("create-products", { products: ["Selected", "Unrelated"].map(title => ({
          title, handle: "option-request-" + title.toLowerCase(), options: [{ title: "Size", values: ["One"] }],
          variants: [{ title: title + " One", sku: "option-request-" + title.toLowerCase(), options: { Size: "One" },
            prices: [{ currency_code: "usd", amount: 1234 }] }],
        })) });
        const selectedId = created.result[0]?.id, unrelatedId = created.result[1]?.id;
        if (selectedId === undefined || unrelatedId === undefined) return yield* Effect.die(new Error("Native creation omitted the two Product IDs"));
        const parent = (id: string) => operations.query.graph({ entity: "product", filters: { id }, fields: ["id", "title",
          "options.id", "options.title", "options.values.id", "options.values.value", "variants.id", "variants.title", "variants.sku",
          "variants.options.id", "variants.options.value", "variants.price_set.id", "variants.price_set.prices.*",
          "variants.inventory_items.*", "variants.inventory_items.inventory.*"] });
        const unrelated = (yield* parent(unrelatedId)).data;
        const original = (yield* parent(selectedId)).data;
        const initialOptions = yield* operations.query.graph({ entity: "product_option", fields, filters: { product_id: selectedId } });
        expect(initialOptions.metadata).toEqual({ count: 1, skip: 0, take: commerceLimits.catalogRows });
        expect(initialOptions.data.map(row => decodeOption(row))).toEqual([expect.objectContaining({ title: "Size",
          values: [expect.objectContaining({ value: "One" })] })]);

        const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer() });
        const scope = scopes.createRequestScope();
        const engine = scope.resolve<{ run(name: string, options: { input: unknown }): Promise<{ result: unknown[] }> }>(Modules.WORKFLOW_ENGINE);
        const nativeQuery = scope.resolve<{ graph(input: unknown): Promise<{ data: unknown[] }> }>("query");
        const added = yield* Effect.promise(() => engine.run("create-product-options", { input: { product_options: [{
          title: "Material", product_id: selectedId, values: ["Cotton", "Wool", "Silk", "Linen"],
        }], additional_data: { origin: "native-option-request" } } }));
        expect(added.result).toHaveLength(1);
        const material = decodeOption(added.result[0]);
        expect(material).toMatchObject({ title: "Material", product_id: selectedId });
        expect(new Set(material.values.map(value => value.id)).size).toBe(4);
        expect(material.values.every(value => value.option_id === material.id)).toBe(true);
        expect(material.values.map(value => value.value).sort()).toEqual(["Cotton", "Linen", "Silk", "Wool"]);
        const query = { entity: "product_option", fields, filters: { id: material.id, product_id: selectedId } };
        expect((yield* operations.query.graph(query)).data.map(row => decodeOption(row))).toEqual([material]);
        expect((yield* Effect.promise(() => nativeQuery.graph(query))).data.map(row => decodeOption(row))).toEqual([material]);
        expect((yield* operations.query.graph({ ...query, filters: { id: material.id, product_id: unrelatedId } })).data).toEqual([]);
        const all = yield* operations.query.graph({ entity: "product_option", fields: ["id", "title"], filters: { product_id: selectedId },
          pagination: { take: 50, order: { id: "ASC" } } });
        expect(all.metadata).toEqual({ count: 2, skip: 0, take: 50 });
        expect(all.data.every(row => Object.keys(row).sort().join(",") === "id,title")).toBe(true);
        const first = yield* operations.query.graph({ entity: "product_option", fields: ["id", "title"], filters: { product_id: selectedId },
          pagination: { take: 1, skip: 0, order: { id: "ASC" } } });
        const second = yield* operations.query.graph({ entity: "product_option", fields: ["id", "title"], filters: { product_id: selectedId },
          pagination: { take: 1, skip: 1, order: { id: "ASC" } } });
        expect(first.metadata).toEqual({ count: 2, skip: 0, take: 1 });
        expect(second.metadata).toEqual({ count: 2, skip: 1, take: 1 });
        expect([...first.data, ...second.data]).toEqual(all.data);
        expect((yield* operations.query.graph({ entity: "product_option", fields: ["id", "title"], filters: { product_id: selectedId },
          pagination: { order: { id: "DESC" } } })).data).toEqual([...all.data].reverse());
        expect((yield* operations.query.graph({ entity: "product_option", fields, filters: { title: "Material", product_id: selectedId } })).data)
          .toEqual([material]);
        expect((yield* parent(unrelatedId)).data).toEqual(unrelated);

        const beforeMissing = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(yield* operations.runWorkflow("update-product-options", { selector: { id: material.id, product_id: unrelatedId },
          update: { title: "Wrong parent", values: [] } })).toEqual({ result: [] });
        const { outcomes: _beforeOutcomes, ...beforeBusiness } = beforeMissing;
        const { outcomes: _afterOutcomes, ...afterBusiness } = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(afterBusiness).toEqual(beforeBusiness);

        const renamed = yield* operations.runWorkflow("update-product-options", { selector: { id: material.id, product_id: selectedId },
          update: { title: "Fabric" } });
        expect(renamed.result.map(row => decodeOption(row))).toEqual([{ ...material, title: "Fabric" }]);
        const replaced = yield* operations.runWorkflow("update-product-options", { selector: { id: material.id, product_id: selectedId },
          update: { values: ["Wool", "Cotton", "New"] } });
        const replacement = decodeOption(replaced.result[0]);
        for (const value of replacement.values) {
          const previous = material.values.find(candidate => candidate.value === value.value);
          expect(value.option_id).toBe(material.id);
          if (previous !== undefined) expect(value.id).toBe(previous.id);
          else expect(material.values.some(candidate => candidate.id === value.id)).toBe(false);
        }
        expect(replacement.values.map(value => value.value).sort()).toEqual(["Cotton", "New", "Wool"]);
        const reread = decodeOption((yield* operations.query.graph(query)).data[0]);
        // The native update returns incoming Value order; independent relation
        // reads use their stored order. Assert the complete identities and set.
        expect(reread).toEqual({ ...replacement, values: expect.arrayContaining([...replacement.values]) });
        expect(reread.values).toHaveLength(replacement.values.length);
        const cleared = yield* Effect.promise(() => engine.run("update-product-options", { input: {
          selector: { id: material.id, product_id: selectedId }, update: { values: [] }, additional_data: { origin: "native-option-clear" },
        } }));
        expect(cleared.result.map(row => decodeOption(row))).toEqual([{ ...replacement, values: [] }]);
        expect((yield* operations.query.graph(query)).data.map(row => decodeOption(row))).toEqual([{ ...replacement, values: [] }]);
        expect((yield* parent(unrelatedId)).data).toEqual(unrelated);
        const selected = (yield* parent(selectedId)).data;
        expect(selected.map(({ options: _options, ...row }) => row)).toEqual(original.map(({ options: _options, ...row }) => row));
        expect((yield* operations.query.graph({ entity: "product_option", fields, filters: { id: initialOptions.data[0]?.id, product_id: selectedId } })).data)
          .toEqual(initialOptions.data);

        const beforeRefusal = yield* Effect.promise(() => tested.fixture.snapshot());
        for (const [name, input] of [
          ["create-product-options", {}],
          ["create-product-options", { product_options: [{ title: "Oversized", product_id: selectedId, values: ["a", "b", "c", "d", "e"] }] }],
          ["create-product-options", { product_options: Array.from({ length: 5 }, (_, index) => ({ title: "Option " + index, product_id: selectedId })) }],
          ["create-product-options", { product_options: [{ title: 42, product_id: selectedId }] }],
          ["update-product-options", { selector: { id: material.id, product_id: selectedId }, update: { values: ["a", "b", "c", "d", "e"] } }],
          ["update-product-options", { selector: { id: material.id, product_id: selectedId }, update: { product_id: unrelatedId } }],
          ["update-product-options", { selector: { id: material.id, product_id: selectedId }, update: { id: material.id } }],
          ["update-product-options", { selector: { id: material.id, product_id: selectedId }, update: { id: "option_other" } }],
          ["update-product-options", { selector: { id: material.id, product_id: selectedId }, update: { values: [{ value: "object" }] } }],
        ] as const) {
          const result = yield* Effect.exit(operations.runWorkflow(name, input));
          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) &&
            reason.error.reason === "adapterFailure" && reason.error.cause instanceof MedusaError &&
            reason.error.cause.type === MedusaError.Types.INVALID_DATA)).toBe(true);
        }
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(beforeRefusal);
      }));
    } finally { await tested.fixture.close(); }
  }, 300_000);
});
