import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { prepareLogicalApiKeyAssociations } from "./support/logical-api-key-association-fixture";
import { apiKeyFailureMessages } from "./support/logical-api-key-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let base: Awaited<ReturnType<typeof prepareLogicalApiKeyAssociations>>, ordinal = 0;
const scenario = () => prepareLogicalApiKeyAssociations(driver, close => cleanup.push(close), { resource: base.fixture.resource,
  fixtureIdentity: { deploymentId: `api-key-association-${++ordinal}`, projectId: "api-key-association-tests", uuidOffset: 10_500_000 + ordinal * 10_000 } });
beforeAll(async () => { base = await prepareLogicalApiKeyAssociations(driver, close => cleanup.push(close)); }, 240_000);
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
});
