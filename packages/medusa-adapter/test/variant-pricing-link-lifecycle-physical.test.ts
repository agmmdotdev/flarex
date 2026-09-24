import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { prepareProductVariantPricing, captureVariantPricingLinkMetadata } from "../src/product-variant-pricing-schema";
import { prepareVariantPricingLink } from "../src/variant-pricing-link-service";
import { prepareLinkService } from "../src/link-service";

const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let link: Effect.Success<ReturnType<typeof prepareVariantPricingLink>>;
let dismiss: ReturnType<typeof defineCommerceCommand>;
let restore: ReturnType<typeof defineCommerceCommand>;

beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => { cleanup.push(close); };
  const resource = process.env.FLAREX_TEST_DRIVER === "postgres" ? await (async () => {
    const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })() : await createRelationalPGliteFixture({ registerCleanup });
  const control = process.env.FLAREX_TEST_DRIVER === "postgres" ? resource.persistence
    : await createMigratedPGlitePersistence(registerCleanup);
  link = await Effect.runPromise(prepareVariantPricingLink());
  const native = await Effect.runPromise(prepareLinkService(await Effect.runPromise(captureVariantPricingLinkMetadata())));
  const decodePair = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.Struct({ variant_id: Schema.String }),
    pricing: Schema.Struct({ price_set_id: Schema.String }) }));
  dismiss = defineCommerceCommand("linkDismiss", "write", (ctx, args) =>
    native.use(ctx, scope => scope.link.dismiss(decodePair(args), scope.context)));
  restore = defineCommerceCommand("linkRestore", "write", (ctx, args) => native.use(ctx, async scope => {
    await scope.service.restore({ price_set_id: Schema.decodeUnknownSync(Schema.String)(args) }, {}, scope.context);
    return null;
  }));
  const prepare = (...args: Parameters<typeof prepareProductVariantPricing>) =>
    prepareProductVariantPricing(...args).pipe(Effect.map(value => ({ ...value, profile: value.profiles.link })));
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepare,
    [...link.commands, dismiss, restore], control,
    descriptor => link.eventPolicy(descriptor, () => Effect.void));
});
afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

describe("native Variant–PriceSet Link lifecycle retained on physical storage", () => {
  it("preserves both singular endpoints and refuses a conflicting restore", async () => {
    const pair = (variant: string, set: string) => ({ product: { variant_id: variant }, pricing: { price_set_id: set } });
    const create = (value: Schema.Json) => Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), link.create, value));
    await create(pair("unique-a", "set-a"));
    const before = await commerceInventory(fixture);
    for (const value of [pair("unique-a", "set-b"), pair("unique-b", "set-a")]) {
      await expect(create(value)).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await commerceInventory(fixture)).toEqual(before);
    }
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), dismiss, pair("unique-a", "set-a")));
    await create(pair("unique-a", "set-b"));
    const conflict = await commerceInventory(fixture);
    await expect(Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), restore, "set-a")))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await commerceInventory(fixture)).toEqual(conflict);
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), dismiss, pair("unique-a", "set-b")));
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), restore, "set-a"));
    expect(await Effect.runPromise(fixture.host.read(link.count, { filters: { variant_id: "unique-a" } })))
      .toEqual([[expect.objectContaining({ price_set_id: "set-a", deleted_at: null })], 1]);
  });
});
