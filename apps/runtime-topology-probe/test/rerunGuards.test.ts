import { describe, expect, it } from "vitest";

import {
  ProbeOneShotInvocationGate,
  ProbeRerunConcurrencyFence,
} from "../src/index";

describe("P06 rerun guards", () => {
  it("rejects concurrent and repeated one-shot capability use", async () => {
    const gate = new ProbeOneShotInvocationGate();
    const pending = deferred<number>();
    const first = gate.run(async () => await pending.promise);

    await expect(gate.run(async () => 2)).rejects.toThrow(
      "runtime rerun capability already consumed",
    );
    pending.resolve(1);
    await expect(first).resolves.toBe(1);
    await expect(gate.run(async () => 3)).rejects.toThrow(
      "runtime rerun capability already consumed",
    );
  });

  it("rejects only a concurrent rerun with the same sample key", async () => {
    const fence = new ProbeRerunConcurrencyFence();
    const pending = deferred<number>();
    const first = fence.run("sample-a", async () => await pending.promise);

    await expect(
      fence.run("sample-a", async () => 2),
    ).rejects.toThrow("synthetic sync rerun already active");
    await expect(fence.run("sample-b", async () => 3)).resolves.toBe(3);
    pending.resolve(1);
    await expect(first).resolves.toBe(1);
    await expect(fence.run("sample-a", async () => 4)).resolves.toBe(4);
  });

  it("releases the sample fence after an operation fails", async () => {
    const fence = new ProbeRerunConcurrencyFence();

    await expect(
      fence.run("sample-a", async () => {
        throw new Error("expected failure");
      }),
    ).rejects.toThrow("expected failure");
    await expect(fence.run("sample-a", async () => 1)).resolves.toBe(1);
  });
});

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>(resolve => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) {
    throw new Error("deferred resolver was not initialized");
  }
  return { promise, resolve: resolvePromise };
}
