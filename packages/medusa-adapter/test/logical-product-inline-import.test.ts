import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Exit, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { fxSystemExternalEffectAttemptsV1, fxSystemDurableTaskRunsV1 } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { makeCommitEventStore } from "../../persistence-postgres/src/commit/events/store";
import { commitEventLimits } from "../../persistence-postgres/src/commit/events/model";
import { prepareProductInlineImportInput } from "../src/workflows/product/import-inline-input";
import { logicalProductInlineImportFixture, inlineImportSubscriber } from "./support/logical-product-inline-import-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { notificationLogger } from "./support/notification-logger";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const logger = notificationLogger();
let fixture: Awaited<ReturnType<typeof logicalProductInlineImportFixture>>;
let reader: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
const header = "Product Handle,Product Title,Variant Title,Variant SKU,Variant Option 1 Name,Variant Option 1 Value\n";
const body = (key: string) => ({ filename: key + ".csv", fileContent: header + `${key},${key},Blue,${key}-sku,Color,Blue\n` });
const events = () => fixture.connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const effects = () => fixture.connected.fixture.persistence.drizzle.select().from(fxSystemExternalEffectAttemptsV1);
const products = (handle: string) => Effect.runPromise(reader.host.read(reader.runtime.commands.internalProductList,
  { filters: { handle }, config: { relations: ["variants", "options"] } }));

