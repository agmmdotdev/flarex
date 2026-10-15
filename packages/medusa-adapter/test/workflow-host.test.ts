import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { createHook, createStep, createWorkflow, isPreparedWorkflow, StepResponse, transform, when, WorkflowResponse } from "@medusajs/workflows-sdk";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import type { GraphModuleDefinition } from "../src/local-graph/model";
import { commerceDecoder } from "../src/value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, workflowModuleDefinition, workflowMethodDefinition } from "../src/workflow/module";
import { prepareWorkflowResources, workflowResourceSelections } from "../src/workflow/resources";
import { bindWorkflowResources } from "../src/workflow/binding";
import { checkedCommerceValue } from "../src/value/checked";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type InstalledWorkflowModule } from "../src/workflow/host";
import { runNativeMedusaWorkflow } from "../src/workflow/runtime";
import type { CommercePromiseOwner } from "../src/module/promise-owner";
import { captureWorkflowValue } from "../src/workflow/value";

const source = { name: "sample-module", profile: "sample", models: [], extensions: [], capabilities: [] };
const command = defineGraphReadCommand("sampleRead", () => Effect.succeed([[], 0]));
const graphDefinition = (): GraphModuleDefinition => ({ aliases: [{ name: "sample", model: "Sample" }], reads: [{
  command, model: "Sample", table: { name: "sample", columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
  paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: commerceDecoder(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]), "storedCorruption"),
}] });
const methodInput = { command, arguments: commerceDecoder(Schema.Tuple([Schema.String]), "invalidInput"),
  encode: ([value]: readonly [string]) => value, output: commerceDecoder(Schema.String, "storedCorruption") };
const method = Result.getOrThrow(defineWorkflowMethod(methodInput));
const module = Result.getOrThrow(defineWorkflowModule({ name: "sample", source, methods: { echo: method }, graph: graphDefinition() }));
const resources = Result.getOrThrow(prepareWorkflowResources({ sample: { module, methods: ["echo"], graph: false } }, false));
const members = workflowResourceSelections(resources);
if (members === undefined) throw new Error("Missing unit resource selection");
const decodeJson = commerceDecoder(Schema.Json, "invalidInput");
// A resource-dispatch unit port, not a persistence or transaction simulation.
const context = (): AtomicCommerceContext => ({ eventGroupId: "unit", checkpoint: Effect.void,
  capture: (input, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decodeJson)(input))),
  call: (_participant, _command, args) => Effect.succeed(args),
  emit: () => Effect.fail(commerceError("unadmittedEvent")), refuse: error => Effect.fail(error),
});

