import { describe, expect, it, vi } from "vitest";
import { Effect, Option } from "effect";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceModuleEventBus } from "../src/module/events";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";

describe("native module event binding", () => {
  it("validates options before inspecting messages and validates the complete batch before forwarding", async () => {
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    const capture = vi.fn(() => Effect.void);
    const bus = commerceModuleEventBus({ owner, resources: defaultCommerceResources,
      capture, check: work => work, refuse: () => owner.run(Effect.fail(commerceError("unsupportedProfile"))),
    });
    const inspect = vi.fn();
    const messages = new Proxy([{ name: "sample", data: {} }], {
      ownKeys: target => { inspect(); return Reflect.ownKeys(target); },
    });
    try {
      await expect(bus.emit(messages, { internal: false })).rejects.toMatchObject({ reason: "unadmittedEvent" });
      expect(inspect).not.toHaveBeenCalled();
      const getter = vi.fn(() => "unsafe");
      const invalid = Object.defineProperty({ name: "sample", data: {} }, "extra", { get: getter, enumerable: true });
      await expect(bus.emit([{ name: "sample", data: {} }, invalid], { internal: true }))
        .rejects.toMatchObject({ reason: "invalidInput" });
      expect(getter).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
    } finally { await Effect.runPromise(owner.close); }
  });

  it.each(["snapshot", "current"] as const)("retains the %s refusal policy across sequential event forwarding", async policy => {
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    let active = "root";
    const forwarded: string[] = [];
    const refused: string[] = [];
    const failure = commerceError("unadmittedEvent");
    const bus = commerceModuleEventBus({ owner, resources: defaultCommerceResources,
      capture: () => Effect.gen(function* () {
        forwarded.push(active);
        if (forwarded.length === 1) active = "child";
        else return yield* Effect.fail(failure);
      }),
      check: work => {
        const selected = active;
        return work.pipe(Effect.catchTag("CommerceTransactionError", error => {
          refused.push(policy === "snapshot" ? selected : active);
          return Effect.fail(error);
        }));
      },
      refuse: () => owner.run(Effect.fail(commerceError("unsupportedProfile"))),
    });
    try {
      await expect(bus.emit([{ name: "first", data: {} }, { name: "second", data: {} }], { internal: true }))
        .rejects.toBe(failure);
      expect(forwarded).toEqual(["root", "child"]);
      expect(refused).toEqual([policy === "snapshot" ? "root" : "child"]);
    } finally { await Effect.runPromise(owner.close); }
  });

  it("keeps caught subscription refusal sticky and refuses grouped and escaped event operations", async () => {
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    const bus = commerceModuleEventBus({ owner, resources: defaultCommerceResources,
      capture: () => Effect.void, check: work => work,
      refuse: () => owner.run(Effect.fail(commerceError("unsupportedProfile"))),
    });
    try {
      expect(() => bus.subscribe("sample", async () => {})).toThrow();
      expect(Option.getOrUndefined(owner.refusal())).toMatchObject({ reason: "unsupportedProfile" });
      await expect(bus.releaseGroupedEvents("group")).rejects.toMatchObject({ reason: "unsupportedProfile" });
    } finally { await Effect.runPromise(owner.close); }
    await expect(bus.emit([], { internal: true })).rejects.toMatchObject({ reason: "closed" });
  });
});