describe(`complete native inline Product import - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    fixture = await logicalProductInlineImportFixture(driver, close => cleanup.push(close), logger);
    reader = await prepareLogicalProductHost(fixture.connected.fixture);
    cleanup.push(() => Effect.runPromise(reader.host.close));
  }, 300_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("returns the native summary, durably waits without commerce, and cold-resumes once through the actual Product and Notification owners", async () => {
    const first = await fixture.prepare(), input = body("inline-" + randomUUID());
    const prepared = await Effect.runPromise(prepareProductInlineImportInput(input));
    const before = await events(), beforeEffects = await effects();
    const key = randomUUID();
    const create = vi.spyOn(ProductModuleService.prototype, "createProducts");
    try {
      const started = await Effect.runPromise(first.driver.start(key, prepared.reference, input));
      expect(started, JSON.stringify(started, (_key, value: unknown) => typeof value === "bigint" ? String(value) : value))
        .toMatchObject({ status: { phase: "continuation_waiting" }, summary: { toCreate: 1, toUpdate: 0 } });
      expect(await events()).toEqual(before); expect(await effects()).toEqual(beforeEffects);
      expect(await products(input.filename.slice(0, -4))).toEqual([]); expect(create).not.toHaveBeenCalled();
      const taskRows = await fixture.connected.fixture.persistence.drizzle.select().from(fxSystemDurableTaskRunsV1);
      expect(taskRows.find(row => row.runId === started.runId)).toMatchObject({ currentAttemptId: null, currentLeaseExpiresAtMs: null });
      const cold = await fixture.prepare();
      expect(await Effect.runPromise(cold.driver.start(key, prepared.reference, input))).toMatchObject({
        runId: started.runId, summary: { toCreate: 1, toUpdate: 0 }, status: { phase: "continuation_waiting" } });
      await Effect.runPromise(cold.driver.confirm(started.runId));
      const completed = await Effect.runPromise(cold.driver.advance(started.runId, input));
      expect(completed).toMatchObject({ status: { phase: "terminal", terminal: { kind: "succeeded" } },
        summary: { toCreate: 1, toUpdate: 0 }, errors: [] });
      expect(create).toHaveBeenCalledTimes(1);
      const rows = await products(input.filename.slice(0, -4));
      expect(rows).toMatchObject([{ title: input.filename.slice(0, -4), variants: [{ sku: input.filename.slice(0, -4) + "-sku" }] }]);
      const committed = await events(), recorded = await effects();
      const own = recorded.filter(row => !beforeEffects.some(old => old.stableEffectKey === row.stableEffectKey));
      expect(own.filter(row => row.effectKind === "child_commerce")).toHaveLength(3);
      expect(own.filter(row => row.effectKind === "trusted_callback")).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledTimes(1);
      const store = await Effect.runPromise(makeCommitEventStore(fixture.connected.fixture.hostInput));
      for (const commitSeq of new Set(committed.slice(before.length).map(event => event.commitSeq)))
        expect(await Effect.runPromise(store.claimBatch(commitSeq, [inlineImportSubscriber], commitEventLimits.claimBatch))).not.toEqual([]);
      const terminal = await fixture.prepare();
      expect(await Effect.runPromise(terminal.driver.advance(started.runId, input))).toMatchObject({
        status: { phase: "terminal", terminal: { kind: "succeeded" } }, summary: { toCreate: 1, toUpdate: 0 } });
      expect(await events()).toEqual(committed); expect(await effects()).toEqual(recorded);
      expect(create).toHaveBeenCalledTimes(1); expect(logger.info).toHaveBeenCalledTimes(1);
    } finally { create.mockRestore(); }
  }, 180_000);

  it("preserves native pending cancellation and retires its lease until the original confirmation deadline", async () => {
    const first = await fixture.prepare(), input = body("cancel-" + randomUUID());
    const prepared = await Effect.runPromise(prepareProductInlineImportInput(input));
    const before = await events(), recorded = await effects(), sends = vi.mocked(logger.info).mock.calls.length;
    const started = await Effect.runPromise(first.driver.start(randomUUID(), prepared.reference, input));
    const waiting = await Effect.runPromise(first.driver.inspect(started.runId));
    const deadline = waiting.current.continuation?.deadlineAtMs;
    if (deadline === undefined) throw new Error("Missing genuine confirmation deadline");
    await Effect.runPromise(first.driver.cancel(started.runId));
    const cold = await fixture.prepare();
    const cancelled = await Effect.runPromise(cold.driver.advance(started.runId, input));
    expect(cancelled.status).toMatchObject({ phase: "continuation_ready", executionMode: "control", cancellation: { kind: "requested" } });
    if (cancelled.status.phase !== "continuation_ready") throw new Error("Expected the genuine pending control retry");
    expect(cancelled.status.continuation.controlRetry?.notBeforeMs).toBeGreaterThan(deadline);
    const current = (await Effect.runPromise(cold.driver.inspect(started.runId))).current;
    const taskRows = await fixture.connected.fixture.persistence.drizzle.select().from(fxSystemDurableTaskRunsV1);
    expect(taskRows.find(row => row.runId === started.runId)).toMatchObject({ currentAttemptId: null, currentLeaseExpiresAtMs: null });
    expect((await Effect.runPromise(cold.driver.advance(started.runId, input))).status).toEqual(current);
    expect(await products(input.filename.slice(0, -4))).toEqual([]);
    expect(await events()).toEqual(before); expect(await effects()).toEqual(recorded);
    expect(logger.info).toHaveBeenCalledTimes(sends);
  }, 180_000);

  it("preserves the genuine empty branch and native malformed-CSV failure before confirmation", async () => {
    const host = await fixture.prepare(), input = { filename: "empty.csv", fileContent: header };
    const prepared = await Effect.runPromise(prepareProductInlineImportInput(input));
    const started = await Effect.runPromise(host.driver.start(randomUUID(), prepared.reference, input));
    expect(started.summary).toEqual({ toCreate: 0, toUpdate: 0 });
    await Effect.runPromise(host.driver.confirm(started.runId));
    expect(await Effect.runPromise(host.driver.advance(started.runId, input)))
      .toMatchObject({ status: { phase: "terminal", terminal: { kind: "succeeded" } }, summary: { toCreate: 0, toUpdate: 0 } });
    const bad = { filename: "bad.csv", fileContent: "Unknown One,Product Handle\nx,shirt\n" };
    const badInput = await Effect.runPromise(prepareProductInlineImportInput(bad));
    const before = await events(), recorded = await effects();
    const failed = await Effect.runPromise(host.driver.start(randomUUID(), badInput.reference, bad));
    expect(failed.status).toMatchObject({ phase: "terminal", terminal: { kind: "failed" } });
    expect(failed).toMatchObject({ errors: expect.arrayContaining([
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining("Invalid column name") }) }),
    ]) });
    expect(await events()).toEqual(before); expect(await effects()).toEqual(recorded);
  }, 180_000);

  it("refuses complete normalized graphs outside the selected profile before confirmation", async () => {
    const host = await fixture.prepare();
    const before = await events(), recorded = await effects();
    const prefix = "refused-" + randomUUID();
    const inputs = [
      { filename: "five.csv", fileContent: header + Array.from({ length: 5 }, (_, index) =>
        `${prefix}-${index},Product ${index},Blue,${prefix}-${index}-sku,Color,Blue\n`).join("") },
      { filename: "records.csv", fileContent: header + Array.from({ length: 65 }, (_, index) =>
        `${prefix},Product,Blue ${index},${prefix}-${index}-sku,Color,Blue\n`).join("") },
      { filename: "optional.csv", fileContent: header.trimEnd() + ",Variant EAN\n" +
        `${prefix},Product,Blue,${prefix}-sku,Color,Blue,12345\n` },
    ];
    for (const input of inputs) {
      const prepared = await Effect.runPromise(prepareProductInlineImportInput(input));
      const rejected = await Effect.runPromise(host.driver.start(randomUUID(), prepared.reference, input));
      expect(rejected.status).toMatchObject({ phase: "terminal", terminal: { kind: "failed" } });
      expect(rejected.errors?.length).toBeGreaterThan(0);
    }
    expect(await events()).toEqual(before); expect(await effects()).toEqual(recorded);
  }, 180_000);

  it("binds retries to the original input and preserves cancellation when confirmation races it", async () => {
    const first = await fixture.prepare(), input = body("race-" + randomUUID());
    const prepared = await Effect.runPromise(prepareProductInlineImportInput(input));
    const started = await Effect.runPromise(first.driver.start(randomUUID(), prepared.reference, input));
    const before = (await Effect.runPromise(first.driver.inspect(started.runId))).current;
    const changed = await Effect.runPromiseExit(first.driver.advance(started.runId, { ...input, filename: "changed.csv" }));
    expect(Exit.isFailure(changed)).toBe(true);
    expect((await Effect.runPromise(first.driver.inspect(started.runId))).current).toEqual(before);
    const cold = await fixture.prepare();
    await Promise.all([Effect.runPromise(first.driver.confirm(started.runId)), Effect.runPromise(cold.driver.cancel(started.runId))]);
    expect(await Effect.runPromise(cold.driver.advance(started.runId, input)))
      .toMatchObject({ status: { phase: "continuation_ready", executionMode: "control", cancellation: { kind: "requested" } } });
    expect(await products(input.filename.slice(0, -4))).toEqual([]);
  }, 180_000);

  it("retains committed Products and clears parent events when native Notification delivery and child compensation fail", async () => {
    const host = await fixture.prepare(), input = body("provider-failure-" + randomUUID());
    const prepared = await Effect.runPromise(prepareProductInlineImportInput(input));
    const before = await events(), recorded = await effects();
    const started = await Effect.runPromise(host.driver.start(randomUUID(), prepared.reference, input));
    await Effect.runPromise(host.driver.confirm(started.runId));
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error("Local feed rejected the success Notification"); });
    const failed = await Effect.runPromise(host.driver.advance(started.runId, input));
    expect(failed.status).toMatchObject({ phase: "terminal", terminal: { kind: "failed" } });
    expect(failed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "send-notifications", handlerType: "invoke" }),
      expect.objectContaining({ action: "batch-products-as-step", handlerType: "compensate" }),
    ]));
    expect(await products(input.filename.slice(0, -4))).toHaveLength(1);
    const committed = await events(), outcomes = await effects();
    const own = outcomes.filter(row => !recorded.some(old => old.stableEffectKey === row.stableEffectKey));
    expect(own.filter(row => row.effectKind === "child_commerce")).toHaveLength(5);
    expect(own.filter(row => row.effectKind === "trusted_callback")).toHaveLength(2);
    const store = await Effect.runPromise(makeCommitEventStore(fixture.connected.fixture.hostInput));
    for (const commitSeq of new Set(committed.slice(before.length).map(event => event.commitSeq)))
      expect(await Effect.runPromise(store.claimBatch(commitSeq, [inlineImportSubscriber], commitEventLimits.claimBatch))).toEqual([]);
    const cold = await fixture.prepare();
    expect((await Effect.runPromise(cold.driver.advance(started.runId, input))).status)
      .toMatchObject({ phase: "terminal", terminal: { kind: "failed" } });
    expect(await events()).toEqual(committed); expect(await effects()).toEqual(outcomes);
  }, 180_000);
});
