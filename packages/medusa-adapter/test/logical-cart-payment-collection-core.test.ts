import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PaymentModuleService } from "@medusajs/payment/services";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { prepareCartPaymentCollectionCreationWorkflow } from "../src/workflows/payment/collections";
import { prepareCoreCartPaymentCollections } from "./support/core-cart-payment-collection-fixture";
import type { CoreNativeWorkflowSnapshot } from "./support/core-native-workflow-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);
const array = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const cleanup: Array<() => Promise<void>> = [];
const cartInput = { cart_id: "cart-collections" };
const collectionCreated = "payment.payment-collection.created";
const collectionUpdated = "payment.payment-collection.updated";
const sessionDeleted = "payment.payment-session.deleted";

type Fixture = Awaited<ReturnType<typeof prepareCoreCartPaymentCollections>>;

function table(fixture: Fixture, name: string): string {
  const declaration = fixture.fixture.sources.flatMap(source => source.definition.tables)
    .find(candidate => candidate.localName === name);
  if (declaration === undefined) throw new Error("Missing native Cart PaymentCollection table " + name);
  return declaration.name;
}

function expectCommit(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot, key: string) {
  const outcome = after.outcomes.find(candidate => candidate.value.key === key);
  if (outcome === undefined) throw new Error("Missing committed native Cart PaymentCollection outcome");
  expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "committed" });
  expect(after.outcomes.filter(candidate => candidate !== outcome)).toEqual(before.outcomes);
  return outcome.timestamp;
}

function expectEvents(after: CoreNativeWorkflowSnapshot, timestamp: bigint,
  expected: ReadonlyArray<readonly [contract: string, id: string]>) {
  const events = after.events.filter(event => event.timestamp === timestamp);
  expect(events).toHaveLength(expected.length);
  for (const [contract, id] of expected) {
    expect(events).toContainEqual(expect.objectContaining({
      envelope: expect.objectContaining({ contract, internal: true, message: expect.objectContaining({ data: { id } }) }),
    }));
  }
}

const business = ({ outcomes: _outcomes, ...state }: CoreNativeWorkflowSnapshot) => state;

async function createSession(fixture: Fixture, collectionId: string) {
  const host = await fixture.prepareSession();
  return object(await Effect.runPromise(host.run(host.newRequestKey(), {
    payment_collection_id: collectionId, provider_id: "pp_system_default",
  })));
}

async function createCollection(fixture: Fixture, input = cartInput): Promise<string> {
  const host = await fixture.prepareCartCreation();
  return text(object(await Effect.runPromise(host.run(host.newRequestKey(), input))).id);
}

async function withIndependentFixture<A>(local: Fixture, run: (fixture: Fixture) => Promise<A>): Promise<A> {
  const closes: Array<() => Promise<void>> = [];
  try {
    return await run(await prepareCoreCartPaymentCollections(driver, close => closes.push(close), { physical: local.fixture.physical }));
  } finally {
    await finishOrderFixture(closes.reverse());
  }
}

function expectRefresh(fixture: Fixture, before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot,
  key: string, collectionId: string, sessionId: string, amount: string, currency: string) {
  const timestamp = expectCommit(before, after, key);
  const collectionTable = table(fixture, "payment_collection"), sessionTable = table(fixture, "payment_session");
  const collectionBefore = before.rows.find(row => row.table === collectionTable && row.value.id === collectionId);
  const sessionBefore = before.rows.find(row => row.table === sessionTable && row.value.id === sessionId);
  if (collectionBefore === undefined || sessionBefore === undefined) throw new Error("Missing refresh preimages");
  const revisions = after.revisions.filter(row => row.timestamp === timestamp);
  expect(revisions).toHaveLength(2);
  const collection = revisions.find(row => row.table === collectionTable), session = revisions.find(row => row.table === sessionTable);
  if (collection?.value == null || session === undefined) throw new Error("Missing collection update or session tombstone");
  expect(collection).toMatchObject({ previous: collectionBefore.timestamp, deleted: false });
  expect(collection.value).toEqual({ ...collectionBefore.value, amount, raw_amount: { value: amount, precision: 20 },
    currency_code: currency, updated_at: expect.any(String) });
  expect(session).toMatchObject({ previous: sessionBefore.timestamp, deleted: true, value: null });
  expect(after.rows.some(row => row.table === sessionTable && row.value.id === sessionId)).toBe(false);
  expect(after.indexes.some(index => index.table === sessionTable && index.id === session.id)).toBe(false);
  expect(after.indexes).toContainEqual(expect.objectContaining({ table: collectionTable, id: collection.id, name: "by_id",
    timestamp }));
  expect(after.families.length - before.families.length).toBe(1);
  expect(after.events.length - before.events.length).toBe(2);
  expectEvents(after, timestamp, [[collectionUpdated, collectionId], [sessionDeleted, sessionId]]);
}

