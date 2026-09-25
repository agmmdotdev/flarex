import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductSalesChannelLinkHost } from "./support/logical-product-sales-channel-link-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Link driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let link: Awaited<ReturnType<typeof prepareLogicalProductSalesChannelLinkHost>>;
const events = () => fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const pair = (product: string, channel: string, id?: string) => ({ product: { product_id: product },
  sales_channel: { sales_channel_id: channel }, ...(id === undefined ? {} : { data: { id } }) });

async function prepareLifecycleHost(selectedFixture = fixture, selectedLink = link) {
  const participant = defineAtomicCommerceParticipant("link");
  const create = defineAtomicCommerceCommand("nativeLinkCreate", (ctx, input) => ctx.call(participant, selectedLink.runtime.create, input));
  const reattach = defineAtomicCommerceCommand("nativeLinkReattach", ctx => Effect.gen(function* () {
    const first = yield* ctx.call(participant, selectedLink.runtime.create,
      pair("repeat-product", "repeat-channel", "prodsc_previous"));
    const second = yield* ctx.call(participant, selectedLink.runtime.create,
      pair("repeat-product", "repeat-channel", "prodsc_current"));
    return { first, second };
  }));
  const dismiss = defineAtomicCommerceCommand("nativeLinkDismiss", (ctx, input) => ctx.call(participant, selectedLink.runtime.dismiss, input));
  const remove = defineAtomicCommerceCommand("nativeLinkDelete", (ctx, input) => ctx.call(participant, selectedLink.runtime.delete, input));
  const restore = defineAtomicCommerceCommand("nativeLinkRestore", (ctx, input) => ctx.call(participant, selectedLink.runtime.restore, input));
  const restoreThenDismiss = defineAtomicCommerceCommand("nativeLinkRestoreThenDismiss", ctx => Effect.gen(function* () {
    yield* ctx.call(participant, selectedLink.runtime.restore, { product: { product_id: "snapshot-product" } });
    return yield* ctx.call(participant, selectedLink.runtime.dismiss, pair("snapshot-product", "snapshot-channel"));
  }));
  const restoreThenReattach = defineAtomicCommerceCommand("nativeLinkRestoreThenReattach", ctx => Effect.gen(function* () {
    yield* ctx.call(participant, selectedLink.runtime.restore, { product: { product_id: "replacement-product" } });
    return yield* ctx.call(participant, selectedLink.runtime.create,
      pair("replacement-product", "replacement-channel", "prodsc_new_snapshot"));
  }));
  const policy = selectedLink.runtime.logicalEventPolicy();
  const revision = "b".repeat(64);
  const attached = defineCommerceEventContract({ name: "LinkProductSalesChannel.attached", revision,
    internal: true, decode: policy.capture });
  const detached = defineCommerceEventContract({ name: "LinkProductSalesChannel.detached", revision,
    internal: true, decode: policy.capture });
  const select = (message: Json) => isJsonObject(message) && message.name === "LinkProductSalesChannel.attached"
    ? Effect.succeed(attached) : isJsonObject(message) && message.name === "LinkProductSalesChannel.detached"
      ? Effect.succeed(detached) : Effect.fail(commerceError("unadmittedEvent"));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-sales-channel-link-lifecycle" },
    participants: [{ participant, logicalStorage: selectedLink.hostInput.logicalStorage,
      commands: [selectedLink.runtime.create, selectedLink.runtime.dismiss, selectedLink.runtime.delete, selectedLink.runtime.restore],
      validateLogicalCall: policy.validateLogicalCall, events: { contracts: [attached, detached], select } }],
    commands: [create, reattach, dismiss, remove, restore, restoreThenDismiss, restoreThenReattach],
    events: { producerRevision: revision, contracts: [attached, detached],
      subscribers: [{ id: "logical-product-sales-channel-link-lifecycle", revision: "c".repeat(64) }],
      validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, create, reattach, dismiss, remove, restore, restoreThenDismiss, restoreThenReattach };
}

