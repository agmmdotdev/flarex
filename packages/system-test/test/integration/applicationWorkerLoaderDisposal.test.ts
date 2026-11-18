import { describe, expect, it, vi } from "vitest";
import { MiniflareApplicationWorkerLoader } from "../../support/applicationNativeQueryHarness";

describe("Application Worker loader disposal", () => {
  it("captures early failure and waits for every released and live runtime", async () => {
    const loader = new MiniflareApplicationWorkerLoader();
    const early = failingDisposal();
    const delayed = failingDisposal();
    const firstFailure = new Error("early disposal failure");
    const secondFailure = new Error("late disposal failure");
    const first = { dispose: vi.fn(() => early.promise) };
    const second = { dispose: vi.fn(() => delayed.promise) };
    loader.attach(first);
    loader.attach(second);
    loader.release(first);
    loader.release(first);
    early.reject(firstFailure);
    // A caller may still be finalizing the invocation. Vitest rejects unhandled
    // promises; the loader must already be observing this early rejection.
    await new Promise<void>(resolve => setImmediate(resolve));

    const draining = loader.dispose();
    let settled = false;
    void draining.then(() => { settled = true; }, () => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    delayed.reject(secondFailure);
    await expect(draining).rejects.toMatchObject({
      name: "AggregateError", errors: [firstFailure, secondFailure],
    });
    await expect(loader.dispose()).resolves.toBeUndefined();
  });

  it("joins successful cleanup once and can serve another invocation", async () => {
    const loader = new MiniflareApplicationWorkerLoader();
    const first = { dispose: vi.fn(async () => {}) };
    const second = { dispose: vi.fn(async () => {}) };
    loader.attach(first);
    loader.release(first);
    await loader.dispose();
    loader.attach(second);
    await loader.dispose();
    await loader.dispose();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });
});

function failingDisposal() {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((_resolve, fail) => { reject = fail; });
  return { promise, reject };
}
