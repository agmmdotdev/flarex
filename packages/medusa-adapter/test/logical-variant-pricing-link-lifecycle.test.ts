import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalVariantPricingLinkHost } from "./support/logical-variant-pricing-link-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Link lifecycle test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let link: Awaited<ReturnType<typeof prepareLogicalVariantPricingLinkHost>>;
const events = () => fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const pair = (variant: string, set: string, id?: string) => ({ product: { variant_id: variant },
  pricing: { price_set_id: set }, ...(id === undefined ? {} : { data: { id } }) });

async function prepareLifecycleHost(selectedFixture = fixture, selectedLink = link) {
  const participant = defineAtomicCommerceParticipant("link");
  const create = defineAtomicCommerceCommand("nativeLinkCreate", (ctx, input) => ctx.call(participant, selectedLink.runtime.create, input));
  const dismiss = defineAtomicCommerceCommand("nativeLinkDismiss", (ctx, input) => ctx.call(participant, selectedLink.runtime.dismiss, input));
  const restore = defineAtomicCommerceCommand("nativeLinkRestore", (ctx, input) => ctx.call(participant, selectedLink.runtime.restore, input));
  const policy = selectedLink.runtime.logicalEventPolicy();
  const revision = "e".repeat(64);
  const attached = defineCommerceEventContract({ name: "LinkProductVariantPriceSet.attached", revision,
    internal: true, decode: policy.capture });
  const detached = defineCommerceEventContract({ name: "LinkProductVariantPriceSet.detached", revision,
    internal: true, decode: policy.capture });
  const select = (message: Json) => isJsonObject(message) && message.name === "LinkProductVariantPriceSet.attached"
    ? Effect.succeed(attached) : isJsonObject(message) && message.name === "LinkProductVariantPriceSet.detached"
      ? Effect.succeed(detached) : Effect.fail(commerceError("unadmittedEvent"));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
    identityAndAccessPolicy: { profile: "logical-variant-pricing-link-lifecycle" },
    participants: [{ participant, logicalStorage: selectedLink.hostInput.logicalStorage,
      commands: [selectedLink.runtime.create, selectedLink.runtime.dismiss, selectedLink.runtime.restore],
      validateLogicalCall: policy.validateLogicalCall, events: { contracts: [attached, detached], select } }],
    commands: [create, dismiss, restore], events: { producerRevision: revision, contracts: [attached, detached],
      subscribers: [{ id: "logical-variant-pricing-link-lifecycle", revision: "f".repeat(64) }],
      validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, create, dismiss, restore };
}