describe("native Product–SalesChannel Link on shared logical storage", () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includeSalesChannel: true, includeProductSalesChannelLink: true,
    });
    link = await prepareLogicalProductSalesChannelLinkHost(fixture);
    await Effect.runPromise(link.host.initialize([]));
    await Effect.runPromise(link.host.close);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("rejects an unattested native Link event", async () => {
    const policy = link.runtime.logicalEventPolicy();
    const result = await Effect.runPromise(Effect.result(policy.validateLogicalCall({
      commandName: "linkCreate", mode: "write", input: [], result: [], events: [], fromAttempt: 0, toAttempt: 1,
      fromLifecycle: 0, toLifecycle: 0,
    }, { mutations: [{ ordinal: 0, table: "product_sales_channel", operation: "insert", before: null,
      after: { id: "prodsc_orphan", product_id: "p", sales_channel_id: "s", deleted_at: null } }], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("reattaches an active pair with a new ID, dismisses and restores it", async () => {
    const { host, create, dismiss, restore } = await prepareLifecycleHost();
    try {
      const original = pair("p1", "s1", "prodsc_original");
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, create, original)))
        .toMatchObject([{ id: "prodsc_original", product_id: "p1", sales_channel_id: "s1" }]);
      const firstRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      expect(await Effect.runPromise(host.run(key, create, original)))
        .toMatchObject([{ id: "prodsc_original" }]);
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(firstRows);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), create, pair("p1", "s1", "prodsc_replaced"))))
        .toMatchObject([{ id: "prodsc_replaced" }]);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), dismiss, pair("p1", "s1"))))
        .toMatchObject([{ id: "prodsc_replaced" }]);
      const reader = await Effect.runPromise(makeCommerceHost(link.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(link.runtime.count, { filters: { product_id: "p1" },
          config: { select: ["id"], take: 1 } }))).toEqual([[], 0]);
      } finally { await Effect.runPromise(reader.close); }
      await Effect.runPromise(host.run(host.newRequestKey(), restore, { sales_channel: { sales_channel_id: "s1" } }));
      expect((await events()).map(event => event.envelope.contract)).toEqual([
        "LinkProductSalesChannel.attached", "LinkProductSalesChannel.attached",
        "LinkProductSalesChannel.detached", "LinkProductSalesChannel.attached",
      ]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("authenticates both native event IDs when one root reattaches the same pair", async () => {
    const { host, reattach } = await prepareLifecycleHost();
    try {
      const before = await events();
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, reattach, null));
      expect(result).toMatchObject({ first: [{ id: "prodsc_previous" }], second: [{ id: "prodsc_current" }] });
      const emitted = (await events()).slice(before.length).map(event => event.envelope.message);
      expect(emitted)
        .toMatchObject([{ data: { id: "prodsc_previous" } }, { data: { id: "prodsc_current" } }]);
      const policy = link.runtime.logicalEventPolicy();
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ commandName: "linkCreate", mode: "write", input: null, result: null, events: [emitted[1]!], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 }, { mutations: [{ ordinal: 0, table: "product_sales_channel", operation: "insert", before: null,
          after: { id: "prodsc_previous", product_id: "repeat-product", sales_channel_id: "repeat-channel", deleted_at: null } }], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] })))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      const reader = await Effect.runPromise(makeCommerceHost(link.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(link.runtime.count, { filters: { product_id: "repeat-product" },
          config: { select: ["id"], take: 1 } }))).toMatchObject([[{ id: "prodsc_current" }], 1]);
      } finally { await Effect.runPromise(reader.close); }
      expect(await Effect.runPromise(host.run(key, reattach, null))).toEqual(result);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("authenticates an unchanged restore from its operation-time row before a later Link call", async () => {
    const { host, create, restoreThenDismiss, restoreThenReattach } = await prepareLifecycleHost();
    try {
      await Effect.runPromise(host.run(host.newRequestKey(), create,
        pair("snapshot-product", "snapshot-channel", "prodsc_before_dismiss")));
      await Effect.runPromise(host.run(host.newRequestKey(), create,
        pair("replacement-product", "replacement-channel", "prodsc_before_replacement")));
      const before = await events();
      await Effect.runPromise(host.run(host.newRequestKey(), restoreThenDismiss, null));
      expect((await events()).slice(before.length).map(event => event.envelope.contract))
        .toEqual(["LinkProductSalesChannel.attached", "LinkProductSalesChannel.detached"]);
      const beforeReplacement = await events();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), restoreThenReattach, null)))
        .toMatchObject([{ id: "prodsc_new_snapshot" }]);
      expect((await events()).slice(beforeReplacement.length).map(event => event.envelope.message))
        .toMatchObject([{ data: { id: "prodsc_before_replacement" } },
          { data: { id: "prodsc_new_snapshot" } }]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("keeps duplicate endpoint attempts and invalid input atomic", async () => {
    const { host, create } = await prepareLifecycleHost();
    try {
      const rows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const before = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), create, [pair("duplicate", "s"), pair("duplicate", "s")]))).rejects.toBeDefined();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), create, [{ product: { product_id: 42 },
        sales_channel: { sales_channel_id: "s" } }]))).rejects.toBeDefined();
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(rows);
      expect(await events()).toEqual(before);
    } finally { await Effect.runPromise(host.close); }
  });

  it("deletes a selected endpoint, preserves repeated no-ops and reads native definitions", async () => {
    const { host, create, remove, restore } = await prepareLifecycleHost();
    try {
      const target = pair("endpoint-product", "endpoint-channel", "prodsc_endpoint");
      await Effect.runPromise(host.run(host.newRequestKey(), create, target));
      const reader = await Effect.runPromise(makeCommerceHost(link.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(link.runtime.links, pair("endpoint-product", "endpoint-channel"))))
          .toEqual([pair("endpoint-product", "endpoint-channel")]);
      } finally { await Effect.runPromise(reader.close); }
      const endpoint = { product: { product_id: "endpoint-product" } };
      await Effect.runPromise(host.run(host.newRequestKey(), remove, endpoint));
      const afterDelete = await events();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), remove, endpoint))).toEqual({});
      expect((await events()).length).toBe(afterDelete.length);
      await Effect.runPromise(host.run(host.newRequestKey(), restore, endpoint));
      expect((await events()).slice(afterDelete.length).map(event => event.envelope.contract))
        .toEqual(["LinkProductSalesChannel.attached"]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("keeps colliding endpoint pairs isolated for two shops on the same physical row family", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, fixtureIdentity: { deploymentId: "deployment_product_channel_link_shop_b",
        projectId: "project_product_channel_link_shop_b", uuidOffset: 6_000 },
      includeProduct: true, includeSalesChannel: true, includeProductSalesChannelLink: true,
    });
    const otherLink = await prepareLogicalProductSalesChannelLinkHost(other);
    await Effect.runPromise(otherLink.host.initialize([]));
    await Effect.runPromise(otherLink.host.close);
    const first = await prepareLifecycleHost();
    const second = await prepareLifecycleHost(other, otherLink);
    try {
      const same = pair("shared-product", "shared-channel", "prodsc_shared");
      const firstScope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
      const secondScope = projectScopeIdUuidV1(other.application.authority.scopeId).scopeUuid;
      expect(firstScope).not.toBe(secondScope);
      await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.create, same));
      const firstRows = (await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === firstScope);
      const secondRowsBefore = (await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope);
      await Effect.runPromise(second.host.run(second.host.newRequestKey(), second.create, same));
      expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === firstScope)).toEqual(firstRows);
      expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope)).toHaveLength(secondRowsBefore.length + 1);
      expect((await fixture.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(fixture.physicalTablesBeforeCandidate);
    } finally { await Effect.runPromise(first.host.close); await Effect.runPromise(second.host.close); }
  }, 150_000);
});
