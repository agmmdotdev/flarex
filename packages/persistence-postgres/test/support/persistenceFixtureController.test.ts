import { describe, expect, it } from "vitest";
import { createPersistenceFixtureController, useLazyFileScopedPersistence } from "./fileScopedPersistenceFixture";

describe("persistence fixture ownership", () => {
  it("acquires only on preparation, reuses clean resources and rebuilds after callback or reset failure", async () => {
    let creates = 0;
    let resets = 0;
    let disposals = 0;
    let resetFailure: Error | undefined;
    const controller = createPersistenceFixtureController(async () => ({ persistence: ++creates,
      reset: async () => { resets++; if (resetFailure !== undefined) throw resetFailure; },
      dispose: async () => { disposals++; } }));
    expect(creates).toBe(0);
    try {
      await controller.prepare();
      await controller.prepare();
      expect(creates).toBe(1);
      await controller.borrow(async value => { expect(value).toBe(1); });
      const failure = new Error("callback failure");
      await expect(controller.borrow(async () => { throw failure; })).rejects.toBe(failure);
      await controller.prepare();
      expect(creates).toBe(2);
      expect(disposals).toBe(1);
      resetFailure = new Error("reset failure");
      await expect(controller.borrow(async () => undefined)).rejects.toBe(resetFailure);
      resetFailure = undefined;
      await controller.prepare();
      expect(creates).toBe(3);
      expect(resets).toBe(2);
    } finally { await controller.dispose(); }
    expect(disposals).toBe(3);
    await expect(controller.borrow(async () => undefined)).rejects.toThrow("closing");
  });

  it("drains acquisition and pending callbacks before disposal, even when the caller stops waiting", async () => {
    let finishConstruction: (() => void) | undefined;
    const constructing = new Promise<void>(resolve => { finishConstruction = resolve; });
    let finishBorrow: (() => void) | undefined;
    const held = new Promise<void>(resolve => { finishBorrow = resolve; });
    let disposed = false;
    const controller = createPersistenceFixtureController(async () => {
      await constructing;
      return { persistence: {}, reset: async () => undefined, dispose: async () => { disposed = true; } };
    });
    const prepared = controller.prepare();
    const pending = controller.borrow(async () => held);
    const disposal = controller.dispose();
    await Promise.resolve();
    expect(disposed).toBe(false);
    finishConstruction?.();
    await prepared;
    expect(disposed).toBe(false);
    finishBorrow?.();
    await Promise.all([pending, disposal]);
    expect(disposed).toBe(true);
    expect(controller.dispose()).toBe(disposal);
  });

  it("never constructs a replacement after retirement fails", async () => {
    let creates = 0;
    const cleanupFailure = new Error("retirement failed");
    const controller = createPersistenceFixtureController(async () => ({ persistence: ++creates,
      reset: async () => undefined, dispose: async () => { throw cleanupFailure; } }));
    const failure = new Error("callback failed");
    await expect(controller.borrow(async () => { throw failure; })).rejects.toBe(failure);
    await expect(controller.prepare()).rejects.toBe(cleanupFailure);
    await expect(controller.borrow(async () => undefined)).rejects.toBe(cleanupFailure);
    expect(creates).toBe(1);
    await expect(controller.dispose()).rejects.toBe(cleanupFailure);
  });
});

describe("selected database tests", () => {
  let acquisitions = 0;
  const fixture = useLazyFileScopedPersistence(async () => ({ persistence: ++acquisitions,
    reset: async () => undefined, dispose: async () => undefined }));
  it("runs a pure selection without acquiring its file's unused database", () => {
    expect(acquisitions).toBe(0);
  });
  fixture.it.each(["first", "reused"])("prepares a selected database case before entering its body: %s", async () => {
    expect(acquisitions).toBe(1);
    await fixture.withPersistence(async value => { expect(value).toBe(1); });
  });
});