describe("native Variant–PriceSet Link lifecycle on shared logical storage", () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantPricingLink: true,
    });
    link = await prepareLogicalVariantPricingLinkHost(fixture);
    await Effect.runPromise(link.host.initialize([]));
    await Effect.runPromise(link.host.close);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("refuses an unchanged restore without its authenticated row observation", async () => {
    const policy = link.runtime.logicalEventPolicy();
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ commandName: "linkRestore", mode: "write", input: { price_set_id: "forged-set" }, result: null,
        events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 1 }, { mutations: [], lifecycle: [{ table: "product_variant_price_set", key: { variant_id: "forged-variant", price_set_id: "forged-set" },
      operation: "restore", beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: null }], observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("replaces an explicit ID, dismisses it and restores it with native events", async () => {
    const { host, create, dismiss, restore } = await prepareLifecycleHost();
    try {
      const before = await events();
      const original = pair("lifecycle-variant", "lifecycle-set", "pvps_original");
      await Effect.runPromise(host.run(host.newRequestKey(), create, original));
      const key = host.newRequestKey();
      await Effect.runPromise(host.run(key, dismiss, original));
      const dismissedRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const dismissedEvents = await events();
      await Effect.runPromise(host.run(key, dismiss, original));
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(dismissedRows);
      expect(await events()).toEqual(dismissedEvents);
      await Effect.runPromise(host.run(host.newRequestKey(), create,
        pair("lifecycle-variant", "lifecycle-set", "pvps_replacement")));
      const restoreKey = host.newRequestKey();
      await Effect.runPromise(host.run(restoreKey, restore, { price_set_id: "lifecycle-set" }));
      const restoredRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const restoredEvents = await events();
      await Effect.runPromise(host.run(restoreKey, restore, { price_set_id: "lifecycle-set" }));
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(restoredRows);
      expect(await events()).toEqual(restoredEvents);
      const reader = await Effect.runPromise(makeCommerceHost(link.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(link.runtime.count, { filters: { variant_id: "lifecycle-variant" },
          config: { select: ["id", "variant_id", "price_set_id", "deleted_at"], take: 1 } })))
          .toMatchObject([[{ id: "pvps_replacement", deleted_at: null }], 1]);
      } finally { await Effect.runPromise(reader.close); }
      expect((await events()).slice(before.length).map(event => event.envelope.contract)).toEqual([
        "LinkProductVariantPriceSet.attached", "LinkProductVariantPriceSet.detached",
        "LinkProductVariantPriceSet.attached", "LinkProductVariantPriceSet.attached",
      ]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("dismisses distinct endpoint pairs that share a non-key explicit ID", async () => {
    const { host, create, dismiss } = await prepareLifecycleHost();
    try {
      const first = pair("duplicate-id-variant-a", "duplicate-id-set-a", "shared_link_id");
      const second = pair("duplicate-id-variant-b", "duplicate-id-set-b", "shared_link_id");
      await Effect.runPromise(host.run(host.newRequestKey(), create, first));
      await Effect.runPromise(host.run(host.newRequestKey(), create, second));
      const before = await events();
      await Effect.runPromise(host.run(host.newRequestKey(), dismiss, [first, second]));
      const emitted = (await events()).slice(before.length);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]?.envelope.contract).toBe("LinkProductVariantPriceSet.detached");
      const reader = await Effect.runPromise(makeCommerceHost(link.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(link.runtime.count, { filters: { id: "shared_link_id" },
          config: { select: ["id", "variant_id", "price_set_id"], take: 2 } }))).toEqual([[], 0]);
      } finally { await Effect.runPromise(reader.close); }
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("preserves singular endpoints and rolls back a conflicting restore", async () => {
    const { host, create, dismiss, restore } = await prepareLifecycleHost();
    try {
      await Effect.runPromise(host.run(host.newRequestKey(), create, pair("unique-a", "set-a")));
      const before = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      for (const value of [pair("unique-a", "set-b"), pair("unique-b", "set-a")]) {
        await expect(Effect.runPromise(host.run(host.newRequestKey(), create, value)))
          .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
        expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(before);
      }
      await Effect.runPromise(host.run(host.newRequestKey(), dismiss, pair("unique-a", "set-a")));
      await Effect.runPromise(host.run(host.newRequestKey(), create, pair("unique-a", "set-b")));
      const conflictRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const conflictEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), restore, { price_set_id: "set-a" })))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(conflictRows);
      expect(await events()).toEqual(conflictEvents);
      await Effect.runPromise(host.run(host.newRequestKey(), dismiss, pair("unique-a", "set-b")));
      await Effect.runPromise(host.run(host.newRequestKey(), restore, { price_set_id: "set-a" }));
      const reader = await Effect.runPromise(makeCommerceHost(link.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(link.runtime.count, { filters: { variant_id: "unique-a" },
          config: { select: ["price_set_id", "deleted_at"], take: 2 } })))
          .toEqual([[expect.objectContaining({ price_set_id: "set-a", deleted_at: null })], 1]);
      } finally { await Effect.runPromise(reader.close); }
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("keeps identical lifecycle identities isolated between two shops", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, fixtureIdentity: { deploymentId: "deployment_link_lifecycle_shop_b",
        projectId: "project_link_lifecycle_shop_b", uuidOffset: 4_000 },
      includeProduct: true, includePricing: true, includeVariantPricingLink: true,
    });
    const otherLink = await prepareLogicalVariantPricingLinkHost(other);
    await Effect.runPromise(otherLink.host.initialize([]));
    await Effect.runPromise(otherLink.host.close);
    const first = await prepareLifecycleHost();
    const second = await prepareLifecycleHost(other, otherLink);
    try {
      const same = pair("shared-lifecycle-variant", "shared-lifecycle-set");
      await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.create, same));
      await Effect.runPromise(second.host.run(second.host.newRequestKey(), second.create, same));
      const firstScope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
      const secondScope = projectScopeIdUuidV1(other.application.authority.scopeId).scopeUuid;
      expect(firstScope).not.toBe(secondScope);
      const secondBefore = (await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope);
      await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.dismiss, same));
      expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope)).toEqual(secondBefore);
      await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.restore,
        { price_set_id: "shared-lifecycle-set" }));
      expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope)).toEqual(secondBefore);
    } finally { await Effect.runPromise(first.host.close); await Effect.runPromise(second.host.close); }
  }, 150_000);

  it.skipIf(driver !== "postgres")("admits one of two competing restores for one active variant", async () => {
    const first = await prepareLifecycleHost();
    const second = await prepareLifecycleHost();
    try {
      for (const set of ["race-restore-set-a", "race-restore-set-b"]) {
        const value = pair("race-restore-variant", set);
        await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.create, value));
        await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.dismiss, value));
      }
      const results = await Promise.allSettled([
        Effect.runPromise(first.host.run(first.host.newRequestKey(), first.restore, { price_set_id: "race-restore-set-a" })),
        Effect.runPromise(second.host.run(second.host.newRequestKey(), second.restore, { price_set_id: "race-restore-set-b" })),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const reader = await Effect.runPromise(makeCommerceHost(link.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(link.runtime.count, { filters: { variant_id: "race-restore-variant" },
          config: { select: ["variant_id", "price_set_id"], take: 2 } })))
          .toEqual([[expect.objectContaining({ variant_id: "race-restore-variant" })], 1]);
      } finally { await Effect.runPromise(reader.close); }
    } finally { await Effect.runPromise(first.host.close); await Effect.runPromise(second.host.close); }
  }, 150_000);
});
