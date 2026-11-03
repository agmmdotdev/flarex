import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { LINKS } from "@medusajs/framework/utils/portable";
import { LinkOperationResultSchema, LinkOperationStore } from "@medusajs/link-modules";
import { prepareCoreApiKeyAssociations } from "./support/core-api-key-association-fixture";
import { apiKeyFailureMessages } from "./support/core-api-key-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const decodeOperationResult = Schema.decodeUnknownSync(LinkOperationResultSchema);
const cleanup: Array<() => Promise<void>> = [];
let base: Awaited<ReturnType<typeof prepareCoreApiKeyAssociations>>;
const scenario = () => prepareCoreApiKeyAssociations(driver, close => cleanup.push(close), { physical: base.fixture.physical });
beforeAll(async () => { base = await prepareCoreApiKeyAssociations(driver, close => cleanup.push(close)); }, 240_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

describe("bounded native API Key Sales Channel associations", { concurrent: false }, () => {
  it("adds four channels, removes four and replays without duplicate events", async () => {
    const connected = await scenario(), selected = await connected.seed("Associations", false);
    const remove = [selected.channel, ...Array.from({ length: 3 }, (_, index) => `${selected.channel}-old-${index}`)];
    for (const channel of remove.slice(1)) await connected.attachNewChannel(selected.id, channel);
    const add = Array.from({ length: 4 }, (_, index) => `${selected.channel}-new-${index}`);
    for (const channel of add) await connected.createChannel(channel);
    const host = await connected.prepareAssociate(), key = host.newRequestKey();
    const defaultBudget = await connected.prepareDefaultAssociation(), beforeDefault = await connected.snapshot();
    const refusal = await Effect.runPromiseExit(defaultBudget.run(defaultBudget.newRequestKey(), { id: selected.id, add, remove }));
    expect(Exit.isFailure(refusal)).toBe(true);
    if (Exit.isFailure(refusal)) expect(refusal.cause.reasons.some(reason => Cause.isFailReason(reason) &&
      reason.error.reason === "limitExceeded")).toBe(true);
    expect(await connected.snapshot()).toEqual(beforeDefault);
    expect(await Effect.runPromise(host.run(key, { id: selected.id, add, remove }))).toBeNull();
    const rows = await connected.readLinks([selected.id]);
    expect(rows.filter(row => row.deleted_at === null).map(row => row.sales_channel_id).sort()).toEqual([...add].sort());
    const before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(key, { id: selected.id, add, remove }))).toBeNull();
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("preserves native missing-add validation and allows absent removals", async () => {
    const connected = await scenario(), selected = await connected.seed("Validation", false), host = await connected.prepareAssociate();
    const before = await connected.snapshot();
    const failure = await Effect.runPromiseExit(host.run(host.newRequestKey(), { id: selected.id, add: ["missing-channel"] }));
    expect(Exit.isFailure(failure)).toBe(true);
    if (Exit.isFailure(failure)) expect(apiKeyFailureMessages(failure.cause).join(" ")).toContain("missing-channel");
    expect(await connected.snapshot()).toEqual(before);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: selected.id, remove: ["missing-channel"] }))).toBeNull();
    expect((await connected.readLinks([selected.id])).filter(row => row.deleted_at === null)).toHaveLength(1);
  }, 240_000);

  it("preserves empty requests and native duplicate-create failure without a Key existence check", async () => {
    const connected = await scenario(), host = await connected.prepareAssociate(), channel = "orphan-native-channel";
    await connected.createChannel(channel);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: "unmaterialized-native-key" }))).toBeNull();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: "unmaterialized-native-key", add: [channel] }))).toBeNull();
    expect((await connected.readLinks(["unmaterialized-native-key"])).filter(row => row.deleted_at === null)).toHaveLength(1);
    const duplicate = channel + "-duplicate";
    await connected.createChannel(duplicate);
    const before = await connected.snapshot();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), {
      id: "unmaterialized-native-key", add: [duplicate, duplicate], remove: [channel],
    })))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("rolls back Link rows, heads, receipts and events after a late parent failure", async () => {
    const connected = await scenario(), selected = await connected.seed("Rollback", false), channel = selected.channel + "-late";
    await connected.createChannel(channel);
    const host = await connected.prepareLateAssociationFailure(), before = await connected.snapshot();
    const exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), { id: selected.id, add: [channel], remove: [selected.channel] }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(apiKeyFailureMessages(exit.cause)).toContain("Late parent failure after API Key association");
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("uses the genuine retained native inverse once and recognizes its durable terminal state", async () => {
    const connected = await scenario(), selected = await connected.seed("Inverse", false);
    const old = [selected.channel, ...Array.from({ length: 3 }, (_, index) => selected.channel + "-old-" + index)];
    for (const channel of old.slice(1)) await connected.attachNewChannel(selected.id, channel);
    const added = Array.from({ length: 4 }, (_, index) => selected.channel + "-inverse-" + index);
    for (const channel of added) await connected.createChannel(channel);
    const forward = await connected.prepareRetainedAssociation(), inverse = await connected.prepareRetainedAssociation(true);
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { id: selected.id, add: added, remove: old }));
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
    const rows = await connected.readLinks([selected.id]);
    expect(rows.filter(row => row.deleted_at === null).map(row => row.sales_channel_id).sort()).toEqual([...old].sort());
    const before = await connected.snapshot();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("refuses a superseded inverse and never revives a Link after guarded key deletion", async () => {
    const connected = await scenario(), selected = await connected.seed("Deletion fence", false);
    const forward = await connected.prepareRetainedAssociation(), inverse = await connected.prepareRetainedAssociation(true);
    // Deletion must fence even an already dismissed Link. There is no active
    // association whose separate fence could accidentally make this test pass.
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { id: selected.id, remove: [selected.channel] }));
    const revoke = await connected.prepareRevoke();
    await Effect.runPromise(revoke.run(revoke.newRequestKey(), { selector: { id: selected.id }, revoke: { revoked_by: "owner" } }));
    const deleted = await connected.prepareDelete();
    await Effect.runPromise(deleted.run(deleted.newRequestKey(), { ids: [selected.id] }));
    const before = await connected.snapshot(), exit = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), retained));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
    expect((await connected.readLinks([selected.id])).every(row => row.deleted_at !== null)).toBe(true);
  }, 240_000);

  it("refuses managed or oversized input before durable changes", async () => {
    const connected = await scenario(), host = await connected.prepareAssociate(), before = await connected.snapshot();
    for (const input of [{ id: "key", add: ["a", "b", "c", "d", "e"] }, { id: "key", operationId: "forged" }]) {
      expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), input)))).toBe(true);
      expect(await connected.snapshot()).toEqual(before);
    }
  }, 240_000);

  it("keeps a retained operation confined to its own shop", async () => {
    const first = await scenario(), second = await scenario(), selected = await first.seed("Scoped inverse", false);
    const channel = selected.channel + "-scoped";
    await first.createChannel(channel);
    const forward = await first.prepareRetainedAssociation(), foreignInverse = await second.prepareRetainedAssociation(true);
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { id: selected.id, add: [channel] }));
    const before = { links: await first.readLinks([selected.id]), keys: await first.read() };
    // The second scope records its own not-applied terminal state. It cannot
    // read or compensate the first scope's operation, even with the same ID.
    expect(await Effect.runPromise(foreignInverse.run(foreignInverse.newRequestKey(), retained))).toBeNull();
    expect({ links: await first.readLinks([selected.id]), keys: await first.read() }).toEqual(before);
    expect((await first.readLinks([selected.id])).filter(row => row.deleted_at === null)).toHaveLength(2);
  }, 240_000);

  it("recovers the same committed association receipt and heads after a lost acknowledgement", async () => {
    const connected = await scenario(), selected = await connected.seed("Association ACK", false), channel = selected.channel + "-ack";
    await connected.createChannel(channel);
    const host = await connected.prepareAssociate(), request = host.newRequestKey();
    const entry = vi.spyOn(LinkOperationStore.prototype, "withTransaction");
    try {
      const fault = connected.fixture.loseNextNativeRootAcknowledgement();
      expect(await Effect.runPromise(host.run(request, { id: selected.id, add: [channel] }))).toBeNull();
      expect(fault.armed).toBe(false); expect(fault.failures).toBe(1); expect(fault.evidence).toBeDefined();
      const entries = entry.mock.calls.length;
      expect(entries).toBeGreaterThan(0);
      const committed = await connected.snapshot(), recovered = await connected.prepareAssociate();
      expect(await Effect.runPromise(recovered.run(request, { id: selected.id, add: [channel] }))).toBeNull();
      expect(entry).toHaveBeenCalledTimes(entries);
      expect(await connected.snapshot()).toEqual(committed);
      expect((await connected.readLinks([selected.id])).filter(row => row.deleted_at === null)).toHaveLength(2);
    } finally { entry.mockRestore(); }
  }, 240_000);

  it("rejects a retained inverse after a genuine add/remove/add ABA transition", async () => {
    const connected = await scenario(), selected = await connected.seed("ABA", false), channel = selected.channel + "-aba";
    await connected.createChannel(channel);
    const forward = await connected.prepareRetainedAssociation(), inverse = await connected.prepareRetainedAssociation(true);
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { id: selected.id, add: [channel] }));
    const mutate = await connected.prepareAssociate();
    await Effect.runPromise(mutate.run(mutate.newRequestKey(), { id: selected.id, remove: [channel] }));
    await Effect.runPromise(mutate.run(mutate.newRequestKey(), { id: selected.id, add: [channel] }));
    expect((await connected.readLinks([selected.id])).some(row => row.sales_channel_id === channel && row.deleted_at === null)).toBe(true);
    const before = await connected.snapshot();
    expect(Exit.isFailure(await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), retained)))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("records cancellation before apply and refuses the delayed operation", async () => {
    const connected = await scenario(), selected = await connected.seed("Cancel before apply", false), channel = selected.channel + "-cancel";
    await connected.createChannel(channel);
    const request = { operationId: "native-protocol-cancel-before-apply", add: [{ primary: selected.id, foreign: channel }], remove: [] };
    const inverse = await connected.prepareProtocol(true), forward = await connected.prepareProtocol();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), {
      operationId: request.operationId, serviceName: LINKS.PublishableApiKeySalesChannel, request,
    }))).toMatchObject({ status: "notApplied", changedPairs: 0 });
    const cancelled = await connected.snapshot();
    const outcome = decodeOperationResult(await Effect.runPromise(forward.run(forward.newRequestKey(), request)));
    expect(outcome).toMatchObject({ state: "cancelled", replayed: true, changedPairs: 0 });
    const after = await connected.snapshot();
    expect(after.rows).toEqual(cancelled.rows); expect(after.revisions).toEqual(cancelled.revisions); expect(after.events).toEqual(cancelled.events);
    expect((await connected.readLinks([selected.id])).some(row => row.sales_channel_id === channel)).toBe(false);
  }, 240_000);

  it("refuses an operation ID replay with a changed ordered request", async () => {
    const connected = await scenario(), selected = await connected.seed("Changed request", false), first = selected.channel + "-first", second = selected.channel + "-second";
    await connected.createChannel(first); await connected.createChannel(second);
    const host = await connected.prepareProtocol(), request = { operationId: "native-protocol-ordered-request",
      add: [{ primary: selected.id, foreign: first }, { primary: selected.id, foreign: second }], remove: [] };
    await Effect.runPromise(host.run(host.newRequestKey(), request));
    const before = await connected.snapshot();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { ...request, add: [...request.add].reverse() })))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("serializes two native roots sharing an operation ID without duplicate Link work", async () => {
    const connected = await scenario(), selected = await connected.seed("Same operation", false), channel = selected.channel + "-concurrent";
    await connected.createChannel(channel);
    const left = await connected.prepareProtocol(), right = await connected.prepareProtocol();
    const request = { operationId: "native-protocol-concurrent-operation", add: [{ primary: selected.id, foreign: channel }], remove: [] };
    const outcomes = await Promise.all([
      Effect.runPromise(left.run(left.newRequestKey(), request)), Effect.runPromise(right.run(right.newRequestKey(), request)),
    ]);
    const decoded = outcomes.map(value => decodeOperationResult(value));
    expect(decoded.map(row => row.replayed).sort()).toEqual([false, true]);
    expect(decoded.every(row => row.state === "applied" && row.changedPairs === 1)).toBe(true);
    expect((await connected.readLinks([selected.id])).filter(row => row.sales_channel_id === channel && row.deleted_at === null)).toHaveLength(1);
    const rows = await connected.readRows();
    expect(rows.filter(row => row.id === request.operationId)).toHaveLength(1);
  }, 240_000);
});