describe("workflow registration and scoped resource composition", () => {
  it("snapshots an explicit logical publication profile and omits an undefined selection", () => {
    const selected = { module, logicalPublication: "mixed" };
    const registrations: Record<string, InstalledWorkflowModule> = {};
    Object.defineProperty(registrations, "sample", { value: selected, enumerable: true });
    const captured = Result.getOrThrow(captureInstalledWorkflowModules(registrations, ["sample"]));
    expect(captured.sample?.logicalPublication).toBe("mixed");
    expect(captured.sample?.module).toBe(module);
    expect(Object.isFrozen(captured.sample)).toBe(true);
    expect(Reflect.set(selected, "logicalPublication", "invalid")).toBe(true);
    expect(captured.sample?.logicalPublication).toBe("mixed");
    const omitted: Record<string, InstalledWorkflowModule> = {};
    Object.defineProperty(omitted, "sample", { enumerable: true, value: Object.defineProperty({ module },
      "logicalPublication", { value: undefined, enumerable: true }) });
    const absent = Result.getOrThrow(captureInstalledWorkflowModules(omitted, ["sample"]));
    expect(absent.sample).not.toHaveProperty("logicalPublication");
  });

  it("refuses logical publication accessors and unknown profiles before dispatch", () => {
    const getter = vi.fn(() => "mixed");
    const registrations: Record<string, InstalledWorkflowModule> = {};
    Object.defineProperty(registrations, "accessor", { enumerable: true,
      value: Object.defineProperty({ module }, "logicalPublication", { get: getter, enumerable: true }) });
    Object.defineProperty(registrations, "invalid", { enumerable: true,
      value: Object.defineProperty({ module }, "logicalPublication", { value: "parallel", enumerable: true }) });
    expect(captureInstalledWorkflowModules(registrations, ["accessor"]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(captureInstalledWorkflowModules(registrations, ["invalid"]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(getter).not.toHaveBeenCalled();
  });

  it("snapshots an explicit logical resource selection without cloning capabilities", () => {
    const selected = { ...defaultCommerceResources };
    const registrations: Record<string, InstalledWorkflowModule> = {};
    // This exercises registration capture only; core separately authenticates
    // storage admission when a real host is prepared.
    Object.defineProperty(registrations, "sample", { value: { module, logicalResources: selected }, enumerable: true });
    const captured = Result.getOrThrow(captureInstalledWorkflowModules(registrations, ["sample"]));
    selected.catalogRows = 4096;
    expect(captured.sample?.module).toBe(module);
    expect(captured.sample?.logicalResources?.catalogRows).toBe(defaultCommerceResources.catalogRows);
    expect(captured.sample?.logicalResources).not.toBe(selected);
    expect(Object.isFrozen(captured.sample?.logicalResources)).toBe(true);
    expect(captureInstalledWorkflowModules(registrations, ["sample"]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("refuses resource getters and unsupported resource values before dispatch", () => {
    const getter = vi.fn(() => 256);
    const registrations: Record<string, InstalledWorkflowModule> = {};
    Object.defineProperty(registrations, "accessor", { enumerable: true, value: { module,
      logicalResources: Object.defineProperty({ ...defaultCommerceResources }, "catalogRows", { get: getter, enumerable: true }) } });
    Object.defineProperty(registrations, "oversized", { enumerable: true, value: { module,
      logicalResources: { ...defaultCommerceResources, calls: 4097 } } });
    expect(captureInstalledWorkflowModules(registrations, ["accessor"]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(captureInstalledWorkflowModules(registrations, ["oversized"]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(getter).not.toHaveBeenCalled();
  });

  it("captures selected installed bindings without invoking registration or nested getters", () => {
    const getter = vi.fn(() => module);
    const registrations: Record<string, InstalledWorkflowModule> = {};
    Object.defineProperty(registrations, "sample", { get: getter, enumerable: true });
    expect(captureInstalledWorkflowModules(registrations, ["sample"]).pipe(Result.match({
      onFailure: error => error.reason, onSuccess: () => "accepted",
    }))).toBe("unsupportedProfile");
    Object.defineProperty(registrations, "nested", { value: Object.defineProperty({}, "module", { get: getter, enumerable: true }), enumerable: true });
    expect(captureInstalledWorkflowModules(registrations, ["nested"]).pipe(Result.match({
      onFailure: error => error.reason, onSuccess: () => "accepted",
    }))).toBe("unsupportedProfile");
    expect(getter).not.toHaveBeenCalled();
  });

  it("preserves selected-binding first-failure order before later registrations", () => {
    const inspected: string[] = [];
    const registrations: Record<string, InstalledWorkflowModule> = {};
    const oversized = Object.fromEntries(Array.from({ length: 4097 }, (_, index) => ["field" + index, index]));
    Object.defineProperty(registrations, "first", { value: oversized, enumerable: true });
    const proxy = new Proxy(registrations, { getOwnPropertyDescriptor: (target, name) => {
      inspected.push(String(name)); return Object.getOwnPropertyDescriptor(target, name);
    } });
    expect(captureInstalledWorkflowModules(proxy, ["first", "missing"]).pipe(Result.match({
      onFailure: error => error.reason, onSuccess: () => "accepted",
    }))).toBe("limitExceeded");
    expect(inspected).toEqual(["first"]);
  });

  it("enters the existing capture operation before inspecting foreign workflow proxies or accessors", async () => {
    const ctx = context();
    const inspect = vi.fn();
    const foreign = new Proxy({}, {
      getPrototypeOf: () => { inspect(); return Object.prototype; },
      ownKeys: () => { inspect(); return []; },
      getOwnPropertyDescriptor: () => { inspect(); return undefined; },
    });
    const refusal = commerceError("limitExceeded");
    const capture = vi.fn<AtomicCommerceContext["capture"]>(() => Effect.fail(refusal));
    await expect(Effect.runPromise(captureWorkflowValue({ ...ctx, capture }, foreign))).rejects.toBe(refusal);
    expect(inspect).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
    const getter = vi.fn(() => "unsafe");
    await expect(Effect.runPromise(captureWorkflowValue(ctx,
      Object.defineProperty({}, "value", { get: getter, enumerable: true })))).rejects.toMatchObject({ reason: "invalidInput" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("restores own undefined fields in mutable detached workflow inputs", async () => {
    const foreign = { missing: undefined, nested: { missing: undefined, count: 1 } };
    const owned = await Effect.runPromise(captureWorkflowValue(context(), foreign));
    expect(owned).toEqual(foreign);
    expect(owned).not.toBe(foreign);
    expect(Object.getOwnPropertyDescriptor(owned, "missing"))
      .toMatchObject({ value: undefined, enumerable: true, writable: true, configurable: true });
    expect(Object.isFrozen(owned)).toBe(false);
    if (typeof owned !== "object" || owned === null) throw new Error("Expected captured workflow object");
    expect(Reflect.set(owned, "missing", "changed")).toBe(true);
    expect(foreign.missing).toBeUndefined();
  });
  it("detaches each reached native callback without mutating retained outputs or omission fields", async () => {
    const reached: object[] = [];
    const mutate = (value: { nested: { count: number }; missing: undefined }, count: number) => {
      expect(value.nested.count).toBe(1);
      expect(Object.hasOwn(value, "missing")).toBe(true);
      expect(Object.isFrozen(value)).toBe(false);
      expect(Object.isFrozen(value.nested)).toBe(false);
      reached.push(value);
      value.nested.count = count;
      return count;
    };
    const foreign = { nested: { count: 1 }, missing: undefined };
    const produce = createStep("owned-output", () => new StepResponse(foreign));
    const consume = createStep({ name: "mutating-step", compensation: "transactionCovered" },
      (value: typeof foreign) => new StepResponse(mutate(value, 3), { missing: undefined, ids: ["compensation"] }),
      vi.fn());
    const skipped = vi.fn((_value: typeof foreign) => undefined);
    const never = createStep("skipped-callback", skipped);
    const flow = createWorkflow("owned-native-callbacks", () => {
      const source = produce(undefined);
      const transformed = transform(source, value => mutate(value, 2));
      const consumed = consume(source);
      const hook = createHook<"mutate", typeof foreign, number>("mutate", source);
      const guarded = when("mutating-predicate", source, value => { mutate(value, 5); return true; })
        .then(() => source.nested.count);
      when("skip", source, () => false).then(() => never(source));
      return new WorkflowResponse({ original: source.nested.count, transformed, consumed,
        hooked: hook.getResult(), guarded }, { hooks: [hook] });
    });
    const ctx = context();
    const prepared = Result.getOrThrow(flow.prepare({ mutate: value => mutate(value, 4) }));
    expect(await Effect.runPromise(runNativeMedusaWorkflow(prepared, ctx, null,
      owner => bindWorkflowResources(resources, members, undefined, [], ctx, owner)))).toEqual({
      original: 1, transformed: 2, consumed: 3, hooked: 4, guarded: 1,
    });
    expect(reached).toHaveLength(4);
    expect(new Set(reached).size).toBe(4);
    expect(reached.every(value => value !== foreign)).toBe(true);
    expect(foreign.nested.count).toBe(1);
    expect(skipped).not.toHaveBeenCalled();
  });

  it("captures distinct compensation before later work even when the step output is valid", async () => {
    const getter = vi.fn(() => "invalid compensation");
    const later = vi.fn(() => "must not run");
    const inverse = vi.fn();
    const step = createStep({ name: "invalid-compensation", compensation: "transactionCovered" },
      () => new StepResponse(1, Object.defineProperty({}, "private", { get: getter, enumerable: true })), inverse);
    const after = createStep("after-compensation", later);
    const flow = createWorkflow("check-full-step-response", () => {
      const output = step(undefined);
      return new WorkflowResponse(after(output));
    });
    const ctx = context();
    await expect(Effect.runPromise(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), ctx, null,
      owner => bindWorkflowResources(resources, members, undefined, [], ctx, owner)))).rejects.toMatchObject({ reason: "invalidInput" });
    expect(getter).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
    expect(inverse).not.toHaveBeenCalled();
  });

  it("keeps unknown and unselected method refusals sticky after native callbacks catch them", async () => {
    const registered = Result.getOrThrow(defineWorkflowModule({ name: "sample", source,
      methods: { echo: method, unselected: method }, graph: graphDefinition() }));
    const selection = Result.getOrThrow(prepareWorkflowResources({
      sample: { module: registered, methods: ["echo"], graph: false },
    }, false));
    const selected = workflowResourceSelections(selection);
    if (selected === undefined) throw new Error("Missing selection");
    for (const name of ["unselected", "omittedUnsupported"]) {
      const step = createStep("caught-method", (_input: unknown, { container }) => {
        const service = container.resolve<Record<string, () => unknown>>("sample");
        try { service[name]!(); } catch { /* The root still owns refusal. */ }
        return "continued";
      });
      const flow = createWorkflow("caught-method", () => new WorkflowResponse(step(null)));
      const ctx = context();
      const result = await Effect.runPromise(Effect.result(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), ctx, null,
        owner => bindWorkflowResources(selection, selected, undefined, [], ctx, owner))));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
  });

  it("keeps resource inspection inert and exposes only selected own methods", async () => {
    const step = createStep("inspect-resource", async (_input: unknown, { container }) => {
      const service = container.resolve<{ echo(value: string): Promise<string> }>("sample");
      expect(await Promise.resolve(service)).toBe(service);
      expect(JSON.stringify(service)).toBe("{}");
      expect(Object.keys(service)).toEqual(["echo"]);
      expect("omittedUnsupported" in service).toBe(false);
      expect(Object.getOwnPropertyDescriptor(service, "omittedUnsupported")).toBeUndefined();
      expect(Reflect.get(service, Symbol.iterator)).toBeUndefined();
      expect(service.toString()).toBe("[object Object]");
      expect(Object.isFrozen(service)).toBe(true);
      return service.echo("inspected");
    });
    const flow = createWorkflow("inspect-resource", () => new WorkflowResponse(step(null)));
    const ctx = context();
    expect(await Effect.runPromise(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), ctx, null,
      owner => bindWorkflowResources(resources, members, undefined, [], ctx, owner)))).toBe("inspected");
    expect(Result.isFailure(defineWorkflowModule({ name: "sample", source,
      methods: { toJSON: method }, graph: graphDefinition() }))).toBe(true);
  });

  it("captures finite method event sets and rejects malformed or ambiguous declarations", () => {
    const names = ["product.updated", "collection.updated"];
    const registered = Result.getOrThrow(defineWorkflowMethod({ ...methodInput, moduleEvents: names }));
    names[0] = "mutated";
    expect(workflowMethodDefinition(registered)?.moduleEvents).toEqual(["collection.updated", "product.updated"]);
    expect(Object.isFrozen(workflowMethodDefinition(registered)?.moduleEvents)).toBe(true);
    expect(Object.isFrozen(names)).toBe(false);
    for (const moduleEvents of [["duplicate", "duplicate"], [" "], Array.from({ length: 65 }, (_, i) => `event-${i}`)]) {
      expect(Result.isFailure(defineWorkflowMethod({ ...methodInput, moduleEvents }))).toBe(true);
    }
    for (const value of [null, "single", [12], undefined]) {
      const input = Object.defineProperty({ ...methodInput, moduleEvents: [] }, "moduleEvents", { value });
      expect(Result.isSuccess(defineWorkflowMethod(input))).toBe(value === undefined);
    }
    const getter = vi.fn(() => "event");
    const moduleEvents = Object.defineProperty(["event"], "0", { get: getter, enumerable: true });
    expect(Result.isFailure(defineWorkflowMethod({ ...methodInput, moduleEvents }))).toBe(true);
    expect(getter).not.toHaveBeenCalled();
  });

  it("infers the selected methods and does not promise widened dynamic selections", () => {
    const callback = resources.callback(async (_input: undefined, { resources }) => {
      expectTypeOf(resources.sample.echo("typed")).toEqualTypeOf<Promise<string>>();
      // @ts-expect-error checked tuple takes text
      resources.sample.echo(42);
      // @ts-expect-error no graph selected
      resources.query.graph({});
      // @ts-expect-error no event resource selected
      resources.event_bus.emit([]);
      // @ts-expect-error no undeclared method
      resources.sample.write("value");
      return "typed";
    });
    expect(callback).toBeTypeOf("function");
    const dynamic: readonly "echo"[] = ["echo"];
    const invalid = () => {
      // @ts-expect-error a dynamic array cannot promise every possible member exists
      prepareWorkflowResources({ sample: { module, methods: dynamic, graph: false } }, false);
      // @ts-expect-error method does not belong to this registration
      prepareWorkflowResources({ sample: { module, methods: ["write"], graph: false } }, false);
    };
    expect(invalid).toBeTypeOf("function");
    const multiple = Result.getOrThrow(defineWorkflowModule({ name: "sample", source, methods: { echo: method, other: method }, graph: graphDefinition() }));
    const unionSelection = (selected: "echo" | "other", tuple: readonly ["echo"] | readonly ["other"]) => {
      // @ts-expect-error a union-valued member cannot promise both methods
      prepareWorkflowResources({ sample: { module: multiple, methods: [selected], graph: false } }, false);
      // @ts-expect-error a union of tuples cannot promise both methods
      prepareWorkflowResources({ sample: { module: multiple, methods: tuple, graph: false } }, false);
    };
    expect(unionSelection).toBeTypeOf("function");
  });

  it("rejects accessor, forged and ambiguous registrations without invoking accessors", () => {
    const getter = vi.fn(() => method);
    const methods = Object.defineProperty({ echo: method }, "echo", { get: getter, enumerable: true });
    expect(Result.isFailure(defineWorkflowModule({ name: "sample", source, methods, graph: graphDefinition() }))).toBe(true);
    expect(getter).not.toHaveBeenCalled();
    for (const name of [undefined, null, 123]) {
      const malformed = Object.defineProperty({ name: "sample", source, methods: { echo: method }, graph: graphDefinition() }, "name", { value: name });
      expect(Result.isFailure(defineWorkflowModule(malformed))).toBe(true);
    }
    expect(Result.isFailure(defineWorkflowModule({ name: "sample", source, methods: { echo: { ...method } }, graph: graphDefinition() }))).toBe(true);
    expect(Result.isFailure(prepareWorkflowResources({ sample: { module, methods: ["echo", "echo"], graph: false } }, false))).toBe(true);
    expect(Result.isFailure(prepareWorkflowResources({ sample: { module, methods: ["echo"], graph: false }, other: { module, methods: [], graph: true } }, false))).toBe(true);
    const graph = graphDefinition();
    expect(Result.isFailure(defineWorkflowModule({ name: "sample", source, methods: { echo: method }, graph: { ...graph, aliases: [...graph.aliases, ...graph.aliases] } }))).toBe(true);
    const reads = Object.defineProperty([...graph.reads], "0", { get: getter, enumerable: true });
    expect(Result.isFailure(defineWorkflowModule({ name: "sample", source, methods: { echo: method }, graph: { ...graph, reads } }))).toBe(true);
    expect(getter).not.toHaveBeenCalled();
  });

  it("owns method, source and graph snapshots across later source mutation", () => {
    const originalSource = { ...source };
    const originalMethods = { echo: method };
    const table = { name: "sample", columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} };
    const graph = graphDefinition();
    const definition = Result.getOrThrow(defineWorkflowModule({ name: "sample", source: originalSource, methods: originalMethods,
      graph: { ...graph, reads: graph.reads.map(read => ({ ...read, table })) } }));
    originalMethods.echo = { ...method }; originalSource.profile = "changed"; table.columns.push("changed");
    const captured = workflowModuleDefinition(definition);
    expect(definition.methods.echo).toBe(method);
    expect(captured?.source.profile).toBe("sample");
    expect(captured?.graph.reads[0]?.table.columns).toEqual(["id"]);
    expect(Object.isFrozen(originalSource)).toBe(false);
    expect(Object.isFrozen(originalMethods)).toBe(false);
  });

  it("shares one native/compatibility resource and rejects methods after closure", async () => {
    let escaped: ((input: string) => Promise<string>) | undefined;
    const step = createStep("use-resource", resources.callback(async (_input: undefined, { resources, container }) => {
      const compatibility = container.resolve<{ echo: (value: string) => Promise<string> }>("sample");
      expect(compatibility.echo).toBe(resources.sample.echo);
      escaped = resources.sample.echo;
      return await resources.sample.echo("owned");
    }));
    const flow = createWorkflow("resource-unit", () => new WorkflowResponse(step(undefined)));
    const ctx = context();
    expect(await Effect.runPromise(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), ctx, null,
      owner => bindWorkflowResources(resources, members, undefined, [], ctx, owner)))).toBe("owned");
    await expect(escaped?.("late")).rejects.toMatchObject({ reason: "closed" });
  });

  it("closes the owner when resource construction itself fails", async () => {
    let escaped: CommercePromiseOwner | undefined;
    const flow = createWorkflow("construction-failure", () => new WorkflowResponse("unused"));
    const exit = await Effect.runPromise(Effect.exit(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), context(), null, owner => {
      escaped = owner;
      return owner.reject(commerceError("unsupportedProfile"));
    })));
    expect(Exit.isFailure(exit)).toBe(true);
    await expect(escaped?.run(Effect.succeed("late"))).rejects.toMatchObject({ reason: "closed" });
  });

  it("normalizes a completed top-level void result to native null", async () => {
    for (const value of [undefined, null, false, 0, "", [], {}]) {
      const flow = createWorkflow("completion-value", () => new WorkflowResponse(value));
      expect(await Effect.runPromise(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), context(), null,
        owner => bindWorkflowResources(resources, members, undefined, [], context(), owner))))
        .toEqual(value === undefined ? null : value);
    }
  });

  it("omits native optional object members while rejecting undefined array entries", async () => {
    const value = { missing: undefined, kept: 0, nested: { omitted: undefined, kept: false } };
    const flow = createWorkflow("optional-completion-value", () => new WorkflowResponse(value));
    expect(await Effect.runPromise(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), context(), null,
      owner => bindWorkflowResources(resources, members, undefined, [], context(), owner))))
      .toEqual({ kept: 0, nested: { kept: false } });
    for (const value of [[undefined], { nested: [undefined] }]) {
      const flow = createWorkflow("invalid-completion-value", () => new WorkflowResponse(value));
      const exit = await Effect.runPromise(Effect.exit(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), context(), null,
        owner => bindWorkflowResources(resources, members, undefined, [], context(), owner))));
      expect(Exit.isFailure(exit)).toBe(true);
    }
    expect(() => createWorkflow("invalid-symbol-result", () => new WorkflowResponse(Symbol("invalid-result"))))
      .toThrow("Unsupported or cyclic definition literal");
  });

  it("refuses the root on a decoder defect while preserving the defect channel", async () => {
    const ctx = context();
    const refuse = vi.fn(ctx.refuse);
    const defect = new Error("trusted decoder defect");
    const exit = await Effect.runPromise(Effect.exit(checkedCommerceValue({ ...ctx, refuse }, () => { throw defect; })));
    if (Exit.isSuccess(exit)) throw new Error("Expected decoder failure");
    expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(defect);
    expect(refuse).toHaveBeenCalledWith(expect.objectContaining({ reason: "adapterFailure", cause: defect }));
  });

  it("refuses a callback bound to another selection before invoking its body", async () => {
    const other = Result.getOrThrow(prepareWorkflowResources({ sample: { module, methods: ["echo"], graph: false } }, false));
    const invoked = vi.fn(() => "not admitted");
    const step = createStep("wrong-selection", other.callback(invoked));
    const flow = createWorkflow("foreign-resource-view", () => new WorkflowResponse(step(undefined)));
    const ctx = context();
    const exit = await Effect.runPromise(Effect.exit(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), ctx, null,
      owner => bindWorkflowResources(resources, members, undefined, [], ctx, owner))));
    expect(Exit.isFailure(exit)).toBe(true); expect(invoked).not.toHaveBeenCalled();
  });

  it("refuses an incomplete host before reaching the trusted execution factory", async () => {
    const prepare = vi.fn(() => Effect.fail(commerceError("invalidAuthority")));
    const flow = createWorkflow("incomplete-host", () => new WorkflowResponse(null));
    const exit = await Effect.runPromise(Effect.exit(prepareAtomicWorkflowHost({ execution: { identityAndAccessPolicy: {}, prepare }, modules: {},
      revision: "a".repeat(64), workflow: { name: "incomplete", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json },
    })));
    expect(Exit.isFailure(exit)).toBe(true); expect(prepare).not.toHaveBeenCalled();
  });

  it("refuses top-level host accessors before invoking them or the execution factory", async () => {
    const prepare = vi.fn(() => Effect.fail(commerceError("invalidAuthority")));
    const flow = createWorkflow("accessor-host", () => new WorkflowResponse(null));
    const plain = { execution: { identityAndAccessPolicy: {}, prepare }, modules: {},
      revision: "a".repeat(64), workflow: { name: "accessor", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json } };
    for (const key of ["execution", "modules"] as const) {
      const getter = vi.fn(() => plain[key]);
      const input = Object.defineProperty({ ...plain }, key, { get: getter, enumerable: true });
      const exit = await Effect.runPromise(Effect.exit(prepareAtomicWorkflowHost(input)));
      if (Exit.isSuccess(exit)) throw new Error("Expected host accessor refusal");
      expect(Result.getOrThrow(Cause.findError(exit.cause)))
        .toMatchObject({ reason: "unsupportedProfile" });
      expect(getter).not.toHaveBeenCalled();
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects copied prepared graphs before retaining callbacks or calling the execution factory", async () => {
    const prepare = vi.fn(() => Effect.fail(commerceError("invalidAuthority")));
    const flow = createWorkflow("authentic-definition", () => new WorkflowResponse(null));
    const original = Result.getOrThrow(flow.prepare());
    expect(isPreparedWorkflow(original)).toBe(true);
    const copied = { ...original, nodes: [...original.nodes] };
    expect(isPreparedWorkflow(copied)).toBe(false);
    const exit = await Effect.runPromise(Effect.exit(prepareAtomicWorkflowHost({ execution: { identityAndAccessPolicy: {}, prepare }, modules: {},
      revision: "a".repeat(64), workflow: { name: "copied", resources, prepared: copied, input: Schema.Json, output: Schema.Json },
    })));
    if (Exit.isSuccess(exit)) throw new Error("Expected definition refusal");
    expect(Result.getOrThrow(Cause.findError(exit.cause))).toMatchObject({ reason: "invalidAuthority" });
    expect(prepare).not.toHaveBeenCalled();
  });
});
