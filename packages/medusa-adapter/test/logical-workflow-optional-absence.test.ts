import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { createStep, createWorkflow, parallelize, StepResponse, WorkflowResponse, type WorkflowContainer } from "@medusajs/workflows-sdk";
import { useCache } from "@medusajs/utils/caching/index";
import { currencyWorkflowModule, currencyAnnouncementWrite, currencyCommands } from "../src/modules/currency/service";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { defineWorkflowMethod, defineWorkflowModule, workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";
import { commerceDecoder } from "../src/value/decoder";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
type Mode = "success" | "required-declared" | "optional-undeclared" | "optional-existing-profile";
const module = Result.getOrThrow(currencyWorkflowModule);
const Input = Schema.Struct({ first: Schema.String, second: Schema.String });
type Input = typeof Input.Type;
const StageCurrencyArguments = Schema.Tuple([Schema.Struct({ code: Schema.String, name: Schema.String,
  symbol: Schema.String, symbol_native: Schema.String })]);
function expectCaughtResourceRefusal(cause: Cause.Cause<CommerceTransactionError>, caught: unknown) {
  // The queued capture and final seal retain their rollback markers around
  // the originating refusal. No extra failure, defect or interruption fits.
  expect(cause.reasons.map(reason => Cause.isFailReason(reason) ? [reason._tag, reason.error.reason] : [reason._tag]))
    .toEqual([["Fail", "rollbackOnly"], ["Fail", "unsupportedProfile"], ["Fail", "rollbackOnly"]]);
  const refusal = cause.reasons[1];
  if (refusal === undefined || !Cause.isFailReason(refusal)) throw new Error("Missing originating resource refusal");
  expect(refusal.error).toBe(caught);
}
const snapshot = async () => ({
  rows: await fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
  revisions: await fixture.persistence.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
  commits: await fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq),
  outcomes: await fixture.persistence.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey),
  events: await fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
});

async function open(mode: Mode) {
  const resources = Result.getOrThrow(prepareWorkflowResources({ currency: { module, methods: ["retrieveCurrency"], graph: false } },
    false, undefined, mode === "optional-existing-profile" ? undefined : { absent: ["caching"] }));
  const containers: WorkflowContainer[] = [], callbacks: string[] = [], reads: string[] = [], caught: unknown[] = [];
  let returnedAfterCatch = 0;
  const step = createStep("optional-absence-currency-" + mode, resources.callback(async (code: string, context) => {
    containers.push(context.container);
    const selected = context.container.resolve<typeof context.resources.currency>("currency");
    expect(context.container.resolve<typeof context.resources.currency>("currency", { allowUnregistered: true })).toBe(selected);
    expect(selected).toBe(context.resources.currency);
    const read = async () => {
      expect(context.container.resolve("caching", { allowUnregistered: true })).toBeUndefined();
      callbacks.push(code);
      const result = await selected.retrieveCurrency(code);
      reads.push(result.code);
      return result;
    };
    // The real native helper resolves optional caching before calling read.
    // Existing profiles remain strict, so that case first performs its real
    // Currency read directly and then catches the refused native cache lookup.
    const result = mode === "optional-existing-profile" ? await selected.retrieveCurrency(code)
      : await useCache(read, { container: context.container, key: "optional-absence/" + code });
    if (mode === "optional-existing-profile") reads.push(result.code);
    if (mode !== "success") {
      try {
        if (mode === "required-declared") context.container.resolve("caching");
        else if (mode === "optional-undeclared") context.container.resolve("logger", { allowUnregistered: true });
        else await useCache(read, { container: context.container, key: "strict-native/" + code });
      } catch (cause) { caught.push(cause); }
      returnedAfterCatch++;
    }
    return new StepResponse(result);
  }));
  const flow = mode === "success"
    ? createWorkflow("logical-optional-absence-" + mode, (input: Input) =>
      new WorkflowResponse(parallelize(step(input.first), step(input.second).config({ name: "optional-absence-currency-success-second" }))))
    : createWorkflow("logical-optional-absence-" + mode, (input: Input) => new WorkflowResponse(step(input.first)));
  const host = await Effect.runPromise(prepareAtomicWorkflowHost({
    execution: { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) },
    modules: { currency: { module, logicalStorage: fixture.hostInput.logicalStorage } },
    operationScheduling: "queued", borrowedOperationScheduling: "queued", revision: "a".repeat(64),
    workflow: { name: "logical-optional-absence-" + mode, resources, prepared: Result.getOrThrow(flow.prepare()), input: Input, output: Schema.Json },
  }));
  return { host, containers, callbacks, reads, caught, returnedAfterCatch: () => returnedAfterCatch };
}

