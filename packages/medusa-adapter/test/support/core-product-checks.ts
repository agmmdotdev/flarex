import { Effect, Option } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { logicalCommerceBatchResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { CoreNativeLimits } from "../../../persistence-postgres/src/core/api";
import { readCoreFixtureRegistry } from "../../../persistence-postgres/test/core/fixture";
import { REQUESTS } from "../../../persistence-postgres/src/core/registry";
import { createCoreProductFixture, type CoreProductFixture } from "./core-product-fixture";

/** Observe genuine business data and verified durable families. Failed request
 * outcomes are deliberately separate from the no-business-publication check. */
export async function coreProductSnapshot(product: CoreProductFixture) {
  const inventory = await product.inventory();
  const tables = new Set(product.definition.tables.map(table => table.name));
  const families: Array<{ id: string; messages: readonly Json[] }> = [];
  let after: string | undefined;
  while (true) {
    const next = await product.run(product.events.nextFamily(after));
    if (Option.isNone(next)) break;
    const family = await product.run(product.events.readFamily(next.value));
    families.push({ id: next.value, messages: family.events.map(event => event.message) });
    after = next.value;
  }
  return { rows: inventory.rows.filter(row => tables.has(row.table)),
    revisions: inventory.revisions.filter(row => tables.has(row.table)).toSorted((left, right) =>
      left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1
        : left.table.localeCompare(right.table) || left.id.localeCompare(right.id)),
    indexes: inventory.indexes.filter(row => tables.has(row.table)), families,
    outcomes: inventory.outcomes.filter(row => row.value.state === "committed") };
}
export function coreProductNewMessages(before: Awaited<ReturnType<typeof coreProductSnapshot>>,
  after: Awaited<ReturnType<typeof coreProductSnapshot>>) {
  const previous = new Set(before.families.map(family => family.id));
  return after.families.filter(family => !previous.has(family.id)).flatMap(family => family.messages);
}

/** Register actual opaque commands with the existing native host. No activity
 * transcript, settlement, event validation, or dependency logic lives here. */
export const openCoreProductCheckHost = Effect.fn("CoreProductChecks.openHost")(function* (
  product: CoreProductFixture, commands: readonly CommerceCommand[],
  options: Readonly<{ nativeLimits?: CoreNativeLimits }> = {},
) {
  return yield* product.openHost({ commands,
    identityAndAccessPolicy: { profile: "native-product-authored-checks" },
    resources: { ...logicalCommerceBatchResources, eventMessages: 2048 },
    ...(options.nativeLimits === undefined ? {} : { nativeLimits: options.nativeLimits }) });
});

/** Distinct authentic native scopes share the SAME five physical tables, each
 * through its own Core instance partition and trusted database owner. */
export async function createCoreProductScopePair(product: CoreProductFixture) {
  const instanceName = "product-other-scope";
  const persistence = await product.physical.reopen(instanceName);
  const physical = Object.freeze({ ...product.physical, persistence, instanceName, close: async () => {} });
  const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
  const foreign = await createCoreProductFixture(driver, { physical,
    target: { scopeUuid: "66000000-0000-4000-8000-000000000011", epochUuid: "66000000-0000-4000-8000-000000000012" } });
  return { product, foreign, close: () => foreign.close() };
}

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
/** An owned SQL transport fault on the real five-table Core installation. It
 * never executes business SQL or emulates commit/recovery behavior. */
export async function installCoreProductDocumentFault(product: CoreProductFixture,
  options: Readonly<{ target: "business" | "product" | "outcome"; at: number; cancellation?: true }>) {
  const registry = await product.run(product.useGeneration(({ database }) => Effect.gen(function* () {
    return yield* readCoreFixtureRegistry({ persistence: product.physical.persistence }, yield* database.publishedTimestamp);
  })));
  const names = options.target === "outcome" ? [REQUESTS] : options.target === "product"
    ? product.definition.tables.filter(table => table.localName === "product").map(table => table.name)
    : product.definition.tables.map(table => table.name);
  const namespace = options.target === "outcome" ? null : product.bundle.namespace;
  const ids = names.map(name => {
    const table = registry.table(name, namespace)?.definition;
    if (table === undefined) throw new Error("Missing fault target in genuine Core registry");
    return "decode('" + encodeBytesToLowercaseHex(table.tabletId) + "','hex')";
  });
  if (!Number.isSafeInteger(options.at) || options.at < 1 || ids.length === 0) throw new Error("Invalid test fault");
  const schema = quote(product.physical.namespace), name = "fx_native_product_failure";
  const sequence = schema + "." + quote(name + "_calls"), fn = schema + "." + quote(name);
  const table = schema + "." + quote("documents");
  const condition = options.target === "outcome" ? " AND convert_from(NEW.json_value, 'UTF8')::jsonb ->> 'state' = 'committed'" : "";
  await product.physical.query(`CREATE SEQUENCE ${sequence}`);
  // The serving role stays ordinary; this test-owned sequence is its only
  // extra privilege and is removed with the fault.
  await product.physical.query(`GRANT USAGE ON SEQUENCE ${sequence} TO PUBLIC`);
  await product.physical.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.table_id IN (${ids.join(",")}) AND NOT NEW.deleted${condition} THEN
      IF nextval('${sequence}') >= ${options.at} THEN RAISE EXCEPTION 'injected native Product materialization failure'${options.cancellation === true ? " USING ERRCODE = '57014'" : ""}; END IF;
    END IF; RETURN NEW; END $$`);
  await product.physical.query(`CREATE TRIGGER ${quote(name)} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  return { visits: () => product.physical.query(`SELECT last_value::integer AS count, is_called FROM ${sequence}`),
    close: async () => {
      await product.physical.query(`DROP TRIGGER ${quote(name)} ON ${table}`);
      await product.physical.query(`DROP FUNCTION ${fn}()`);
      await product.physical.query(`DROP SEQUENCE ${sequence}`);
    } };
}
