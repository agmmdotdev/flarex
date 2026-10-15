import { describe, expect, it, vi } from "vitest";
import { Effect, Option, Result, Schema } from "effect";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { commerceDecoder } from "../src/value/decoder";
import { defineWorkflowMethod, defineWorkflowModule } from "../src/workflow/module";
import { defineComposedWorkflowResource } from "../src/workflow/composed-resource";
import { prepareWorkflowResources, workflowResourceSelections } from "../src/workflow/resources";
import { bindWorkflowResources } from "../src/workflow/binding";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { captureCommerceInput } from "../src/value/input";

function member(name: string) {
  const command = defineGraphReadCommand(name, () => Effect.succeed(0));
  const decodeArguments = commerceDecoder(Schema.Tuple([Schema.Number]), "invalidInput");
  const method = Result.getOrThrow(defineWorkflowMethod({ command,
    arguments: decodeArguments, encode: ([value]: Result.Result.Success<ReturnType<typeof decodeArguments>>) => value,
    output: commerceDecoder(Schema.Number, "storedCorruption"),
  }));
  const module = Result.getOrThrow(defineWorkflowModule({ name, source: { name, profile: name }, methods: { read: method }, graph: {
    aliases: [{ name, model: "Sample" }], reads: [{ command, model: "Sample",
      table: { name, columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} }, paths: [], orderable: ["id"],
      uniqueOrder: ["id"], multipleOrder: false, decode: commerceDecoder(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]), "storedCorruption"),
    }],
  } }));
  return { command, method, module };
}