describe("declared optional absence with native caching and installed Currency", { concurrent: false }, () => {
  beforeAll(async () => { fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Optional-absence Currency cleanup failed");
  }, 120_000);

  it("runs concurrent native uncached Currency reads through the queued atomic owner and replays one outcome", async () => {
    const tested = await open("success");
    try {
      const expected = [await fixture.service.retrieveCurrency("usd"), await fixture.service.retrieveCurrency("eur")];
      const before = await snapshot(), key = tested.host.newRequestKey(), input = { first: "usd", second: "eur" };
      const result = await Effect.runPromise(tested.host.run(key, input));
      expect(result).toEqual(expected);
      expect(tested.callbacks.toSorted()).toEqual(["eur", "usd"]); expect(tested.reads.toSorted()).toEqual(["eur", "usd"]);
      expect(tested.caught).toEqual([]);
      const after = await snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(await Effect.runPromise(tested.host.run(key, input))).toEqual(result);
      expect(tested.callbacks).toHaveLength(2); expect(tested.reads).toHaveLength(2); expect(await snapshot()).toEqual(after);
    } finally { await Effect.runPromise(tested.host.close); }
  });

  it.each(["required-declared", "optional-undeclared", "optional-existing-profile"] as const)(
    "keeps caught %s refusal sticky and publishes no outcome", async mode => {
      const tested = await open(mode);
      try {
        const before = await snapshot();
        const result = await Effect.runPromiseExit(tested.host.run(tested.host.newRequestKey(), { first: "usd", second: "eur" }));
        if (Exit.isSuccess(result)) throw new Error("Caught unsupported resource resolution committed");
        expectCaughtResourceRefusal(result.cause, tested.caught[0]);
        expect(tested.caught).toHaveLength(1); expect(tested.caught[0]).toMatchObject({ reason: "unsupportedProfile" });
        expect(tested.reads).toEqual(["usd"]); expect(tested.returnedAfterCatch()).toBe(1);
        expect(tested.callbacks).toEqual(mode === "optional-existing-profile" ? [] : ["usd"]);
        expect(await snapshot()).toEqual(before);
      } finally { await Effect.runPromise(tested.host.close); }
    });

  it("rolls back an actual pending Currency update after a caught required-resource refusal", async () => {
    const definition = workflowModuleDefinition(module), retrieve = workflowMethodDefinition(module.methods.retrieveCurrency);
    if (definition === undefined || retrieve === undefined) throw new Error("Missing native Currency workflow definition");
    const original = await fixture.service.retrieveCurrency("usd"), pendingName = "Pending optional-resource refusal";
    let writeReceipts = 0, pendingRead = false, caught: unknown;
    const stageCurrency = Result.getOrThrow(defineWorkflowMethod<typeof StageCurrencyArguments.Type, unknown>({ command: currencyAnnouncementWrite,
      arguments: commerceDecoder(StageCurrencyArguments, "invalidInput"),
      encode: ([value]) => value, output: retrieve.output,
    }));
    // Test-only registration of the existing private upsert command. Production
    // Currency workflow resources remain read-only; no storage owner is copied.
    const pendingModule = Result.getOrThrow(defineWorkflowModule({ name: module.name, source: definition.source, graph: definition.graph,
      methods: { ...module.methods, stageCurrency }, logical: {
        commands: [currencyCommands.retrieve, currencyAnnouncementWrite], capture: () => Effect.fail(commerceError("unadmittedEvent")),
        validateLogicalCall: (_call, activity, command) => Effect.sync(() => {
          expect(activity.lifecycle).toEqual([]); expect(_call.events).toEqual([]);
          if (command === currencyAnnouncementWrite) {
            writeReceipts++; expect(activity.mutations).toHaveLength(1);
            expect(activity.mutations[0]?.before).toMatchObject({ code: "usd", name: original.name });
            expect(activity.mutations[0]?.after).toMatchObject({ code: "usd", name: pendingName });
          } else expect(activity.mutations).toEqual([]);
        }),
      } }));
    const resources = Result.getOrThrow(prepareWorkflowResources({ currency: { module: pendingModule,
      methods: ["retrieveCurrency", "stageCurrency"], graph: false } }, false, undefined, { absent: ["caching"] }));
    const step = createStep("pending-currency-optional-refusal", resources.callback(async (_input: null, context) => {
      const before = await context.resources.currency.retrieveCurrency("usd");
      if (typeof before.symbol !== "string" || typeof before.symbol_native !== "string") throw new Error("Missing native Currency symbols");
      expect(await context.resources.currency.stageCurrency({ code: before.code, name: pendingName,
        symbol: before.symbol, symbol_native: before.symbol_native })).toMatchObject({ code: "usd", name: pendingName });
      const pending = await useCache(() => context.resources.currency.retrieveCurrency("usd"),
        { container: context.container, key: "pending-currency-read" });
      expect(pending.name).toBe(pendingName); pendingRead = true;
      try { context.container.resolve("caching"); } catch (cause) { caught = cause; }
      return new StepResponse(pending);
    }));
    const flow = createWorkflow("logical-pending-currency-optional-refusal", () => new WorkflowResponse(step(null)));
    const tested = await Effect.runPromise(prepareAtomicWorkflowHost({
      execution: { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) },
      modules: { currency: { module: pendingModule, logicalStorage: fixture.hostInput.logicalStorage } },
      operationScheduling: "queued", borrowedOperationScheduling: "queued", revision: "a".repeat(64),
      workflow: { name: "logical-pending-currency-optional-refusal", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Json },
    }));
    try {
      const before = await snapshot(), result = await Effect.runPromiseExit(tested.run(tested.newRequestKey(), null));
      if (Exit.isSuccess(result)) throw new Error("Caught resource refusal published pending Currency update");
      expectCaughtResourceRefusal(result.cause, caught);
      expect(caught).toMatchObject({ reason: "unsupportedProfile" }); expect(writeReceipts).toBe(1); expect(pendingRead).toBe(true);
      expect(await fixture.service.retrieveCurrency("usd")).toEqual(original); expect(await snapshot()).toEqual(before);
    } finally { await Effect.runPromise(tested.close); }
  });

  it("fences escaped required and native optional resolution after the actual workflow owner closes", async () => {
    const tested = await open("success");
    try {
      await Effect.runPromise(tested.host.run(tested.host.newRequestKey(), { first: "usd", second: "eur" }));
      const container = tested.containers[0]; if (container === undefined) throw new Error("Missing actual native step container");
      const before = await snapshot(); let callbackEntered = false;
      expect(() => container.resolve("currency")).toThrow(expect.objectContaining({ reason: "closed" }));
      expect(() => container.resolve("caching", { allowUnregistered: true })).toThrow(expect.objectContaining({ reason: "closed" }));
      await expect(useCache(async () => { callbackEntered = true; return "late"; }, { container, key: "late-native-cache" }))
        .rejects.toMatchObject({ reason: "closed" });
      expect(callbackEntered).toBe(false); expect(await snapshot()).toEqual(before);
    } finally { await Effect.runPromise(tested.host.close); }
  });
});
