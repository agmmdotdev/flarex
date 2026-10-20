import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { createStep, createWorkflow, parallelize, transform, when, WorkflowResponse, type PreparedWorkflow, type WorkflowData } from "@medusajs/workflows-sdk";
import { createProductTagsWorkflow } from "@medusajs/core-flows/product/create-product-tags";
import { deleteProductTagsWorkflow } from "@medusajs/core-flows/product/delete-product-tags";
import { prepareProductTagComposition, type ProductTagCompositionHooks } from "../src/workflows/product/tag-composition";
import { composedProductTagEvents } from "../src/workflows/product/tag-events";
import { currencyWorkflowModule } from "../src/modules/currency/service";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import type { ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productCallReceipts } from "../src/modules/product/events/call-receipts";
import { CommonEvents, Modules } from "@medusajs/framework/utils/portable";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { fxAppRowCurrent } from "../../persistence-postgres/src/database/schema";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commit/events/schema";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { defineCommerceEventContract, type ParticipantEventSelection, type CommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, type CommerceTransactionError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const cleanup: Array<() => Promise<void>> = [];
const driver = process.env.FLAREX_TEST_DRIVER ?? process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Medusa comparison driver");
let fixture: { currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  product: Awaited<ReturnType<typeof prepareLogicalProductHost>> };
let policy: typeof fixture.product.runtime.logicalPolicy;
let catalog: ProductRuntimeMetadata;
let revision: string;
const subscribers = [{ id: "composition", revision: "a".repeat(64) }];
const inventory = async () => ({ logical: await logicalCurrencyInventory(fixture.currency),
  productRows: await fixture.currency.persistence.drizzle.select().from(fxAppRowCurrent),
  events: await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
  deliveries: await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEventDeliveries).orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal),
});
const execution = (session = fixture.currency.session) => ({ identityAndAccessPolicy: fixture.product.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...fixture.product.hostInput, session, ...composition }),
});
const modules = () => ({ product: { module: fixture.product.runtime.workflow,
    logicalStorage: fixture.product.hostInput.logicalStorage },
  currency: { module: Result.getOrThrow(currencyWorkflowModule), logicalStorage: fixture.currency.hostInput.logicalStorage } });
const options = (hooks?: ProductTagCompositionHooks) => ({ execution: execution(), modules: modules(), revision, subscribers, ...(hooks === undefined ? {} : { hooks }) });
const args = (value: string) => ({ value, updated_value: `${value}-updated` });
const resources = () => Result.getOrThrow(prepareWorkflowResources({
  product: { module: fixture.product.runtime.workflow, methods: ["createProductTags", "listProductTags", "updateProductTags", "softDeleteProductTags"], graph: true },
  currency: { module: Result.getOrThrow(currencyWorkflowModule), methods: [], graph: true },
}, true));
const Input = Schema.Struct({ value: Schema.String, enabled: Schema.Boolean });
const raw = async (build: (selection: ReturnType<typeof resources>) => PreparedWorkflow,
  output: Schema.ConstraintDecoder<Schema.Json> = Schema.Json, operationScheduling?: "queued") => {
  const selection = resources();
  return runEffect(prepareAtomicWorkflowHost({ ...options(), ...(operationScheduling === undefined ? {} : { operationScheduling }), workflow: {
    name: "composeTagScenario", resources: selection, prepared: build(selection), input: Input, output,
    events: composedProductTagEvents({ create: fixture.product.runtime.workflow.methods.createProductTags,
      update: fixture.product.runtime.workflow.methods.updateProductTags, delete: fixture.product.runtime.workflow.methods.softDeleteProductTags }),
  } }));
};

