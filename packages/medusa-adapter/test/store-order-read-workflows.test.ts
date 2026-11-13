import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareStoreOrderReadWorkflows } from "../src/workflows/order/store-reads";
import { createStoreCartHttpHandler } from "@flarex/medusa-http/store-cart";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { captureWorkflowInput } from "../src/workflow/value";

const decode = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeQuery = Schema.decodeUnknownSync(Schema.StructWithRest(Schema.Struct({ filters: Schema.Record(Schema.String, Schema.Unknown) }),
  [Schema.Record(Schema.String, Schema.Unknown)]));
const detailInput = { fields: ["id"], order_id: "order-native", filters: { is_draft_order: false } };
const listInput = { fields: ["id"], variables: { filters: { customer_id: "customer-native", is_draft_order: false }, take: 50, skip: 0 } };
const raw = (value: string) => ({ value, precision: 20 });
const order = () => ({ id: "order-native", status: "pending", version: 1, currency_code: "usd",
  payment_collections: [{ status: "authorized", amount: 12.5, captured_amount: 0, refunded_amount: 0 }],
  fulfillments: [{ packed_at: "2026-01-01T00:00:00.000Z", shipped_at: null, delivered_at: null, canceled_at: null }],
  items: [{ id: "item-native", raw_quantity: raw("2"), detail: { raw_fulfilled_quantity: raw("1") } }],
});

