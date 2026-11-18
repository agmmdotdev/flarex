import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { prepareLogicalSelfCascade, selfCascadeNode } from "./support/logical-self-cascade-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let proof: Awaited<ReturnType<typeof prepareLogicalSelfCascade>>;
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeOutput = Schema.decodeUnknownSync(Schema.Struct({ roots: Schema.Array(Schema.String), deleted: Schema.Array(Schema.String) }));
const chain = (prefix: string, count = 3) => Array.from({ length: count }, (_, index) =>
  selfCascadeNode(`${prefix}-${index}`, index === 0 ? null : `${prefix}-${index - 1}`, index % 2 === 1));
const rows = async () => decodeRows(await proof.read());
const ids = async () => (await rows()).map(row => row.id);

describe(`neutral logical self-cascade - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    proof = await prepareLogicalSelfCascade(driver, close => cleanup.push(close), [
      ...chain("baseline"), ...chain("overlap"), ...chain("incomplete"), ...chain("bound"), ...chain("late"),
      selfCascadeNode("ancestor"), ...Array.from({ length: 8 }, (_, index) =>
        selfCascadeNode(`deep-${index}`, index === 0 ? "ancestor" : `deep-${index - 1}`, index % 2 === 1)),
      selfCascadeNode("unrelated"), selfCascadeNode("unrelated-child", "unrelated", true),
      selfCascadeNode("self-cycle"), selfCascadeNode("cycle-a"), selfCascadeNode("cycle-b"),
    ]);
  }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("deletes a three-level chain child first and emits only the explicitly requested root", async () => {
    const before = await rows(), inventory = await proof.snapshot();
    const request = proof.host.newRequestKey();
    const output = decodeOutput(await proof.run({ ids: ["baseline-0"] }, request));
    expect(output).toEqual({ roots: ["baseline-0"], deleted: ["baseline-2", "baseline-1", "baseline-0"] });
    expect(await rows()).toEqual(before.filter(row => !output.deleted.includes(String(row.id))));
    const activity = proof.activities.at(-1);
    expect(activity?.mutations.map(mutation => ({ ordinal: mutation.ordinal, id: mutation.before?.id,
      table: mutation.table, operation: mutation.operation, after: mutation.after }))).toEqual(output.deleted.map((id, ordinal) =>
      ({ ordinal, id, table: "neutral_node", operation: "delete", after: null })));
    expect(activity?.relationalReads.every(read => read.total === read.returned)).toBe(true);
    const after = await proof.snapshot();
    expect(after.revisions.length - inventory.revisions.length).toBe(3);
    expect(after.rowChanges.length - inventory.rowChanges.length).toBe(3);
    expect(after.events.length - inventory.events.length).toBe(1);
    const calls = proof.activities.length;
    expect(await proof.run({ ids: ["baseline-0"] }, request)).toEqual(output);
    expect(proof.activities).toHaveLength(calls);
    expect(await proof.snapshot()).toEqual(after);
  }, 180_000);

  it("deduplicates overlapping roots, repeated IDs and missing IDs without treating descendants as requested roots", async () => {
    const output = decodeOutput(await proof.run({ ids: ["overlap-0", "overlap-1", "overlap-0", "missing"] }));
    expect(output).toEqual({ roots: ["overlap-1", "overlap-0"], deleted: ["overlap-2", "overlap-1", "overlap-0"] });
    expect((await ids()).some(id => typeof id === "string" && id.startsWith("overlap-"))).toBe(false);
    expect(await proof.run({ ids: ["missing", "missing", ""] })).toEqual({ roots: [], deleted: [] });
    expect(await proof.run({ ids: [] })).toEqual({ roots: [], deleted: [] });
  }, 180_000);

  it("traverses eight levels including historical descendants while retaining the ancestor and unrelated tree", async () => {
    const before = await rows(), output = decodeOutput(await proof.run({ ids: ["deep-0"] }));
    expect(output).toEqual({ roots: ["deep-0"], deleted: Array.from({ length: 8 }, (_, index) => `deep-${7 - index}`) });
    expect(await rows()).toEqual(before.filter(row => !output.deleted.includes(String(row.id))));
    expect(await ids()).toEqual(expect.arrayContaining(["ancestor", "unrelated", "unrelated-child"]));
  }, 180_000);

  it.each(["incomplete", "overBound", "lateRefusal"] as const)("refuses %s without revisions, facts, outcomes, clocks or event publication", async recipe => {
    const prefix = recipe === "overBound" ? "bound" : recipe === "lateRefusal" ? "late" : "incomplete";
    const before = await proof.snapshot();
    const result = await Effect.runPromise(Effect.result(proof.host.run(proof.host.newRequestKey(), proof.root,
      { ids: [`${prefix}-0`], recipe })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: recipe === "lateRefusal" ? "invalidInput" : "receiptMismatch" } });
    expect(await proof.snapshot()).toEqual(before);
  }, 180_000);

  it.each(["self", "pair"] as const)("refuses a persisted %s cycle atomically", async kind => {
    await proof.patch(kind === "self" ? [{ id: "self-cycle", parent_id: "self-cycle" }] :
      [{ id: "cycle-a", parent_id: "cycle-b" }, { id: "cycle-b", parent_id: "cycle-a" }]);
    const before = await proof.snapshot(), calls = proof.activities.length;
    expect(await Effect.runPromise(Effect.result(proof.host.run(proof.host.newRequestKey(), proof.root,
      { ids: [kind === "self" ? "self-cycle" : "cycle-a"] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(proof.activities).toHaveLength(calls);
    expect(await proof.snapshot()).toEqual(before);
  }, 180_000);
});