describe("finite composed resources over authentic source methods", () => {
  it.each(["local-result", "caught-undeclared-invoke"])("confines an empty dependency resource: %s", async mode => {
    const selected = member("selected");
    const resource = Result.getOrThrow(defineComposedWorkflowResource({ identity: { format: "neutral-empty", mode },
      dependencies: [], methods: { read: {
        arguments: commerceDecoder(Schema.Tuple([Schema.Number]), "invalidInput"), output: commerceDecoder(Schema.Number, "storedCorruption"),
      } }, bind: invoke => ({ read: async (value: number) => {
        if (mode === "caught-undeclared-invoke") {
          try { return await invoke(selected.method, value); } catch { return 0; }
        }
        return value;
      } }),
    }));
    const resources = Result.getOrThrow(prepareWorkflowResources({
      selected: { module: selected.module, methods: ["read"], graph: false, expose: false },
    }, false, { local: resource }));
    const decodeJson = commerceDecoder(Schema.Json, "invalidInput");
    const call = vi.fn<AtomicCommerceContext["call"]>((_participant, _command, input) => Effect.succeed(input));
    const ctx: AtomicCommerceContext = { eventGroupId: "neutral-empty", checkpoint: Effect.void,
      capture: (input, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decodeJson)(input))),
      call, refuse: error => Effect.fail(error), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    };
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    try {
      const selections = workflowResourceSelections(resources); if (!selections) throw new Error("Missing selection");
      const local = bindWorkflowResources(resources, selections, undefined, [], ctx, owner)
        .resolve<{ read(value: number): Promise<unknown> }>("local");
      expect(await local.read(7)).toBe(mode === "local-result" ? 7 : 0);
      expect(owner.refusal()).toMatchObject(mode === "local-result" ? { _tag: "None" }
        : { _tag: "Some", value: { reason: "invalidAuthority" } });
      expect(call).not.toHaveBeenCalled();
      await Effect.runPromise(owner.close);
      await expect(local.read(8)).rejects.toMatchObject({ reason: "closed" });
      expect(call).not.toHaveBeenCalled();
    } finally { await Effect.runPromise(owner.close); }
  });

  it("combines two private sources and revokes the entire facade with its owner", async () => {
    const first = member("first"), second = member("second");
    const composite = Result.getOrThrow(defineComposedWorkflowResource({ identity: { format: "neutral-pair" },
      dependencies: [first.method, second.method], methods: { sum: {
        arguments: commerceDecoder(Schema.Tuple([Schema.Number]), "invalidInput"), output: commerceDecoder(Schema.Number, "storedCorruption"),
      } }, bind: invoke => ({ sum: async (value: number) => await invoke(first.method, value) + await invoke(second.method, value + 1) }),
    }));
    const resources = Result.getOrThrow(prepareWorkflowResources({
      first: { module: first.module, methods: ["read"], graph: false, expose: false },
      second: { module: second.module, methods: ["read"], graph: false, expose: false },
    }, false, { pair: composite }));
    const calls: Array<{ participant: unknown; command: unknown; input: unknown }> = [];
    const decodeJson = commerceDecoder(Schema.Json, "invalidInput");
    const refuse = vi.fn<AtomicCommerceContext["refuse"]>(error => Effect.fail(error));
    const ctx: AtomicCommerceContext = { eventGroupId: "neutral-pair", checkpoint: Effect.void,
      capture: (input, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decodeJson)(input))),
      call: (participant, command, input) => Effect.sync(() => { calls.push({ participant, command, input }); return input; }),
      emit: () => Effect.fail(commerceError("unadmittedEvent")), refuse,
    };
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    try {
      const selected = workflowResourceSelections(resources);
      if (!selected) throw new Error("Missing resource selection");
      const container = bindWorkflowResources(resources, selected, undefined, [], ctx, owner);
      const pair = container.resolve<{ sum(value: unknown): Promise<unknown> }>("pair");
      expect(await pair.sum(5)).toBe(11);
      expect(calls.map(call => [call.command, call.input])).toEqual([[first.command, 5], [second.command, 6]]);
      expect(calls[0]?.participant).not.toBe(calls[1]?.participant);
      await expect(pair.sum("wrong")).rejects.toMatchObject({ reason: "invalidInput" });
      expect(refuse).toHaveBeenCalled();
      expect(calls).toHaveLength(2);
      expect(() => container.resolve("first")).toThrow();
      expect(Option.isSome(owner.refusal())).toBe(true);
      await Effect.runPromise(owner.close);
      await expect(pair.sum(1)).rejects.toMatchObject({ reason: "closed" });
      expect(calls).toHaveLength(2);
    } finally { await Effect.runPromise(owner.close); }
  });

  it("rejects forged resources and dependencies outside the finite selection", () => {
    const first = member("first"), other = member("other");
    const composite = Result.getOrThrow(defineComposedWorkflowResource({ identity: { format: "outside" }, dependencies: [other.method],
      methods: { read: { arguments: commerceDecoder(Schema.Tuple([Schema.Number]), "invalidInput"), output: commerceDecoder(Schema.Number, "storedCorruption") } },
      bind: invoke => ({ read: (value: number) => invoke(other.method, value) }),
    }));
    expect(prepareWorkflowResources({ first: { module: first.module, methods: ["read"], graph: false } }, false, { pair: composite }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(Reflect.apply(prepareWorkflowResources, undefined, [
      { first: { module: first.module, methods: ["read"], graph: false } }, false, { pair: {} },
    ])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(captureCommerceInput({ created_at: new Date() })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("captures bounded dense dependencies without invoking accessors or custom iterators", () => {
    const first = member("capture");
    const attempted = vi.fn(() => { throw new Error("Dependency accessor must not run"); });
    const accessor = [first.method], iterator = [first.method], sparse = [first.method];
    Object.defineProperty(accessor, "0", { get: attempted, enumerable: true });
    Object.defineProperty(iterator, Symbol.iterator, { get: attempted });
    Reflect.deleteProperty(sparse, "0");
    for (const dependencies of [accessor, iterator, sparse, Array.from({ length: commerceLimits.commandDefinitions + 1 }, () => first.method)]) {
      expect(defineComposedWorkflowResource({ identity: "capture", dependencies,
        methods: { read: { arguments: commerceDecoder(Schema.Tuple([Schema.Number]), "invalidInput"), output: commerceDecoder(Schema.Number, "storedCorruption") } },
        bind: invoke => ({ read: (value: number) => invoke(first.method, value) }),
      })).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
    expect(attempted).not.toHaveBeenCalled();
  });

  it.each(["corrupt-output", "caught-undeclared-invoke"])("refuses %s at the composed boundary", async mode => {
    const first = member("allowed"), other = member("undeclared");
    const composite = Result.getOrThrow(defineComposedWorkflowResource({ identity: mode, dependencies: [first.method],
      methods: { read: { arguments: commerceDecoder(Schema.Tuple([Schema.Number]), "invalidInput"), output: commerceDecoder(Schema.Number, "storedCorruption") } },
      bind: invoke => ({ read: async (_value: number) => {
        if (mode === "corrupt-output") return "invalid output";
        try { return await invoke(other.method, 1); } catch { return 0; }
      } }),
    }));
    const resources = Result.getOrThrow(prepareWorkflowResources({
      first: { module: first.module, methods: ["read"], graph: false, expose: false },
      other: { module: other.module, methods: ["read"], graph: false, expose: false },
    }, false, { pair: composite }));
    const decodeJson = commerceDecoder(Schema.Json, "invalidInput");
    const call = vi.fn<AtomicCommerceContext["call"]>((_participant, _command, input) => Effect.succeed(input));
    const refuse = vi.fn<AtomicCommerceContext["refuse"]>(error => Effect.fail(error));
    const ctx: AtomicCommerceContext = { eventGroupId: mode, checkpoint: Effect.void,
      capture: (input, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decodeJson)(input))),
      call, refuse, emit: () => Effect.fail(commerceError("unadmittedEvent")),
    };
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    try {
      const selected = workflowResourceSelections(resources); if (!selected) throw new Error("Missing resource selection");
      const pair = bindWorkflowResources(resources, selected, undefined, [], ctx, owner).resolve<{ read(value: number): Promise<unknown> }>("pair");
      if (mode === "corrupt-output") {
        await expect(pair.read(1)).rejects.toMatchObject({ reason: "storedCorruption" });
        expect(refuse).toHaveBeenCalledWith(expect.objectContaining({ reason: "storedCorruption" }));
      } else {
        expect(await pair.read(1)).toBe(0);
        expect(owner.refusal()).toMatchObject({ _tag: "Some", value: { reason: "invalidAuthority" } });
      }
      expect(call).not.toHaveBeenCalled();
    } finally { await Effect.runPromise(owner.close); }
  });
});