describe("genuine native Store Order read workflows", () => {
  it("captures every full native fifty-Order intermediate within the named read budget", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({ ...order(), id: "order" + index,
      metadata: { values: Array.from({ length: 200 }, () => 0) } }));
    const page = { rows, metadata: { count: 50, skip: 0, take: 50 } };
    expect(captureWorkflowInput(page, "preserveOwnUndefined"))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    const reads = await Effect.runPromise(prepareStoreOrderReadWorkflows({ graph: () => Effect.die("List must use callable Query"),
      remoteQuery: () => Effect.succeed(page) }));
    const result = await Effect.runPromise(reads.list(listInput));
    expect(result).toMatchObject({ rows: rows.map(row => ({ id: row.id, metadata: row.metadata,
      payment_status: "authorized", fulfillment_status: "partially_fulfilled" })), metadata: page.metadata });
    const overflow = await Effect.runPromise(prepareStoreOrderReadWorkflows({ graph: () => Effect.die("List must use callable Query"),
      remoteQuery: () => Effect.succeed({ ...page, rows: rows.map(row => ({ ...row, metadata: { values: Array.from({ length: 1_400 }, () => 0) } })) }) }));
    expect(await Effect.runPromise(Effect.result(overflow.list(listInput))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });
  it("preserves the native detail filter omission and mandatory relation status aggregation", async () => {
    const calls: { value: unknown; options: unknown }[] = [];
    const reads = await Effect.runPromise(prepareStoreOrderReadWorkflows({
      graph: (value, options) => Effect.sync(() => { calls.push({ value, options });
        return { data: [order()], metadata: { count: 1, skip: 0, take: 50 } }; }),
      remoteQuery: () => Effect.die("Detail must use native Graph"),
    }));
    const result = decode(await Effect.runPromise(reads.detail(detailInput)));
    expect(result).toMatchObject({ id: "order-native", payment_status: "authorized", fulfillment_status: "partially_fulfilled" });
    expect(calls).toEqual([{ value: { entity: "order", fields: ["id", "status", "version", "payment_collections.*", "fulfillments.*"],
      filters: { is_draft_order: false, id: "order-native", version: undefined }, pagination: { skip: 0, take: 50 } },
      options: { throwIfKeyNotFound: true } }]);
    expect(Object.hasOwn(decodeQuery(calls[0]?.value).filters, "version")).toBe(true);
  });
  it("keeps the actual native counted page and removes only unrequested status relation bodies", async () => {
    const calls: unknown[] = [];
    const reads = await Effect.runPromise(prepareStoreOrderReadWorkflows({ graph: () => Effect.die("List must use callable Query"),
      remoteQuery: value => Effect.sync(() => { calls.push(value); return { rows: [order()], metadata: { count: 7, skip: 0, take: 50 } }; }),
    }));
    const result = decode(await Effect.runPromise(reads.list(listInput)));
    expect(result).toMatchObject({ rows: [{ id: "order-native", payment_status: "authorized", fulfillment_status: "partially_fulfilled" }],
      metadata: { count: 7, skip: 0, take: 50 } });
    const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(result.rows);
    expect(rows[0]).not.toHaveProperty("payment_collections");
    expect(rows[0]).not.toHaveProperty("fulfillments");
    expect(rows[0]).toHaveProperty("items");
    expect(calls).toEqual([{ entryPoint: "orders", fields: ["id", "status", "version", "items.*", "payment_collections.status",
      "payment_collections.amount", "payment_collections.captured_amount", "payment_collections.refunded_amount",
      "fulfillments.packed_at", "fulfillments.shipped_at", "fulfillments.delivered_at", "fulfillments.canceled_at"], variables: listInput.variables }]);
  });
  it("accepts the genuine Store route's own undefined default order through native workflow and Query", async () => {
    const variables = Schema.decodeUnknownSync(Schema.Struct({ variables: Schema.Record(Schema.String, Schema.Unknown) }));
    let produced: unknown, issued: unknown;
    const reads = await Effect.runPromise(prepareStoreOrderReadWorkflows({ graph: () => Effect.die("List must use callable Query"),
      remoteQuery: value => Effect.sync(() => { issued = value; return { rows: [order()], metadata: { count: 1, skip: 0, take: 50 } }; }),
    }));
    const handler = createStoreCartHttpHandler({ storeCors: "https://store.test", admitCartRefetchFields() {}, admitOrderReadFields() {},
      resolveCustomerPrincipal: () => ({ actor_id: "customer-native", actor_type: "customer", auth_identity_id: "auth-native", app_metadata: {}, user_metadata: {} }),
      createRequestScope: () => createContainer().register({ workflows: asValue({ run: async (name: string, options: { input: unknown }) => {
        expect(name).toBe("get-orders-list"); produced = options.input;
        return { result: await Effect.runPromise(reads.list(options.input)) };
      } }), query: asValue({ graph: async () => ({ data: [{ id: "apk-native", token: "pk-native", revoked_at: null,
        sales_channels_link: [{ sales_channel_id: "sc-native" }] }] }) }),
      logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }),
      }),
    });
    const response = await handler.handle(new Request("https://private.test/store/orders?fields=id", {
      headers: { "x-publishable-api-key": "pk-native", origin: "https://store.test" },
    }));
    expect(Object.hasOwn(variables(produced).variables, "order")).toBe(true);
    expect(variables(produced).variables.order).toBeUndefined();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ count: 1, offset: 0, limit: 50 });
    expect(Object.hasOwn(variables(issued).variables, "order")).toBe(true);
    expect(variables(issued).variables.order).toBeUndefined();
  });
  it("retains native zero-page count", async () => {
    const reads = await Effect.runPromise(prepareStoreOrderReadWorkflows({ graph: () => Effect.die("Unused Graph"),
      remoteQuery: () => Effect.succeed({ rows: [], metadata: { count: 7, skip: 0, take: 0 } }),
    }));
    expect(await Effect.runPromise(reads.list({ ...listInput, variables: { ...listInput.variables, take: 0 } })))
      .toEqual({ rows: [], metadata: { count: 7, skip: 0, take: 0 } });
  });
  it("retains requested native Payment and Fulfillment relation bodies", async () => {
    const reads = await Effect.runPromise(prepareStoreOrderReadWorkflows({ graph: () => Effect.die("Unused Graph"),
      remoteQuery: () => Effect.succeed({ rows: [order()], metadata: { count: 1, skip: 0, take: 50 } }),
    }));
    expect(await Effect.runPromise(reads.list({ ...listInput, fields: ["id", "payment_collections", "fulfillments"] })))
      .toMatchObject({ rows: [{ payment_collections: order().payment_collections, fulfillments: order().fulfillments,
        payment_status: "authorized", fulfillment_status: "partially_fulfilled" }] });
  });
  it("refuses malformed verified-list input and getters before invoking a read", async () => {
    let calls = 0, getters = 0;
    const reads = await Effect.runPromise(prepareStoreOrderReadWorkflows({ graph: () => Effect.sync(() => { calls++; return {}; }),
      remoteQuery: () => Effect.sync(() => { calls++; return {}; }),
    }));
    const bad = [{ ...listInput, variables: { ...listInput.variables, filters: { is_draft_order: false } } },
      { ...listInput, variables: { ...listInput.variables, filters: { ...listInput.variables.filters, is_draft_order: true } } },
      Object.defineProperty({}, "fields", { enumerable: true, get() { getters++; return ["id"]; } })];
    for (const input of bad) expect(Exit.isFailure(await Effect.runPromiseExit(reads.list(input)))).toBe(true);
    expect(calls).toBe(0); expect(getters).toBe(0);
  });
  it("preserves typed failure together with defects and drains the protected read", async () => {
    const refused = commerceError("storedCorruption"), defect = new Error("native-read-defect");
    let drained = false;
    const reads = await Effect.runPromise(prepareStoreOrderReadWorkflows({ graph: () => Effect.failCause(
      Cause.combine(Cause.fail(refused), Cause.die(defect))).pipe(Effect.ensuring(Effect.sync(() => { drained = true; }))),
      remoteQuery: () => Effect.die("Unused callable Query"),
    }));
    const result = await Effect.runPromiseExit(reads.detail(detailInput));
    expect(drained).toBe(true);
    if (Exit.isSuccess(result)) throw new Error("Expected failed native read");
    expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === refused)).toBe(true);
    expect(result.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
  });
});
