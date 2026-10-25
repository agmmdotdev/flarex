import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Exit, Result, Schema } from "effect";
import { revokeApiKeysWorkflow } from "@medusajs/core-flows/api-key/revoke-api-keys";
import { apiKeyFailureMessages, prepareLogicalApiKeys } from "./support/logical-api-key-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let base: Awaited<ReturnType<typeof prepareLogicalApiKeys>>, ordinal = 0;
const scenario = () => prepareLogicalApiKeys(driver, close => cleanup.push(close), { resource: base.fixture.resource,
  fixtureIdentity: { deploymentId: `api-key-lifecycle-${++ordinal}`, projectId: "api-key-lifecycle-tests", uuidOffset: 9_100_000 + ordinal * 10_000 } });
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeJson = Schema.decodeUnknownSync(Schema.Json);
const decodeIds = Schema.decodeUnknownSync(Schema.Array(Schema.String));
async function seed(connected: Awaited<ReturnType<typeof scenario>>, count = 1) {
  const host = await connected.prepareCreate();
  return decodeRows(await Effect.runPromise(host.run(host.newRequestKey(), { api_keys: Array.from({ length: count }, (_, index) =>
    ({ type: "publishable", title: `title-${index}`, created_by: "owner" })) })));
}

beforeAll(async () => { base = await prepareLogicalApiKeys(driver, close => cleanup.push(close)); }, 240_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

describe("bounded native publishable API Key lifecycle", { concurrent: false }, () => {
  it("updates four selected titles in native identity order and preserves credential fields", async () => {
    const connected = await scenario(), rows = await seed(connected, 4), host = await connected.prepareUpdate();
    expect(Object.keys(connected.lifecycle.workflow.methods)).not.toContain("revertCreatedApiKeys");
    expect(Object.keys(connected.lifecycle)).not.toContain("restoreTitles");
    const ids = [...decodeIds(rows.map(row => row.id))].reverse();
    const output = decodeRows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: ids }, update: { title: "Renamed" } })));
    expect(output.map(row => row.id)).toEqual(ids);
    for (const row of output) {
      const prior = rows.find(prior => prior.id === row.id);
      expect(row).toEqual({ ...prior, title: "Renamed", updated_at: expect.any(String) });
      expect(Object.hasOwn(row, "salt")).toBe(false);
    }
    expect((await connected.read()).every(row => row.title === "Renamed" && row.salt === "")).toBe(true);
  }, 240_000);

  it("runs the genuine retained update inverse in a later root without changing an unrelated key", async () => {
    const connected = await scenario(), original = await seed(connected, 2), forward = await connected.prepareRetainedUpdate();
    const id = Schema.decodeUnknownSync(Schema.String)(original[0]?.id);
    const response = decodeObject(await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { id }, update: { title: "Temporary" } })));
    expect(decodeRows(response.output)[0]?.title).toBe("Temporary");
    const inverse = await connected.prepareRetainedUpdate(true);
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), decodeJson(response.retained)))).toBeNull();
    const stored = await connected.read();
    expect(stored.find(row => row.id === id)?.title).toBe(original[0]?.title);
    expect(stored.find(row => row.id === original[1]?.id)).toEqual({ ...original[1], salt: "" });
    const before = await connected.snapshot();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), decodeJson(response.retained)));
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.revisions).toEqual(before.revisions);
  }, 240_000);

  it("preserves empty, missing, unchanged and empty-data updates without writes", async () => {
    const connected = await scenario(), original = await seed(connected), host = await connected.prepareUpdate();
    const id = Schema.decodeUnknownSync(Schema.String)(original[0]?.id), before = await connected.snapshot();
    for (const input of [{ selector: { id: [] }, update: { title: "Missing" } },
      { selector: { id: "apk_missing" }, update: { title: "Missing" } }])
      expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual([]);
    for (const update of [{}, { title: "title-0" }])
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update }))).toEqual(original);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.revisions).toEqual(before.revisions);
  }, 240_000);

  it("revokes publishable keys through the native secret-validation query and replays the same outcome", async () => {
    const connected = await scenario(), original = await seed(connected), host = await connected.prepareRevoke();
    const id = Schema.decodeUnknownSync(Schema.String)(original[0]?.id), key = host.newRequestKey();
    const input = { selector: { id }, revoke: { revoked_by: "revoker" } };
    const output = decodeRows(await Effect.runPromise(host.run(key, input)));
    expect(output).toEqual([{ ...original[0], revoked_by: "revoker", revoked_at: expect.any(String), updated_at: expect.any(String) }]);
    expect((await connected.read())[0]).toEqual({ ...output[0], salt: "" });
    const before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.revisions).toEqual(before.revisions);
    const native = Result.getOrThrow(revokeApiKeysWorkflow.prepare()).nodes.find(node => node.name === "revoke-api-keys");
    expect(native?.kind === "step" ? native.compensate : "wrong-node").toBeUndefined();
  }, 240_000);

  it("preserves native scheduled revocation and whole-root rollback after a late failure", async () => {
    const connected = await scenario(), original = await seed(connected), id = Schema.decodeUnknownSync(Schema.String)(original[0]?.id);
    const failed = await connected.prepareLateRevokeFailure(), before = await connected.snapshot();
    const outcome = await Effect.runPromiseExit(failed.run(failed.newRequestKey(), { selector: { id }, revoke: { revoked_by: "failed" } }));
    expect(Exit.isFailure(outcome)).toBe(true);
    if (Exit.isFailure(outcome)) expect(apiKeyFailureMessages(outcome.cause)).toContain("Late parent failure after native API Key revocation");
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.revisions).toEqual(before.revisions);
    const host = await connected.prepareRevoke(), started = Date.now();
    const output = decodeRows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, revoke: { revoked_by: "scheduled", revoke_in: 60 } })));
    expect(Date.parse(String(output[0]?.revoked_at))).toBeGreaterThanOrEqual(started + 60_000);
  }, 240_000);

  it("refuses managed fields, secret-bearing changes and oversized lifecycle cohorts before mutation", async () => {
    const connected = await scenario(), original = await seed(connected), host = await connected.prepareUpdate();
    const id = Schema.decodeUnknownSync(Schema.String)(original[0]?.id), before = await connected.snapshot();
    for (const update of [{ id: "apk_injected" }, { token: "pk_injected" }, { salt: "injected" }, { type: "secret" }, { revoked_by: "injected" }]) {
      // @ts-expect-error Deliberately exercise an untyped caller outside title-only updates.
      expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { selector: { id }, update })))).toBe(true);
    }
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { selector: { id: Array.from({ length: 5 }, () => id) }, update: { title: "Too many" } })))).toBe(true);
    const revoke = await connected.prepareRevoke();
    expect(Exit.isFailure(await Effect.runPromiseExit(revoke.run(revoke.newRequestKey(), { selector: { id }, revoke: { revoked_by: "" } })))).toBe(true);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.revisions).toEqual(before.revisions);
  }, 240_000);
});