describe("genuine native Cart PaymentCollection on Core", () => {
  let local: Fixture;
  beforeAll(async () => { local = await prepareCoreCartPaymentCollections(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); await local.closeWorkflowHosts(); }, 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("creates the real Link from stored totals, replays without a callback, and refuses a duplicate", async () => {
    const host = await local.prepareCartCreation(), key = host.newRequestKey(), before = await local.snapshot();
    const create = vi.spyOn(PaymentModuleService.prototype, "createPaymentCollections");
    const collection = object(await Effect.runPromise(host.run(key, cartInput))), id = text(collection.id);
    expect(collection).toMatchObject({ amount: 15, raw_amount: { value: "15.000000000000000000", precision: 20 }, currency_code: "usd",
      payment_sessions: [], payments: [] });
    const after = await local.snapshot(), timestamp = expectCommit(before, after, key);
    const collectionTable = table(local, "payment_collection"), linkTable = table(local, "cart_payment_collection");
    const link = after.rows.find(row => row.table === linkTable && row.value.cart_id === cartInput.cart_id);
    if (link === undefined) throw new Error("Missing native Cart PaymentCollection Link");
    expect(link).toMatchObject({ timestamp, value: { payment_collection_id: id, deleted_at: null } });
    expect(after.revisions.filter(row => row.timestamp === timestamp)).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: collectionTable, previous: null, deleted: false, value: expect.objectContaining({ id }) }),
      expect.objectContaining({ table: linkTable, previous: null, deleted: false, value: expect.objectContaining({ id: text(link.value.id) }) }),
    ]));
    expect(after.revisions.length - before.revisions.length).toBe(2);
    expect(after.families.length - before.families.length).toBe(1);
    expectEvents(after, timestamp, [[collectionCreated, id], ["LinkCartPaymentCollection.attached", text(link.value.id)]]);
    const reopened = await local.prepareCartCreation();
    expect(await Effect.runPromise(reopened.run(key, cartInput))).toEqual(collection);
    expect(await local.snapshot()).toEqual(after);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await Effect.runPromiseExit(reopened.run(reopened.newRequestKey(), cartInput))).toMatchObject({ _tag: "Failure" });
    expect(await local.snapshot()).toEqual(after);
    expect(create).toHaveBeenCalledTimes(1);
  }, 240_000);

  it("updates exact totals and currency through the native graph and only deletes selected System sessions", () => withIndependentFixture(local, async connected => {
    const collectionId = await createCollection(connected), first = await createSession(connected, collectionId), firstId = text(first.id);
    const otherCollectionId = await createCollection(connected, { cart_id: "cart-unlinked" });
    const otherSession = await createSession(connected, otherCollectionId);
    expect(first).toMatchObject({ amount: 15, currency_code: "usd", status: "pending" });
    await connected.setPrice("18.125");
    const host = await connected.prepareCartRefresh(), key = host.newRequestKey(), before = await connected.snapshot();
    const deletion = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment");
    expect(await Effect.runPromise(host.run(key, cartInput))).toBeNull();
    const refreshed = await connected.snapshot();
    expectRefresh(connected, before, refreshed, key, collectionId, firstId, "20.625000000000000000", "usd");
    expect(await connected.readCollection(collectionId)).toMatchObject([{ amount: 20.625, currency_code: "usd", payment_sessions: [] }]);
    expect(await Effect.runPromise(host.run(key, cartInput))).toBeNull();
    expect(await connected.snapshot()).toEqual(refreshed);
    expect(deletion).toHaveBeenCalledTimes(1);

    const replacement = await createSession(connected, collectionId), replacementId = text(replacement.id);
    const equalBefore = await connected.snapshot(), equalKey = host.newRequestKey();
    expect(await Effect.runPromise(host.run(equalKey, cartInput))).toBeNull();
    const equal = await connected.snapshot();
    expectCommit(equalBefore, equal, equalKey);
    expect(business(equal)).toEqual(business(equalBefore));
    expect(await connected.readCollection(collectionId)).toMatchObject([{ payment_sessions: [{ id: replacementId }] }]);
    expect(deletion).toHaveBeenCalledTimes(1);

    await connected.setCurrency("eur");
    const currencyBefore = await connected.snapshot(), currencyKey = host.newRequestKey();
    expect(await Effect.runPromise(host.run(currencyKey, cartInput))).toBeNull();
    expectRefresh(connected, currencyBefore, await connected.snapshot(), currencyKey, collectionId, replacementId, "20.625000000000000000", "eur");
    expect(await connected.readCollection(collectionId)).toMatchObject([{ amount: 20.625, currency_code: "eur", payment_sessions: [] }]);
    expect(await connected.readCollection(otherCollectionId)).toMatchObject([{ payment_sessions: [{ id: otherSession.id }] }]);
    expect(deletion).toHaveBeenCalledTimes(2);
    expect(connected.errors).toEqual([]);
  }), 240_000);

  it("refuses missing and completed Cart creation and leaves an unlinked Cart untouched on refresh", async () => {
    const create = await local.prepareCartCreation(), refresh = await local.prepareCartRefresh();
    const provider = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment"), before = await local.snapshot();
    for (const cart_id of ["cart-completed", "cart-missing"]) {
      expect(await Effect.runPromiseExit(create.run(create.newRequestKey(), { cart_id }))).toMatchObject({ _tag: "Failure" });
      expect(await local.snapshot()).toEqual(before);
    }
    const key = refresh.newRequestKey();
    expect(await Effect.runPromise(refresh.run(key, { cart_id: "cart-unlinked" }))).toBeNull();
    const after = await local.snapshot();
    expectCommit(before, after, key);
    expect(business(after)).toEqual(business(before));
    expect(provider).not.toHaveBeenCalled();
  }, 240_000);

  it("rolls back the collection, Link, indexes, events, and outcome after a late native parent failure", async () => {
    const host = await local.prepareCreationProbe("late"), before = await local.snapshot();
    const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { cart_id: "cart-unlinked" }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("Late parent failure");
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("executes the retained native collection create and update inverses without losing raw precision", async () => {
    const create = await local.prepareCreationProbe("forward");
    const creation = object(await Effect.runPromise(create.run(create.newRequestKey(), [{ amount: "9007199254740993", currency_code: "usd" }])));
    const [created] = array(creation.output), id = text(created?.id);
    const [before] = array(await local.readCollection(id));
    expect(before).toMatchObject({ amount: 9007199254740992, raw_amount: { value: "9007199254740993.0000", precision: 20 }, currency_code: "usd" });
    const forward = await local.prepareUpdateProbe("forward"), inverse = await local.prepareUpdateProbe("inverse");
    const result = object(await Effect.runPromise(forward.run(forward.newRequestKey(), {
      selector: { id }, update: { amount: { value: "9.875", precision: 20 }, currency_code: "eur" },
    })));
    expect(result.retained).toMatchObject([{ id, amount: 9007199254740992, raw_amount: before?.raw_amount, currency_code: "usd" }]);
    expect(await local.readCollection(id)).toMatchObject([{ amount: 9.875, currency_code: "eur" }]);
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.retained!))).toBeNull();
    expect(await local.readCollection(id)).toMatchObject([{ id, amount: 9007199254740992, raw_amount: before?.raw_amount, currency_code: "usd" }]);

    const remove = await local.prepareCreationProbe("inverse");
    expect(await Effect.runPromise(remove.run(remove.newRequestKey(), creation.retained!))).toBeNull();
    expect(await local.readCollection(id)).toEqual([]);
  }, 240_000);

  it("executes the native Link inverse and preserves repeated dismissal as a no-op", async () => {
    const create = await local.prepareCartCreation(), cart_id = "cart-unlinked";
    const created = object(await Effect.runPromise(create.run(create.newRequestKey(), { cart_id })));
    const payment_collection_id = text(created.id), input = [{ cart: { cart_id }, payment: { payment_collection_id } }];
    const inverse = await local.prepareLinkInverse(), before = await local.snapshot(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, input))).toBeNull();
    const after = await local.snapshot(), timestamp = expectCommit(before, after, key);
    const linkTable = table(local, "cart_payment_collection");
    const link = after.rows.find(row => row.table === linkTable && row.value.payment_collection_id === payment_collection_id);
    if (link === undefined) throw new Error("Missing retained soft-deleted Cart PaymentCollection Link");
    expect(link).toMatchObject({ timestamp, value: { cart_id, deleted_at: expect.any(String) } });
    expectEvents(after, timestamp, [["LinkCartPaymentCollection.detached", text(link.value.id)]]);
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), input))).toBeNull();
    expect(business(await local.snapshot())).toEqual(business(after));
    expect(await local.readCollection(payment_collection_id)).toHaveLength(1);
  }, 240_000);

  it("enforces the Cart adjustment constraint and refreshes from the valid adjustment", () => withIndependentFixture(local, async connected => {
    const collectionId = await createCollection(connected), before = await connected.snapshot();
    await expect(connected.insertAdjustment("-0.000000000000000001")).rejects.toBeDefined();
    expect(await connected.snapshot()).toEqual(before);
    await connected.insertAdjustment("0.125");
    const refresh = await connected.prepareCartRefresh();
    expect(await Effect.runPromise(refresh.run(refresh.newRequestKey(), cartInput))).toBeNull();
    expect(await connected.readCollection(collectionId)).toMatchObject([{ amount: 14.875, currency_code: "usd" }]);
  }), 240_000);

  it("rolls back the refresh when native session deletion reports a local provider failure", () => withIndependentFixture(local, async connected => {
    const collectionId = await createCollection(connected), session = await createSession(connected, collectionId);
    await connected.setPrice("23");
    const before = await connected.snapshot(), host = await connected.prepareCartRefresh(), key = host.newRequestKey();
    const failure = new Error("System provider failed deleting a Cart Payment Session");
    const provider = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment").mockRejectedValueOnce(failure);
    const result = await Effect.runPromiseExit(host.run(key, cartInput));
    if (Exit.isSuccess(result)) throw new Error("Native refresh ignored the failed provider deletion");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await connected.snapshot()).toEqual(before);
    expect(await connected.readCollection(collectionId)).toMatchObject([{ payment_sessions: [{ id: session.id }] }]);
    expect(result.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === failure), Cause.pretty(result.cause)).toBe(true);
    expect(connected.errors).toEqual([
      expect.stringContaining(`Encountered an error when trying to delete payment session - ${text(session.id)} - `),
    ]);
  }), 240_000);

  it("preserves the Session and existing Payment when the required native reference prevents refresh deletion", async () => {
    const closes: Array<() => Promise<void>> = [];
    try {
      const connected = await prepareCoreCartPaymentCollections(driver, close => closes.push(close), { physical: local.fixture.physical });
      const create = await connected.prepareCartCreation();
      const collection = object(await Effect.runPromise(create.run(create.newRequestKey(), cartInput))), collectionId = text(collection.id);
      const session = await createSession(connected, collectionId), sessionId = text(session.id);
      await connected.seedAuthorizedPayment(collectionId, sessionId);
      await connected.setPrice("24");
      const before = await connected.snapshot();
      expect(before.rows).toContainEqual(expect.objectContaining({ table: table(connected, "payment"),
        value: expect.objectContaining({ id: "pay-restrict-session", payment_session_id: sessionId, payment_collection_id: collectionId }) }));
      const provider = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment"), host = await connected.prepareCartRefresh();
      const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), cartInput));
      if (Exit.isSuccess(result)) throw new Error("Refresh deleted a Session referenced by an existing Payment");
      expect(result.cause.reasons.filter(Cause.isFailReason)).toContainEqual(expect.objectContaining({
        error: expect.objectContaining({ reason: "invalidInput", cause: expect.objectContaining({
          _tag: "CoreNativeForeignKeyError", reason: "deleteRestricted",
        }) }),
      }));
      expect(provider).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(before);
      expect(await connected.readCollection(collectionId)).toMatchObject([{ amount: 15,
        payment_sessions: [{ id: sessionId }], payments: [{ id: "pay-restrict-session" }] }]);
    } finally { await finishOrderFixture(closes.reverse()); }
  }, 240_000);

  it("settles one of two competing genuine Cart collection creations and replays the winner", async () => {
    const closes: Array<() => Promise<void>> = [];
    try {
      const connected = await prepareCoreCartPaymentCollections(driver, close => closes.push(close), { physical: local.fixture.physical });
      const firstReady = await Effect.runPromise(Deferred.make<void>()), secondReady = await Effect.runPromise(Deferred.make<void>()),
        release = await Effect.runPromise(Deferred.make<void>());
      const wait = (ready: typeof firstReady) => () => Effect.runPromise(Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(release))));
      const first = await connected.prepareCreationProbe("race", wait(firstReady));
      const second = await connected.prepareCreationProbe("race", wait(secondReady));
      const firstKey = first.newRequestKey(), secondKey = second.newRequestKey(), before = await connected.snapshot();
      const [firstResult, secondResult] = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const a = yield* first.run(firstKey, cartInput).pipe(Effect.exit, Effect.forkScoped);
        yield* Deferred.await(firstReady).pipe(Effect.timeout("15 seconds"));
        const b = yield* second.run(secondKey, cartInput).pipe(Effect.exit, Effect.forkScoped);
        yield* Deferred.await(secondReady).pipe(Effect.timeout("15 seconds"));
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(a), yield* Fiber.join(b)] as const;
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("45 seconds"))));
      expect([firstResult, secondResult].filter(Exit.isSuccess)).toHaveLength(1);
      const winner = Exit.isSuccess(firstResult) ? { host: first, key: firstKey, result: firstResult }
        : { host: second, key: secondKey, result: secondResult };
      const loser = Exit.isFailure(firstResult) ? firstResult : secondResult;
      if (Exit.isSuccess(loser) || Exit.isFailure(winner.result)) throw new Error("Expected one committed Cart creation");
      expect(loser.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "writeConflict")).toBe(true);
      const after = await connected.snapshot(), timestamp = expectCommit(before, after, winner.key);
      expect(after.rows.length - before.rows.length).toBe(2);
      expect(after.revisions.filter(row => row.timestamp === timestamp)).toHaveLength(2);
      expect(after.events.filter(event => event.timestamp === timestamp)).toHaveLength(2);
      expect(await Effect.runPromise(winner.host.run(winner.key, cartInput))).toEqual(winner.result.value);
      expect(await connected.snapshot()).toEqual(after);
    } finally { await finishOrderFixture(closes.reverse()); }
  }, 240_000);

  it("isolates equal native Cart and request IDs and rejects an incompatible Link before Payment runs", async () => {
    const closes: Array<() => Promise<void>> = [];
    try {
      const foreign = await prepareCoreCartPaymentCollections(driver, close => closes.push(close), { physical: local.fixture.physical });
      const localHost = await local.prepareCartCreation(), foreignHost = await foreign.prepareCartCreation(), key = localHost.newRequestKey();
      const input = { cart_id: "cart-unlinked" };
      expect(foreign.fixture.physical.namespace).toBe(local.fixture.physical.namespace);
      expect(foreign.fixture.physical.instanceName).not.toBe(local.fixture.physical.instanceName);
      const a = object(await Effect.runPromise(localHost.run(key, input))), b = object(await Effect.runPromise(foreignHost.run(key, input)));
      expect(a.id).not.toBe(b.id);
      expect(await local.readCollection(text(b.id))).toEqual([]);
      expect(await foreign.readCollection(text(a.id))).toEqual([]);
      const before = await local.snapshot(), foreignBefore = await foreign.snapshot();
      const payment = local.fixture.sources.find(source => source.definition.tables.some(candidate => candidate.localName === "payment_collection"));
      if (payment === undefined) throw new Error("Missing genuine Payment definition for incompatible binding");
      const incompatible = Result.getOrThrow(defineAtomicCommerceNativeSource("link", payment.definition));
      const create = vi.spyOn(PaymentModuleService.prototype, "createPaymentCollections");
      const failed = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
        const host = yield* Effect.acquireRelease(prepareCartPaymentCollectionCreationWorkflow({ ...foreign.options,
          modules: { ...foreign.cartModules, link: { ...foreign.cartModules.link, nativeStorage: incompatible } } }), host => host.close);
        return yield* host.run(host.newRequestKey(), cartInput);
      })));
      if (Exit.isSuccess(failed)) throw new Error("A Payment definition bound the Cart PaymentCollection Link");
      expect(failed.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidAuthority"),
        Cause.pretty(failed.cause)).toBe(true);
      expect(create).not.toHaveBeenCalled();
      expect(await local.snapshot()).toEqual(before);
      expect(await foreign.snapshot()).toEqual(foreignBefore);
    } finally { await finishOrderFixture(closes.reverse()); }
  }, 240_000);
});
