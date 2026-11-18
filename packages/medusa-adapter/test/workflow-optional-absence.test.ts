import { describe, expect, it, vi } from "vitest";
import { Effect, Exit, Result, Schema } from "effect";
import { useCache } from "@medusajs/utils/caching/index";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../src/value/decoder";
import { prepareWorkflowResources, workflowAbsentResources, workflowResourceSelections } from "../src/workflow/resources";
import { bindWorkflowResources } from "../src/workflow/binding";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { promiseFailureObserver } from "./support/promise-failure-observer";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { defineWorkflowMethod, defineWorkflowModule } from "../src/workflow/module";

async function bind(absent: readonly string[] = []) {
  const command = defineGraphReadCommand("knownOptionalAbsenceRead", () => Effect.succeed(0));
  const read = Result.getOrThrow(defineWorkflowMethod({ command, arguments: commerceDecoder(Schema.Tuple([]), "invalidInput"),
    encode: () => null, output: commerceDecoder(Schema.Number, "storedCorruption") }));
  const module = Result.getOrThrow(defineWorkflowModule({ name: "known", source: { name: "known", profile: "known-optional-absence" },
    methods: { read }, graph: { aliases: [], reads: [] } }));
  const selection = Result.getOrThrow(prepareWorkflowResources({ known: { module, methods: ["read"], graph: false } }, false, undefined, { absent }));
  const members = workflowResourceSelections(selection);
  if (members === undefined) throw new Error("Missing authentic selection");
  const recordFailure = promiseFailureObserver(), decode = commerceDecoder(Schema.Json, "invalidInput");
  const call = vi.fn<AtomicCommerceContext["call"]>(() => Effect.fail(commerceError("unsupportedProfile")));
  const ctx: AtomicCommerceContext = { recordFailure, eventGroupId: "optional-absence160", checkpoint: Effect.void, call,
    capture: (input, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decode)(input))),
    refuse: error => Effect.fail(error), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
  };
  const owner = await Effect.runPromise(makeCommercePromiseOwner(recordFailure));
  return { owner, container: bindWorkflowResources(selection, members, undefined, [], ctx, owner), recordFailure, call };
}

