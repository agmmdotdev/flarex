import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceDecoder } from "../src/value/decoder";
import { prepareCoreSalesChannel } from "./support/core-sales-channel-fixture";
import { expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const ids = Array.from({ length: 129 }, (_, index) => "atomic-sales-admission-" + index.toString().padStart(3, "0"));
const decodeUpdateThenGuard = commerceDecoder(Schema.Struct({ id: Schema.String, count: Schema.JsonObject }), "invalidInput");
let connected: Awaited<ReturnType<typeof prepareCoreSalesChannel>>;
let implicit: Awaited<ReturnType<typeof prepareNativeAdmissionHost>>;
let explicit: Awaited<ReturnType<typeof prepareNativeAdmissionHost>>;

const countInput = (selected: readonly string[]): Json => ({ filters: { id: [...selected] },
  config: { select: ["id"], take: 1, order: { id: "ASC" } } });
const eventName = (action: "created" | "updated") => buildModuleResourceEventName({
  prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action,
});

/** The native creation workflow has no count guard. This uses the supported
 * atomic Sales create/update/count composition and the real service/DAL path. */
async function prepareNativeAdmissionHost(explicitResources: boolean) {
  const { fixture, sales } = connected;
  const participant = defineAtomicCommerceParticipant("salesChannel");
  const caught: Cause.Cause<CommerceTransactionError>[] = [];
  const observedUpdates: Array<Readonly<{ mutations: number; events: number }>> = [];
  const create = defineAtomicCommerceCommand("admissionCreateSalesChannels", (ctx, input) =>
    ctx.call(participant, sales.runtime.create, input));
  const count = defineAtomicCommerceCommand("admissionCountSalesChannels", (ctx, input) =>
    ctx.call(participant, sales.runtime.count, input));
  const countTwice = defineAtomicCommerceCommand("admissionCountSalesChannelsTwice", (ctx, input) => Effect.gen(function* () {
    const first = yield* ctx.call(participant, sales.runtime.count, input);
    const second = yield* ctx.call(participant, sales.runtime.count, input);
    return { first, second };
  }));
  const updateThenGuard = defineAtomicCommerceCommand("admissionUpdateThenCountSalesChannels", (ctx, args) => Effect.gen(function* () {
    const input = yield* Effect.fromResult(decodeUpdateThenGuard(args));
    yield* ctx.call(participant, sales.runtime.update, { id: input.id, data: { name: "Pending admission update" } });
    return yield* ctx.call(participant, sales.runtime.count, input.count).pipe(Effect.catchCause(cause =>
      Effect.sync(() => { caught.push(cause); return null; })));
  }));
  const policy = sales.runtime.logicalEventPolicy();
  const revision = "3".repeat(64);
  const created = defineCommerceEventContract({ name: eventName("created"), revision, internal: true, decode: policy.capture });
  const updated = defineCommerceEventContract({ name: eventName("updated"), revision, internal: true, decode: policy.capture });
  const contracts = [created, updated];
  const host = await Effect.runPromise(fixture.execution.prepare({
    identityAndAccessPolicy: { profile: "native-sales-atomic-admission" },
    participants: [{ participant, nativeStorage: sales.source,
      ...(explicitResources ? { logicalResources: defaultCommerceResources } : {}),
      commands: [sales.runtime.create, sales.runtime.update, sales.runtime.count],
      validateLogicalCall: (call, activity, command) => policy.validateLogicalCall(call, activity).pipe(
        Effect.andThen(() => Effect.sync(() => {
          if (command === sales.runtime.update) observedUpdates.push({ mutations: activity.mutations.length, events: call.events.length });
        }))),
      events: { contracts, select: message => {
        const selected = !isJsonObject(message) ? undefined : message.name === eventName("created") ? created
          : message.name === eventName("updated") ? updated : undefined;
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selected);
      } } }],
    commands: [create, count, countTwice, updateThenGuard],
    events: { producerRevision: revision, contracts, subscribers: [{ id: "native-sales-admission", revision: "4".repeat(64) }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  cleanup.push(() => Effect.runPromise(host.close));
  return { host, create, count, countTwice, updateThenGuard, caught, observedUpdates };
}

describe("native Sales atomic implicit and explicit identity admission", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareCoreSalesChannel(driver, close => cleanup.push(close));
    implicit = await prepareNativeAdmissionHost(false);
    explicit = await prepareNativeAdmissionHost(true);
    // Seeding is separately admitted with the existing explicit default profile.
    // Every seed still invokes the genuine native create service and events.
    for (let start = 0; start < ids.length; start += 32)
      await Effect.runPromise(explicit.host.run(explicit.host.newRequestKey(), explicit.create,
        ids.slice(start, start + 32).map(id => ({ id, name: id }))));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("admits 128 native count identities and does not charge repeated originals twice", async () => {
    const before = await connected.fixture.snapshot();
    const result = await Effect.runPromise(implicit.host.run(implicit.host.newRequestKey(), implicit.countTwice, countInput(ids.slice(0, 128))));
    const expected: Json = [[{ id: ids[0]! }], 128];
    expect(result).toEqual({ first: expected, second: expected });
    const after = await connected.fixture.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions);
    expect(after.indexes).toEqual(before.indexes); expect(after.events).toEqual(before.events);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
  }, 120_000);

  it("refuses 129 native count identities despite a one-row result page", async () => {
    const before = await connected.fixture.snapshot();
    const result = await Effect.runPromiseExit(implicit.host.run(implicit.host.newRequestKey(), implicit.count, countInput(ids)));
    expectWorkflowTypedFailures(result, "limitExceeded");
    expect(await connected.fixture.snapshot()).toEqual(before);
  }, 120_000);

  it("admits the same 129 identities through explicitly selected default resources", async () => {
    const before = await connected.fixture.snapshot();
    expect(await Effect.runPromise(explicit.host.run(explicit.host.newRequestKey(), explicit.count, countInput(ids))))
      .toEqual([[{ id: ids[0] }], 129]);
    const after = await connected.fixture.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions);
    expect(after.indexes).toEqual(before.indexes); expect(after.events).toEqual(before.events);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
  }, 120_000);

  it("retains a caught count refusal and rolls back a genuine native update and its event", async () => {
    const before = await connected.fixture.snapshot();
    const result = await Effect.runPromiseExit(implicit.host.run(implicit.host.newRequestKey(), implicit.updateThenGuard,
      { id: ids[0]!, count: countInput(ids) }));
    const failures = expectWorkflowTypedFailures(result, "limitExceeded");
    expect(failures.map(failure => failure.reason)).toContain("rollbackOnly");
    expect(implicit.observedUpdates).toEqual([{ mutations: 1, events: 1 }]);
    expect(implicit.caught).toHaveLength(1);
    const [caught] = implicit.caught;
    if (caught === undefined) throw new Error("Missing original caught native count Cause");
    const originalFailures = expectWorkflowTypedFailures(Exit.failCause(caught), "limitExceeded");
    for (const failure of originalFailures) expect(failures).toContain(failure);
    expect(await connected.fixture.snapshot()).toEqual(before);
  }, 120_000);
});
