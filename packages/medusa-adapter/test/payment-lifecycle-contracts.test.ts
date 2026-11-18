import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { decodePaymentRead } from "../src/modules/payment/input";
import { capturePaymentMetadata } from "../src/modules/payment/schema";
import { preparePaymentSessionRepository } from "../src/modules/payment/repository";
import type { Logger } from "@medusajs/framework/types";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makePaymentLifecycleCommands } from "../src/modules/payment/lifecycle-service";
import { workflowModuleDefinition } from "../src/workflow/module";
import { planGraphFields } from "../src/local-graph/fields";
import { captureCommerceInput } from "../src/value/input";

describe("native Payment lifecycle prerequisites", () => {
  it("admits the native inverse-one Session.payment and nested captures selection", async () => {
    const metadata = await Effect.runPromise(capturePaymentMetadata());
    expect(metadata.frame.tables.find(table => table.name === "payment_session")?.relationships)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: "payment", type: "hasOne", mappedBy: "payment_session" })]));
    const repository = Result.getOrThrow(preparePaymentSessionRepository(metadata.frame));
    const query = repository.query(repository.contracts.session,
      Result.getOrThrow(captureCommerceInput(buildQuery({ id: "payses_lifecycle" }, { relations: ["payment", "payment.captures"] }))));
    expect(Result.isSuccess(query)).toBe(true);
  });
  it("authenticates native quantities before returning exactly the selected graph fields", async () => {
    const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
      progress() {}, error() {}, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {},
      http() {}, info() {}, warn() {}, log() {} };
    const runtime = await Effect.runPromise(makePaymentLifecycleCommands(logger));
    const read = workflowModuleDefinition(runtime.workflow)?.graph.reads.find(read => read.model === "Payment");
    if (read === undefined) throw new Error("Missing genuine Payment graph read");
    const raw = { value: "15", precision: 20 }, refundRaw = { value: "3.125", precision: 20 };
    const input = { id: "pay-projection", currency_code: "usd", captures: [{ id: "capt-projection", amount: 15, raw_amount: raw }],
      refunds: [{ id: "ref-projection", amount: 3.125, raw_amount: refundRaw }] };
    const native = await Effect.runPromise(runtime.contracts.present(input, runtime.contracts.payment.name));
    if (!isJsonObject(native)) throw new Error("Missing native Payment DTO");
    const fields = ["id", "currency_code", "captures.id", "captures.amount", "refunds.id", "refunds.amount"];
    const projected = Result.getOrThrow(Result.getOrThrow(planGraphFields(read, fields)).project([native]));
    expect(projected).toEqual([{ id: "pay-projection", currency_code: "usd", captures: [{ id: "capt-projection", amount: 15 }],
      refunds: [{ id: "ref-projection", amount: 3.125 }] }]);
    expect(Result.getOrThrow(Result.getOrThrow(planGraphFields(read, [...fields, "captures.raw_amount", "refunds.raw_amount"])).project([native])))
      .toMatchObject([{ captures: [{ raw_amount: raw }], refunds: [{ raw_amount: refundRaw }] }]);
    expect(await Effect.runPromise(Effect.result(runtime.contracts.present({ ...input,
      captures: [{ id: "capt-projection", amount: 15, raw_amount: { value: "16", precision: 20 } }] }, runtime.contracts.payment.name))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("admits the stored Link endpoint four-row read without changing complete catalog selection", async () => {
    const metadata = await Effect.runPromise(capturePaymentMetadata());
    const repository = Result.getOrThrow(preparePaymentSessionRepository(metadata.frame));
    const filters = { id: ["paycol-link-target"] }, config = { select: ["id"], relations: [], order: { id: "ASC" }, skip: 0, take: 4 };
    expect(Result.isSuccess(decodePaymentRead({ filters, config }))).toBe(true);
    const query = (take: number) => repository.query(repository.contracts.collection,
      Result.getOrThrow(captureCommerceInput(buildQuery(filters, { ...config, order: { id: "ASC" }, take }))));
    const complete = Result.getOrThrow(query(4));
    expect(complete.window.kind).toBe("catalog");
    expect(complete.query).not.toHaveProperty("take");
    for (const take of [15, 256]) {
      expect(Result.isSuccess(decodePaymentRead({ filters, config: { ...config, take } }))).toBe(true);
      const selected = Result.getOrThrow(query(take));
      expect(selected.query).toEqual(complete.query);
      expect(selected.projection.storageFields).toEqual(complete.projection.storageFields);
      expect(selected.window.kind).toBe("catalog");
      expect(selected.window.order).toBe(complete.window.order);
      const rows = [{ id: "first" }, { id: "second" }];
      expect(selected.window.select(rows)).toEqual({ rows, count: 2 });
    }
    for (const take of [0, 1, 5, 257]) {
      expect(Result.isFailure(decodePaymentRead({ filters, config: { ...config, take } }))).toBe(true);
      expect(Result.isFailure(query(take))).toBe(true);
    }
  });

});
