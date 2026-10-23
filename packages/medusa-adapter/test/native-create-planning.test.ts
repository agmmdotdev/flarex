import { describe, expect, it } from "vitest";
import { planCreateBatch, planScalarCreateBatch } from "@medusajs/utils/dal/create-planning";

describe("native DAL create reference and flat scalar planning", () => {
  it("normalizes every original position before exposing final canonical references", () => {
    const inputs = [{ id: "a", value: null }, { id: "b", value: "b" }, { id: "a", value: "later" }];
    const a = { id: "a", value: null as string | null }, b = { id: "b", value: "b" };
    const calls: { input: typeof inputs[number]; index: number }[] = [];
    const plan = planCreateBatch(inputs, (input, index) => {
      calls.push({ input, index });
      if (input.id === "a") { a.value ??= input.value; return a; }
      return b;
    });
    expect(calls.map(call => call.index)).toEqual([0, 1, 2]);
    for (const [index, call] of calls.entries()) expect(call.input).toBe(inputs[index]);
    expect(plan.entities).toEqual([a, b]); expect(plan.positions).toEqual([0, 1, 0]);
    expect(plan.created).toEqual([a, b, a]); expect(plan.created[0]).toBe(plan.created[2]);
    expect(plan.created[0]?.value).toBe("later");
    // Equal IDs do not establish native identity; the normalizer owns it.
    expect(planCreateBatch(inputs, input => ({ ...input })).entities).toHaveLength(3);
  });

  it("preserves normalizer failure order and original thrown identity", () => {
    const failure = new Error("native normalization failed"), calls: number[] = [];
    expect(() => planCreateBatch([0, 1, 2], input => {
      calls.push(input); if (input === 1) throw failure; return { input };
    })).toThrow(failure);
    expect(calls).toEqual([0, 1]);
  });

  it("hydrates omitted and null scalar/FK/JSON/timestamps from the first later non-null alias", () => {
    const sources = [
      { id: "a", scalar: null, foreign_id: null, metadata: null },
      { id: "b", scalar: "b" },
      { id: "a", scalar: null, foreign_id: "target", metadata: { second: 2 }, created_at: "2020-01-01T00:00:00Z" },
      { id: "a", scalar: "third", foreign_id: "other", metadata: { third: 3 }, created_at: "2021-01-01T00:00:00Z" },
    ];
    const before = structuredClone(sources), plan = planScalarCreateBatch(sources);
    expect(plan.positions).toEqual([0, 1, 0, 0]); expect(plan.entities).toHaveLength(2);
    expect(plan.entities[0]).toEqual({ id: "a", scalar: "third", foreign_id: "target", metadata: { second: 2 }, created_at: "2020-01-01T00:00:00Z" });
    expect(plan.created[0]).toBe(plan.created[2]); expect(plan.created[2]).toBe(plan.created[3]);
    expect(sources).toEqual(before); expect(plan.entities[0]).not.toBe(sources[0]);
    expect(planScalarCreateBatch([{ id: "a", scalar: "fresh call" }]).entities[0]?.scalar).toBe("fresh call");
  });

  it("retains false, zero, empty string, and whole JSON values without merging their contents", () => {
    const sources = [{ id: "a", flag: false, number: 0, text: "", metadata: {}, list: [1] },
      { id: "a", flag: true, number: 5, text: "later", metadata: { later: true }, list: [2] }];
    const plan = planScalarCreateBatch(sources);
    expect(plan.entities).toEqual([sources[0]]); expect(plan.positions).toEqual([0, 0]);
  });

  it("keeps distinct generated identities and empty input separate from repeated explicit aliases", () => {
    const plan = planScalarCreateBatch([{ id: "generated-a", text: "same" }, { id: "explicit", text: "first" },
      { id: "generated-b", text: "same" }, { id: "explicit", text: "later" }]);
    expect(plan.entities.map(row => row.id)).toEqual(["generated-a", "explicit", "generated-b"]);
    expect(plan.positions).toEqual([0, 1, 2, 1]);
    expect(planScalarCreateBatch([])).toEqual({ entities: [], positions: [], created: [] });
  });
});
