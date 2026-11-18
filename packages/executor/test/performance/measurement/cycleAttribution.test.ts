import { Cause, Effect, Exit, Fiber } from "effect";
import { expect, it } from "vitest";
import { assertCycleTransformSelection, captureCyclePartition, createCyclePartition, observeGenerator, registerCycleSource } from "./cycleAttribution";
import { transformCycleGenerators } from "./cycleTransform";

const fixture = (observed = true) => {
  let cycles = 0n;
  const reader = { read: () => cycles, threadId: () => 7 };
  return { partition: createCyclePartition(reader, "generators", observed), reader, spend: (amount: number) => { cycles += BigInt(amount); } };
};
it("partitions nested synchronous work exactly without double counting", async () => {
  const { partition, spend } = fixture();
  await captureCyclePartition(partition, async () => {
    spend(2);
    const engine = partition.enter("engine");
    if (engine === undefined) throw new Error("Missing engine observation");
    spend(3);
    const body = partition.enter("body");
    if (body === undefined) throw new Error("Missing body observation");
    spend(5); partition.leave(body); spend(7); partition.leave(engine); spend(11);
  });
  expect(partition.evidence()).toMatchObject({ complete: true, totalCycles: 28, buckets: [
    { site: "outside-observed-execution", cycles: 13 }, { site: "engine", cycles: 10 }, { site: "body", cycles: 5 },
  ] });
});
it("forwards generator receiver, inputs, throw, return and finally in original order", async () => {
  const { partition, spend } = fixture();
  const events: string[] = [], refusal = new Error("original getter defect");
  const factory = observeGenerator("body", function*(this: { value: number }, add: number): Generator<number, void, unknown> {
    try { spend(3); yield this.value + add; spend(5); throw refusal; }
    finally { spend(7); events.push("finally"); }
  });
  await captureCyclePartition(partition, async () => {
    const iterator = factory.call({ value: 9 }, 2);
    expect(iterator.next()).toEqual({ done: false, value: 11 });
    expect(() => iterator.next()).toThrow(refusal);
    const returned = factory.call({ value: 1 }, 1);
    returned.next(); expect(returned.return(undefined)).toEqual({ done: true, value: undefined });
    const thrown = factory.call({ value: 1 }, 1);
    thrown.next(); expect(() => thrown.throw(refusal)).toThrow(refusal);
  });
  expect(events).toEqual(["finally", "finally", "finally"]);
  expect(partition.evidence().complete).toBe(true);
  expect(partition.evidence().buckets.find(bucket => bucket.site === "body")?.cycles).toBe(35);
});
it("keeps later iterator work lazy after the first typed failure and permits repeated runs", async () => {
  const { partition, spend } = fixture(); let later = 0;
  const failure = { reason: "first" };
  const operation = Effect.gen(observeGenerator("lazy", function*() {
    spend(2); yield* Effect.fail(failure); later++;
  }));
  await captureCyclePartition(partition, async () => {
    expect(await Effect.runPromiseExit(operation)).toEqual(Exit.fail(failure));
    expect(await Effect.runPromiseExit(operation)).toEqual(Exit.fail(failure));
  });
  expect(later).toBe(0);
  expect(partition.evidence().buckets.find(bucket => bucket.site === "lazy")?.cycles).toBe(4);
});
it("retains the original rejection when counter observation fails", async () => {
  const { reader, partition } = fixture(); const original = new Error("original request failure");
  await expect(captureCyclePartition(partition, async () => {
    reader.read = () => { throw new Error("counter failure"); }; throw original;
  })).rejects.toBe(original);
  expect(partition.evidence().complete).toBe(false);
  expect(partition.failures()).toHaveLength(1);
  const next = fixture(); await captureCyclePartition(next.partition, async () => 42);
  expect(next.partition.evidence().complete).toBe(true);
});
it("reports counter reversal and thread migration as incomplete", async () => {
  const { reader, partition, spend } = fixture();
  spend(10);
  await captureCyclePartition(partition, async () => { reader.read = () => 9n; reader.threadId = () => 8; });
  expect(partition.evidence().complete).toBe(false);
  expect(partition.failures()).toHaveLength(2);
});
it("does not certify an observed root whose required execution boundary is missing", async () => {
  const { partition } = fixture();
  await captureCyclePartition(partition, async () => 17);
  partition.requireObservedSite("effect-engine");
  expect(partition.evidence().complete).toBe(false);
  const disabled = fixture(false);
  await captureCyclePartition(disabled.partition, async () => 17);
  disabled.partition.requireObservedSite("effect-engine");
  expect(disabled.partition.evidence().complete).toBe(true);
});
it("does not observe generator bodies in disabled roots", async () => {
  const { partition, spend } = fixture(false);
  const generator = observeGenerator("disabled", function*() { spend(6); yield 1; });
  await captureCyclePartition(partition, async () => { expect(generator().next().value).toBe(1); });
  expect(partition.evidence().buckets).toEqual([{ site: "outside-observed-execution", cycles: 6, calls: 0 }]);
});
it("preserves interruption and finalization across suspended generator work", async () => {
  const { partition } = fixture(); let finalized = 0;
  const operation = Effect.gen(observeGenerator("interrupt", function*() { yield* Effect.never; })).pipe(
    Effect.ensuring(Effect.sync(() => { finalized++; })));
  await captureCyclePartition(partition, async () => {
    const fiber = Effect.runFork(operation);
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
  });
  expect(finalized).toBe(1);
  expect(partition.evidence().complete).toBe(true);
});
it("limits transformation to authored runtime generator expressions and retains provenance", () => {
  const source = "export const operation = Effect.gen(function* () { yield* original(); });";
  const transformed = transformCycleGenerators(source, "C:/repo/packages/storage/src/owner.ts");
  expect(transformed).toContain('observeGenerator("packages/storage/src/owner.ts:1:operation",function*');
  expect(transformed).toContain("yield* original();");
  expect(transformed).toContain('"originalHash"');
  expect(transformCycleGenerators(source, "C:/repo/packages/executor/test/performance/measurement/run.ts")).toBeUndefined();
});
it("refuses mismatched transform selections instead of contaminating quiet controls", () => {
  expect(() => assertCycleTransformSelection("generators")).toThrow("not installed");
  registerCycleSource({ file: "packages/test/src/test.ts", originalHash: "a", transformedHash: "b", sites: ["test"] });
  expect(() => assertCycleTransformSelection()).toThrow("require the generator cycle selection");
  expect(() => assertCycleTransformSelection("engine")).toThrow("require the generator cycle selection");
  expect(() => assertCycleTransformSelection("generators")).not.toThrow();
});