describe("authenticated optional workflow resource absence", () => {
  it("preserves required and optional resolution of an actually selected resource", async () => {
    const bound = await bind();
    try {
      const required: object = bound.container.resolve<object>("known");
      const optional: object | undefined = bound.container.resolve<object>("known", { allowUnregistered: true });
      expect(optional).toBe(required);
      expect(bound.recordFailure).not.toHaveBeenCalled();
      await Effect.runPromise(bound.owner.close);
      expect(() => bound.container.resolve("known")).toThrow(expect.objectContaining({ reason: "closed" }));
    } finally { await Effect.runPromise(bound.owner.close); }
  });
  it("executes the actual native uncached callback after the declared caching lookup", async () => {
    const bound = await bind(["caching"]), callback = vi.fn(async () => ({ result: "native callback" }));
    try {
      expect(await useCache(callback, { container: bound.container, key: "cart-context160" })).toEqual({ result: "native callback" });
      expect(callback).toHaveBeenCalledOnce();
      expect(bound.call).not.toHaveBeenCalled();
      expect(bound.recordFailure).not.toHaveBeenCalled();
      const optional: object | undefined = bound.container.resolve<object>("caching", { allowUnregistered: true });
      expect(optional).toBeUndefined();
    } finally { await Effect.runPromise(bound.owner.close); }
  });

  it("refuses native useCache before its callback when caching absence is undeclared", async () => {
    const bound = await bind(), callback = vi.fn(async () => "unreachable");
    try {
      await expect(useCache(callback, { container: bound.container, key: "undeclared-native-cache" }))
        .rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(callback).not.toHaveBeenCalled();
      expect(bound.recordFailure).toHaveBeenCalledOnce();
      expect(bound.call).not.toHaveBeenCalled();
    } finally { await Effect.runPromise(bound.owner.close); }
  });

  it.each(["required-declared", "optional-undeclared", "optional-existing-profile"])("retains sticky refusal for %s", async mode => {
    const bound = await bind(mode === "optional-existing-profile" ? [] : ["caching"]);
    try {
      expect(() => mode === "required-declared" ? bound.container.resolve("caching")
        : bound.container.resolve(mode === "optional-undeclared" ? "logger" : "caching", { allowUnregistered: true })).toThrow();
      expect(bound.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ reasons: expect.arrayContaining([
        expect.objectContaining({ error: expect.objectContaining({ reason: "unsupportedProfile" }) }),
      ]) }));
      expect(bound.call).not.toHaveBeenCalled();
    } finally { await Effect.runPromise(bound.owner.close); }
  });

  it("refuses malformed optional options without invoking their accessors", async () => {
    const getter = vi.fn(() => true);
    for (const options of [undefined, null, {}, { allowUnregistered: false }, { allowUnregistered: true, extra: true },
      Object.defineProperty({}, "allowUnregistered", { get: getter, enumerable: true })]) {
      const bound = await bind(["caching"]);
      try {
        expect(() => Reflect.apply(bound.container.resolve, bound.container, ["caching", options])).toThrow();
        expect(bound.recordFailure).toHaveBeenCalled();
      } finally { await Effect.runPromise(bound.owner.close); }
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("checks the existing owner lifetime before required or optional resolution", async () => {
    const bound = await bind(["caching"]);
    await Effect.runPromise(bound.owner.close);
    expect(() => bound.container.resolve("caching", { allowUnregistered: true })).toThrow(expect.objectContaining({ reason: "closed" }));
    expect(() => bound.container.resolve("anything")).toThrow(expect.objectContaining({ reason: "closed" }));
    expect(bound.call).not.toHaveBeenCalled();
  });

  it("fences late native caching lookup without recording failure or reopening final cleanup", async () => {
    const bound = await bind(["caching"]), callback = vi.fn(async () => "unreachable");
    expect(Exit.isSuccess(await Effect.runPromise(bound.owner.close))).toBe(true);
    await expect(useCache(callback, { container: bound.container, key: "late-native-cache" }))
      .rejects.toMatchObject({ reason: "closed" });
    expect(() => bound.container.resolve("caching", { allowUnregistered: true })).toThrow(expect.objectContaining({ reason: "closed" }));
    expect(callback).not.toHaveBeenCalled(); expect(bound.recordFailure).not.toHaveBeenCalled();
    expect(Exit.isSuccess(await Effect.runPromise(bound.owner.close))).toBe(true);
  });

  it("refuses malformed absence options instead of treating explicit null as omitted", () => {
    for (const options of [null, [], "caching", { absent: null }, { absent: undefined }, {}, { absent: [], extra: true }]) {
      expect(Reflect.apply(prepareWorkflowResources, undefined, [{}, false, undefined, options]))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
  });

  it("captures exact finite absence declarations without widening reserved resources", () => {
    for (const options of [{ absent: ["caching", "caching"] }, { absent: ["query"] }, { absent: ["remoteQuery"] },
      { absent: ["event_bus"] }, { absent: ["__proto__"] }, { absent: ["caching"], other: true }])
      expect(Reflect.apply(prepareWorkflowResources, undefined, [{}, false, undefined, options]))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    const declared = ["caching"], prepared = prepareWorkflowResources({}, false, undefined, { absent: declared });
    declared.push("logger");
    expect(workflowAbsentResources(Result.getOrThrow(prepared))).toEqual(["caching"]);
    expect(Object.isFrozen(workflowAbsentResources(Result.getOrThrow(prepared)))).toBe(true);
  });

  it("cannot declare an actually selected module absent", async () => {
    await expect(bind(["known"])).rejects.toThrow();
  });
});
