import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { createStep, createWorkflow, isPreparedWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import type { GraphModuleDefinition } from "../src/local-graph/model";
import { commerceDecoder } from "../src/commerce-decoder";
import { defineWorkflowMethod, defineWorkflowModule, workflowModuleDefinition } from "../src/workflow/module";
import { prepareWorkflowResources, workflowResourceSelections } from "../src/workflow/resources";
import { bindWorkflowResources } from "../src/workflow/binding";
import { checkedCommerceValue } from "../src/commerce-checked-value";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { runNativeMedusaWorkflow } from "../src/workflow-runtime";
import type { CommercePromiseOwner } from "../src/commerce-promise-owner";

const source = { name: "sample-module", profile: "sample", models: [], extensions: [], capabilities: [] };
const command = defineGraphReadCommand("sampleRead", () => Effect.succeed([[], 0]));
const graphDefinition = (): GraphModuleDefinition => ({ aliases: [{ name: "sample", model: "Sample", methodSuffix: "Samples" }], reads: [{
  command, model: "Sample", methodSuffix: "Samples", table: { name: "sample", columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
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
  capture: input => Effect.fromResult(decodeJson(input)), call: (_participant, _command, args) => Effect.succeed(args),
  emit: () => Effect.fail(commerceError("unadmittedEvent")), refuse: error => Effect.fail(error),
});

describe("workflow registration and scoped resource composition", () => {
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

  it("normalizes only a completed top-level void result to native null", async () => {
    for (const value of [undefined, null, false, 0, "", [], {}]) {
      const flow = createWorkflow("completion-value", () => new WorkflowResponse(value));
      expect(await Effect.runPromise(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), context(), null,
        owner => bindWorkflowResources(resources, members, undefined, [], context(), owner))))
        .toEqual(value === undefined ? null : value);
    }
    for (const value of [{ missing: undefined }, [undefined]]) {
      const flow = createWorkflow("invalid-completion-value", () => new WorkflowResponse(value));
      const exit = await Effect.runPromise(Effect.exit(runNativeMedusaWorkflow(Result.getOrThrow(flow.prepare()), context(), null,
        owner => bindWorkflowResources(resources, members, undefined, [], context(), owner))));
      expect(Exit.isFailure(exit)).toBe(true);
    }
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
