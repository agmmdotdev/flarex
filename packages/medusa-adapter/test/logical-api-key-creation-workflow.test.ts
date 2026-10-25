import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Exit, Schema } from "effect";
import { apiKeyFailureMessages, prepareLogicalApiKeys } from "./support/logical-api-key-fixture";
import { prepareApiKeyCreationWorkflow } from "../src/workflows/api-key/create";
import type { ApiKeyCreationInput } from "../src/modules/api-key/contracts";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let base: Awaited<ReturnType<typeof prepareLogicalApiKeys>>, ordinal = 0;
const scenario = () => prepareLogicalApiKeys(driver, close => cleanup.push(close), {
  resource: base.fixture.resource,
  fixtureIdentity: { deploymentId: `api-key-creation-${++ordinal}`, projectId: "api-key-creation-tests", uuidOffset: 8_700_000 + ordinal * 10_000 },
});
const input = (title: string): typeof ApiKeyCreationInput.Type => ({ api_keys: [{ type: "publishable", title, created_by: "native-owner" }] });
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeJson = Schema.decodeUnknownSync(Schema.Json);

beforeAll(async () => { base = await prepareLogicalApiKeys(driver, close => cleanup.push(close)); }, 240_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

describe("bounded native publishable API Key creation", { concurrent: false }, () => {
  it("returns complete public rows with genuine tokens and persists the native salt separately", async () => {
    const connected = await scenario(), host = await connected.prepareCreate();
    const rows = decodeRows(await Effect.runPromise(host.run(host.newRequestKey(), input("Storefront"))));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: expect.stringMatching(/^apk_/), token: expect.stringMatching(/^pk_[0-9a-f]{64}$/),
      title: "Storefront", type: "publishable", created_by: "native-owner", revoked_by: null, revoked_at: null, last_used_at: null });
    expect(Object.hasOwn(rows[0] ?? {}, "salt")).toBe(false);
    expect(Object.hasOwn(rows[0] ?? {}, "_id")).toBe(false);
    const stored = await connected.read();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({ ...rows[0], salt: "" });
    expect(connected.apiKey.commands).toHaveLength(1);
    expect(Object.keys(connected.apiKey)).not.toContain("revertCreation");
  }, 240_000);

  it("creates the four-key cohort in native input order under default limits", async () => {
    const connected = await scenario(), host = await connected.prepareCreate();
    const rows = decodeRows(await Effect.runPromise(host.run(host.newRequestKey(), {
      api_keys: Array.from({ length: 4 }, (_, index) => ({ type: "publishable", title: `store-${index}`, created_by: index % 2 ? "" : "owner" })),
    })));
    expect(rows.map(row => row.title)).toEqual(["store-0", "store-1", "store-2", "store-3"]);
    expect(new Set(rows.map(row => row.id)).size).toBe(4);
    expect(new Set(rows.map(row => row.token)).size).toBe(4);
    expect(await connected.read()).toHaveLength(4);
  }, 240_000);

  it("preserves empty native creation without data or event publication", async () => {
    const connected = await scenario(), host = await connected.prepareCreate(), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { api_keys: [] }))).toEqual([]);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("replays the committed outcome without generating another token or row", async () => {
    const connected = await scenario(), host = await connected.prepareCreate(), key = host.newRequestKey();
    const first = await Effect.runPromise(host.run(key, input("Replay"))), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(key, input("Replay")))).toEqual(first);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("executes the genuine retained inverse in a later root and preserves an unrelated key", async () => {
    const connected = await scenario(), create = await connected.prepareCreate();
    const kept = decodeRows(await Effect.runPromise(create.run(create.newRequestKey(), input("Keep"))));
    const retained = await connected.prepareRetainedCreation();
    const response = decodeObject(await Effect.runPromise(retained.run(retained.newRequestKey(), input("Undo"))));
    expect(decodeRows(response.output)).toHaveLength(1);
    const inverse = await connected.prepareRetainedCreation(true);
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), decodeJson(response.retained)))).toBeNull();
    expect(await connected.read()).toEqual([{ ...kept[0], salt: "" }]);
    const before = await connected.snapshot();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), decodeJson(response.retained)))).toBeNull();
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("rolls back native creation and publication after an actual late parent failure", async () => {
    const connected = await scenario(), host = await connected.prepareLateFailure(), before = await connected.snapshot();
    const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), input("Rollback")));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(apiKeyFailureMessages(result.cause)).toContain("Late parent failure after native API Key creation");
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("refuses secret, oversized and managed-field inputs before any mutation", async () => {
    const connected = await scenario(), host = await connected.prepareCreate(), before = await connected.snapshot();
    for (const value of [
      { api_keys: [{ type: "secret", title: "Secret", created_by: "owner" }] },
      { api_keys: Array.from({ length: 5 }, () => ({ type: "publishable", title: "Too many", created_by: "owner" })) },
      { api_keys: [{ type: "publishable", title: "Injected", created_by: "owner", token: "pk_injected" }] },
    ]) {
      // @ts-expect-error Deliberately exercise untyped callers outside the public input contract.
      expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), value)))).toBe(true);
    }
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("keeps separately admitted shop scopes independent", async () => {
    const first = await scenario(), second = await scenario(), create = await first.prepareCreate();
    await Effect.runPromise(create.run(create.newRequestKey(), input("First shop")));
    expect(await first.read()).toHaveLength(1);
    expect(await second.read()).toEqual([]);
  }, 240_000);

  it("confines the privileged inverse to the fixed native graph", async () => {
    const connected = await scenario(), before = await connected.snapshot();
    const hooks = { ...connected.options, hooks: {} };
    const graph = { ...connected.options, workflow: { name: "arbitrary-inverse" } };
    for (const options of [hooks, graph])
      expect(Exit.isFailure(await Effect.runPromiseExit(prepareApiKeyCreationWorkflow(options)))).toBe(true);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);
});