describe("native composed Product workflows", () => {
  beforeAll(async () => {
    const hash = createHash("sha256");
    for (const root of ["../src/", "../../medusa-workflows-sdk/src/", "../../medusa-core-flows/src/"]) {
      const directory = new URL(root, import.meta.url);
      for (const path of (await readdir(directory, { recursive: true })).filter(path => path.endsWith(".ts")).sort()) {
        hash.update(path); hash.update(await readFile(new URL(path.replaceAll("\\", "/"), directory)));
      }
    }
    hash.update(await readFile(new URL(import.meta.url))); revision = hash.digest("hex");
    const currency = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    const product = await prepareLogicalProductHost(currency);
    await runEffect(product.host.initialize([]));
    await runEffect(product.host.close);
    fixture = { currency, product };
    catalog = await runEffect(captureProductSchema("atomic-commerce").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    policy = fixture.product.runtime.logicalPolicy;
  }, 150_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Logical composition cleanup failed");
  });

  it("requires one authenticated lifecycle observation for each deleted tag", async () => {
    const stamp = "2026-09-24T00:00:00.000Z";
    const mutations = ["tag-a", "tag-b"].map((id, ordinal) => ({ ordinal, table: catalog.tag.table.name,
      operation: "patch" as const, before: { id, deleted_at: null }, after: { id, deleted_at: stamp } }));
    const lifecycle = ["tag-a", "tag-b"].map((id, attemptOrdinal) => ({ table: catalog.tag.table.name,
      key: { id }, operation: "softDelete" as const, beforeDeletedAt: null, afterDeletedAt: stamp, attemptOrdinal, rowAtOperation: null }));
    const calls = [{ commandName: "productSoftDeleteTag", mode: "write" as const, input: null, result: null,
      events: [{ name: catalog.tag.deletedEvent, metadata: { source: Modules.PRODUCT,
        object: catalog.tag.eventObject, action: CommonEvents.DELETED }, data: { id: ["tag-a", "tag-b"] } }],
      fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 2 }];
    await runEffect(productCallReceipts(catalog).validateLogicalCall(calls[0]!, { mutations, lifecycle, observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] }));
    expect(await runEffectFailure(productCallReceipts(catalog).validateLogicalCall(calls[0]!, { mutations,
      lifecycle: [lifecycle[0]!, { ...lifecycle[1]!, key: { id: "tag-a" }, attemptOrdinal: 0 }],
      observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] })))
      .toMatchObject({ reason: "receiptMismatch" });
  });

  it("runs real create/update children, reads pending graphs and publishes one ordered root", async () => {
    const hooks: string[] = [];
    const before = await inventory();
    const host = await runEffect(prepareProductTagComposition(options({
      created: async (input, { resources }) => {
        hooks.push("created");
        expect(await resources.query.graph({ entity: "product_tag", fields: ["id", "value"], filters: { id: input.product_tags.map(tag => tag.id) }, pagination: { take: 1 } }))
          .toMatchObject({ data: [{ value: "composed" }] });
        expect(await resources.query.graph({ entity: "currency", fields: ["code"], filters: { code: "usd" }, pagination: { take: 1 } })).toMatchObject({ data: [{ code: "usd" }] });
        if (driver === "postgres") expect(await inventory()).toEqual(before);
      },
      updated: async (input, { resources }) => {
        hooks.push("updated");
        expect(await resources.query.graph({ entity: "product_tag", fields: ["value"], filters: { id: input.product_tags.map(tag => tag.id) }, pagination: { take: 1 } }))
          .toMatchObject({ data: [{ value: "composed-updated" }] });
        if (driver === "postgres") expect(await inventory()).toEqual(before);
      },
    })));
    const key = host.newRequestKey(); const result = await runEffect(host.run(key, args("composed")));
    expect(result).toMatchObject([{ value: "composed-updated" }]); expect(hooks).toEqual(["created", "updated"]);
    const after = await inventory();
    expect(after.logical.commits).toHaveLength(before.logical.commits.length + 1);
    expect(after.logical.outcomes).toHaveLength(before.logical.outcomes.length + 1);
    expect(after.logical.wakes).toHaveLength(before.logical.wakes.length + 1);
    const events = after.events.slice(before.events.length);
    expect(events.map(row => row.envelope.contract)).toEqual(["product.product-tag.created", "product-tag.created", "product.product-tag.updated", "product-tag.updated"]);
    expect(events.map(row => row.eventOrdinal)).toEqual([0, 1, 2, 3]);
    expect(events.map(row => row.envelope.internal)).toEqual([true, false, true, false]);
    expect(events.every(row => row.envelope.group === key)).toBe(true);
    expect(new Set(events.map(row => row.commitSeq)).size).toBe(1);
    expect(after.logical.commits.at(-1)?.eventCount).toBe(4);
    expect(after.deliveries).toHaveLength(before.deliveries.length + 4);
    const facts = after.logical.physicalFacts.slice(before.logical.physicalFacts.length);
    expect(facts.map(fact => fact.changeOrdinal)).toEqual(facts.map((_, index) => index));
    expect(await runEffect(host.run(key, args("composed")))).toEqual(result);
    expect(hooks).toEqual(["created", "updated"]); expect(await inventory()).toEqual(after);
    const changed = await runEffect(prepareProductTagComposition(options()));
    expect(await runEffectFailure(changed.run(key, args("composed")))).toMatchObject({ reason: "requestConflict" });
  }, 30_000);

  it("runs a native Product child alongside a Currency graph read under one settlement", async () => {
    const reached = await runEffect(Deferred.make<void>());
    let entered = 0;
    const rendezvous = async () => {
      if (++entered === 2) await runEffect(Deferred.succeed(reached, undefined));
      await runEffect(Deferred.await(reached).pipe(Effect.timeout(5_000)));
    };
    const host = await raw(selection => {
      const currencyRead = createStep("parallel-currency-read", selection.callback(async (_: undefined, { resources }) => {
        const result = await resources.query.graph({ entity: "currency", fields: ["code"], filters: { code: "usd" }, pagination: { take: 1 } });
        await rendezvous();
        return result.data;
      }));
      return Result.getOrThrow(createWorkflow("parallel-product-currency", (input: WorkflowData<typeof Input.Type>) => {
        const product = createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] },
          hooks: { productTagsCreated: selection.callback(async (value, { resources }) => {
            expect(await resources.query.graph({ entity: "product_tag", fields: ["value"], filters: { id: value.product_tags.map(tag => tag.id) }, pagination: { take: 1 } }))
              .toMatchObject({ data: [{ value: "parallel-product" }] });
            await rendezvous();
          }) },
        });
        return new WorkflowResponse(parallelize(product, currencyRead(undefined)));
      }).prepare());
    }, Schema.Json, "queued");
    const before = await inventory(), key = host.newRequestKey();
    const input = { value: "parallel-product", enabled: true };
    const result = await runEffect(host.run(key, input));
    expect(result).toMatchObject([[{ value: "parallel-product" }], [{ code: "usd" }]]);
    expect(entered).toBe(2);
    const after = await inventory();
    expect(after.logical.commits).toHaveLength(before.logical.commits.length + 1);
    expect(after.logical.outcomes).toHaveLength(before.logical.outcomes.length + 1);
    expect(after.events.slice(before.events.length).map(row => row.envelope.contract))
      .toEqual(["product.product-tag.created", "product-tag.created"]);
    expect(await runEffect(host.run(key, input))).toEqual(result);
    expect(entered).toBe(2);
    expect(await inventory()).toEqual(after);
  }, 30_000);

  it("isolates renamed repeated children and completely skips conditional children", async () => {
    const calls: string[] = [];
    const host = await raw(selection => Result.getOrThrow(createWorkflow("repeated-tags", (input: WorkflowData<typeof Input.Type>) => {
      const first = createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] },
        hooks: { productTagsCreated: selection.callback(() => { calls.push("first"); }) } }).config({ name: "first" });
      const second = when("enabled", input.enabled, value => value).then(() => createProductTagsWorkflow.runAsStep({
        input: { product_tags: [{ value: transform(input.value, value => `${value}-second`) }] },
        hooks: { productTagsCreated: selection.callback(() => { calls.push("second"); }) },
      }).config({ name: "second" }));
      return new WorkflowResponse(transform({ first, second }, value => ({ first: value.first, second: value.second ?? null })));
    }).prepare()));
    const before = await inventory();
    expect(await runEffect(host.run(host.newRequestKey(), { value: "repeated", enabled: true }))).toMatchObject({ first: [{ value: "repeated" }], second: [{ value: "repeated-second" }] });
    expect(calls).toEqual(["first", "second"]);
    expect(await runEffect(host.run(host.newRequestKey(), { value: "skipped", enabled: false }))).toMatchObject({ first: [{ value: "skipped" }], second: null });
    expect(calls).toEqual(["first", "second", "first"]);
    expect((await inventory()).events).toHaveLength(before.events.length + 6);
  }, 30_000);

  it("keeps delete-child void as intermediate absence and commits creation plus deletion", async () => {
    const host = await raw(() => Result.getOrThrow(createWorkflow("create-delete-tag", (input: WorkflowData<typeof Input.Type>) => {
      const created = createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] } });
      const deleted = deleteProductTagsWorkflow.runAsStep({ input: { ids: transform(created, tags => tags.map(tag => tag.id)) } });
      return new WorkflowResponse(transform({ created, deleted }, value => {
        expect(value.deleted).toBeUndefined(); return value.created.map(tag => tag.id);
      }));
    }).prepare()));
    const before = await inventory();
    const ids = await runEffect(host.run(host.newRequestKey(), { value: "created-deleted", enabled: true }));
    expect(ids).toEqual([expect.any(String)]);
    if (!Array.isArray(ids) || typeof ids[0] !== "string") throw new Error("Expected a created tag ID");
    const reader = await raw(selection => {
      const read = createStep("read-deleted-tag", selection.callback(async (id: string, { resources }) =>
        (await resources.query.graph({ entity: "product_tag", fields: ["id"], filters: { id }, pagination: { take: 1 } })).data));
      return Result.getOrThrow(createWorkflow("read-deleted-tag", (input: WorkflowData<typeof Input.Type>) =>
        new WorkflowResponse(read(input.value))).prepare());
    });
    expect(await runEffect(reader.run(reader.newRequestKey(), { value: ids[0], enabled: true }))).toEqual([]);
    expect((await inventory()).events.slice(before.events.length).map(row => row.envelope.contract))
      .toEqual(["product.product-tag.created", "product-tag.created", "product.product-tag.deleted", "product-tag.deleted"]);
  }, 30_000);

  it("rolls back late child, hook, graph and event refusals even when caught", async () => {
    const cases: NonNullable<ProductTagCompositionHooks["updated"]>[] = [
      () => { throw new Error("late child hook failure"); },
      async (_input, { resources }) => { try { await resources.query.graph({ entity: "external", fields: ["id"] }); } catch { /* refusal remains sticky */ } },
      async (_input, { resources }) => { try { await resources.event_bus.emit([{ name: "unselected", data: {} }]); } catch { /* refusal remains sticky */ } },
      async (_input, { container }) => {
        const service = container.resolve<{ omittedUnsupported(): Promise<void> }>("product");
        try { await service.omittedUnsupported(); } catch { /* Root must roll back both completed children. */ }
      },
      () => Symbol("invalid hook output"),
    ];
    const before = await inventory();
    for (const updated of cases) {
      const host = await runEffect(prepareProductTagComposition(options({ updated })));
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), args("refused-child")))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  }, 30_000);

  it("rolls back late parent and root output failure and wrong selection", async () => {
    const before = await inventory();
    for (const mode of ["parent", "output", "selection"] as const) {
      const foreign = resources();
      const host = await raw(selection => Result.getOrThrow(createWorkflow("refused-parent", (input: WorkflowData<typeof Input.Type>) => {
        const created = createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] },
          hooks: mode === "selection" ? { productTagsCreated: foreign.callback(() => null) } : {},
        });
        const after = createStep("after-child", selection.callback(() => {
          if (mode === "parent") throw new Error("parent failed after child completed");
          return null;
        }));
        after(undefined); return new WorkflowResponse(created);
      }).prepare()), mode === "output" ? Schema.Null : Schema.Json);
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), { value: `refused-${mode}`, enabled: true }))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  }, 30_000);

  it("charges individually bounded child outputs against the shared root byte budget", async () => {
    // A few individually valid values exhaust bytes well before the 64-call
    // ceiling, so a generic limit failure cannot accidentally prove call limits.
    const evaluate = vi.fn(() => "x".repeat(192_000));
    const payload = createStep("payload", evaluate);
    const child = createWorkflow("bounded-payload", () => new WorkflowResponse(payload(undefined)));
    const host = await raw(() => Result.getOrThrow(createWorkflow("shared-byte-budget", (input: WorkflowData<typeof Input.Type>) => {
      createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] } });
      for (let index = 0; index < 12; index++) child.runAsStep({ input: undefined }).config({ name: `payload-${index}` });
      return new WorkflowResponse(null);
    }).prepare()));
    const before = await inventory();
    const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), { value: "bounded-children", enabled: true })));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toContain("limitExceeded");
    expect(evaluate.mock.calls.length).toBeGreaterThan(1); expect(evaluate.mock.calls.length).toBeLessThan(5);
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("binds literal child configuration into replay without changing the bundle revision", async () => {
    const make = (value: string) => raw(() => Result.getOrThrow(createWorkflow("configured-parent", () => new WorkflowResponse(
      createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value }] } }),
    )).prepare()));
    const first = await make("captured-first"), changed = await make("captured-second");
    const key = first.newRequestKey(), input = { value: "same-root-input", enabled: true };
    expect(await runEffect(first.run(key, input))).toMatchObject([{ value: "captured-first" }]);
    const after = await inventory();
    expect(await runEffectFailure(changed.run(key, input))).toMatchObject({ reason: "requestConflict" });
    expect(await inventory()).toEqual(after);
  }, 30_000);

  it("cancels a child hook and revokes its borrowed resources", async () => {
    const reached = await runEffect(Deferred.make<void>());
    let release: (() => void) | undefined;
    const wait = new Promise<void>(resolve => { release = resolve; });
    let escaped: Parameters<NonNullable<ProductTagCompositionHooks["updated"]>>[1]["resources"] | undefined;
    const host = await runEffect(prepareProductTagComposition(options({ updated: async (_input, { resources }) => {
      escaped = resources; await runEffect(Deferred.succeed(reached, undefined)); await wait;
    } })));
    const before = await inventory();
    try {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), args("cancel-child")));
        yield* Deferred.await(reached).pipe(Effect.timeout(5000));
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(exit.cause.reasons.length).toBeGreaterThan(0);
          expect(exit.cause.reasons.every(Cause.isInterruptReason)).toBe(true);
        }
      })));
    } finally { release?.(); }
    await expect(escaped?.query.graph({ entity: "currency", fields: ["code"], pagination: { take: 1 } })).rejects.toMatchObject({ reason: "closed" });
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("recovers a lost root acknowledgement without repeating either child", async () => {
    const called = vi.fn(); let lose = true;
    const session = issueRelationalSession(fixture.currency.persistence.drizzle, (profile, work) => runRelationalSession(fixture.currency.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: "lost composition acknowledgement" })); }),
    ));
    const host = await runEffect(prepareProductTagComposition({ ...options({ created: called, updated: called }), execution: execution(session) }));
    const before = await inventory(); const key = host.newRequestKey();
    const result = await runEffect(host.run(key, args("recovered-composition")));
    expect(result).toMatchObject([{ value: "recovered-composition-updated" }]); expect(called).toHaveBeenCalledTimes(2);
    expect((await inventory()).events).toHaveLength(before.events.length + 4);
    expect(await runEffect(host.run(key, args("recovered-composition")))).toEqual(result); expect(called).toHaveBeenCalledTimes(2);
  }, 30_000);

  it.skipIf(driver !== "postgres")("settles concurrent duplicate roots once", async () => {
    const called = vi.fn(); const host = await runEffect(prepareProductTagComposition(options({ created: called, updated: called })));
    const before = await inventory(); const key = host.newRequestKey();
    const [first, second] = await runEffect(Effect.all([
      host.run(key, args("concurrent-composition")), host.run(key, args("concurrent-composition")),
    ], { concurrency: 2 }));
    expect(first).toEqual(second); expect(called).toHaveBeenCalledTimes(2);
    expect((await inventory()).logical.commits).toHaveLength(before.logical.commits.length + 1);
  }, 30_000);

  it("checks event selection in core independently of the adapter", async () => {
    const participant = defineAtomicCommerceParticipant("eventProducer");
    const first = defineCommerceEventContract({ name: "first.internal", revision, internal: true, decode: value => Effect.succeed(value === null ? null : "first") });
    const second = defineCommerceEventContract({ name: "second.internal", revision, internal: true, decode: () => Effect.succeed("second") });
    const external = defineCommerceEventContract({ name: "external.only", revision, internal: false, decode: () => Effect.succeed(null) });
    const unlisted = defineCommerceEventContract({ name: "unlisted.internal", revision, internal: true, decode: () => Effect.succeed(null) });
    // SAFETY: deliberately forged token exercises runtime authentication.
    const forged = Object.freeze({}) as CommerceEventContract;
    let message: unknown = { payload: "owned" };
    const failures: CommerceTransactionError[] = [];
    const emitted = defineCommerceCommand("emitSelected", "write", ctx => ctx.captureLocalEvent(message).pipe(Effect.as(null)));
    const command = defineAtomicCommerceCommand("selectParticipantEvent", ctx => ctx.call(participant, emitted, null).pipe(
      Effect.catch(error => Effect.sync(() => { failures.push(error); return null; })),
    ));
    const base = { ...fixture.product.hostInput, commands: [command], events: { producerRevision: revision, contracts: [first, second, external], subscribers, validate: () => Effect.void } };
    const member = { participant, logicalStorage: fixture.product.hostInput.logicalStorage, commands: [emitted], validateLogicalCall: () => Effect.void };
    const make = (events?: ParticipantEventSelection) => makeAtomicCommerceHost({ ...base, participants: [{ ...member, ...(events === undefined ? {} : { events }) }] });
    for (const contracts of [[forged], [unlisted], [external], [first, first], Array.from({ length: 65 }, () => first)]) {
      expect(await runEffectFailure(make({ contracts, select: () => Effect.succeed(first) }))).toMatchObject({ reason: "invalidAuthority" });
    }
    const before = await inventory();
    for (const selected of [forged, second, external, unlisted]) {
      const host = await runEffect(make({ contracts: [first], select: () => Effect.succeed(selected) }));
      expect(await runEffectFailure(host.run(host.newRequestKey(), command, null))).toMatchObject({ reason: "rollbackOnly" });
      expect(failures.at(-1)).toMatchObject({ reason: "unadmittedEvent" });
      expect(await inventory()).toEqual(before);
    }
    for (const events of [undefined, { contracts: [], select: () => Effect.succeed(first) }]) {
      const host = await runEffect(make(events));
      expect(await runEffectFailure(host.run(host.newRequestKey(), command, null))).toMatchObject({ reason: "rollbackOnly" });
      expect(failures.at(-1)).toMatchObject({ reason: "unadmittedEvent" });
    }
    const failure = commerceError("receiptMismatch"), defect = new Error("selector defect");
    for (const scenario of [{ select: () => Effect.fail(failure), defect: false }, { select: () => Effect.die(defect), defect: true }]) {
      const host = await runEffect(make({ contracts: [first], select: scenario.select }));
      const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), command, null)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasDies(exit.cause)).toBe(scenario.defect);
      if (!scenario.defect) expect(failures.at(-1)).toBe(failure);
      expect(await inventory()).toEqual(before);
    }
    const getter = vi.fn(() => "unsafe"), select = vi.fn(() => Effect.succeed(first));
    message = Object.defineProperty({}, "payload", { get: getter, enumerable: true });
    const invalid = await runEffect(make({ contracts: [first], select }));
    expect(await runEffectFailure(invalid.run(invalid.newRequestKey(), command, null))).toMatchObject({ reason: "rollbackOnly" });
    expect(failures.at(-1)).toMatchObject({ reason: "invalidInput" });
    expect(getter).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled(); expect(await inventory()).toEqual(before);
    message = { payload: "owned" };
    const tokens = [first, second];
    const selection = { contracts: tokens, select: (message: Schema.Json) => Effect.sync(() => { expect(message).toEqual({ payload: "owned" }); expect(Object.isFrozen(message)).toBe(true); return first; }) };
    const host = await runEffect(make(selection)); tokens.length = 0; selection.select = () => Effect.succeed(second);
    const key = host.newRequestKey(); expect(await runEffect(host.run(key, command, null))).toBeNull();
    expect((await inventory()).events.at(-1)?.envelope).toMatchObject({ contract: "first.internal", internal: true, message: "first" });
    const changed = await runEffect(make({ contracts: [first], select: () => Effect.succeed(first) }));
    expect(await runEffectFailure(changed.run(key, command, null))).toMatchObject({ reason: "requestConflict" });
    const quiet = defineAtomicCommerceCommand("quietParticipant", () => Effect.succeed(null));
    for (const events of [undefined, { contracts: [], select: () => Effect.succeed(first) }]) {
      const host = await runEffect(makeAtomicCommerceHost({ ...base, commands: [quiet], participants: [{ ...member, ...(events === undefined ? {} : { events }) }] }));
      expect(await runEffect(host.run(host.newRequestKey(), quiet, null))).toBeNull();
    }
  }, 30_000);

  it("binds single and conjunctive logical validation modes into replay identity", async () => {
    const participant = defineAtomicCommerceParticipant("validationMode");
    const read = defineCommerceCommand("readValidationMode", "read", () => Effect.succeed(null));
    const command = defineAtomicCommerceCommand("validationMode", ctx => ctx.call(participant, read, null));
    const member = { participant, logicalStorage: fixture.product.hostInput.logicalStorage, commands: [read] };
    const input = { ...fixture.product.hostInput, commands: [command] };
    const aggregate = await runEffect(makeAtomicCommerceHost({ ...input,
      participants: [{ ...member, validateLogical: () => Effect.void }] }));
    const perCall = await runEffect(makeAtomicCommerceHost({ ...input,
      participants: [{ ...member, validateLogicalCall: () => Effect.void }] }));
    const validations: string[] = [];
    const dual = await runEffect(makeAtomicCommerceHost({ ...input, participants: [{ ...member,
      validateLogicalCall: () => Effect.sync(() => { validations.push("call"); }),
      validateLogical: () => Effect.sync(() => { validations.push("aggregate"); }) }] }));
    try {
      const key = aggregate.newRequestKey();
      expect(await runEffect(aggregate.run(key, command, null))).toBeNull();
      expect(await runEffectFailure(perCall.run(key, command, null))).toMatchObject({ reason: "requestConflict" });
      expect(await runEffectFailure(dual.run(key, command, null))).toMatchObject({ reason: "requestConflict" });
      const dualKey = dual.newRequestKey();
      expect(await runEffect(dual.run(dualKey, command, null))).toBeNull();
      expect(validations).toEqual(["call", "aggregate"]);
      for (const single of [aggregate, perCall])
        expect(await runEffectFailure(single.run(dualKey, command, null))).toMatchObject({ reason: "requestConflict" });
    } finally { await runEffect(dual.close); await runEffect(aggregate.close); await runEffect(perCall.close); }
  }, 30_000);
});
