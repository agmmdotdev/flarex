import { Effect } from "effect";
import { makeCategoryCurrencyAtomicCommand } from "../../src/category-currency-atomic-command";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { productLogicalInternalCategoryPolicy } from "../../src/product-local-events";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from "../../../persistence-postgres/src/atomicCommerce/host";
import type { AtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/commands";
import { runEffect } from "../../../persistence-postgres/test/effectTestRuntime";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import type { CommerceHost } from "../../../persistence-postgres/src/commerceTransaction/commands";
import { decodeCategoryProjection } from "../../src/product-category-projection";

interface LogicalCategoryCurrencyFixture {
  readonly currency: LogicalCurrencyFixture;
  readonly product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  readonly categoryReadHost: CommerceHost;
  readonly proof: Effect.Success<ReturnType<typeof makeCategoryCurrencyAtomicCommand>>;
  readonly input: AtomicCommerceHostInput<unknown>;
  readonly host: AtomicCommerceHost;
}

export async function logicalCategoryCurrencyInventory(fixture: LogicalCategoryCurrencyFixture) {
  const categories = await runEffect(fixture.categoryReadHost.read(fixture.product.runtime.commands.internalCategoryList,
    { filters: {} }).pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value)))));
  if (!Array.isArray(categories)) throw new Error("Missing logical Category inventory");
  return { logical: await logicalCurrencyInventory(fixture.currency), categories };
}

/** The real Category/Currency command over two admitted logical sources. */
export async function logicalCategoryCurrencyFixture(
  driver: "pglite" | "postgres",
  registerCleanup: (cleanup: () => Promise<void>) => void,
  options?: Readonly<{ includeUserNameIndex?: boolean }>,
): Promise<LogicalCategoryCurrencyFixture> {
  const currency = await logicalCurrencyFixture(driver, registerCleanup,
    { ...options, includeProduct: true });
  const product = await prepareLogicalProductHost(currency);
  registerCleanup(() => runEffect(product.host.close));
  await runEffect(product.host.initialize([]));
  const categoryReadHost = await runEffect(makeCommerceHost({ ...product.hostInput,
    commands: [product.runtime.commands.internalCategoryList] }));
  registerCleanup(() => runEffect(categoryReadHost.close));
  const proof = await runEffect(makeCategoryCurrencyAtomicCommand());
  const metadata = await runEffect(captureProductSchema("atomic-commerce")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  const input = { ...currency.hostInput,
    commands: [proof.command], participants: [
      { participant: proof.productParticipant, logicalStorage: product.hostInput.logicalStorage,
        commands: proof.productCommands,
        validateLogical: productLogicalInternalCategoryPolicy(metadata, "create").validateLogical },
      { participant: proof.currencyParticipant, logicalStorage: currency.hostInput.logicalStorage,
        commands: proof.currencyCommands },
    ] } satisfies AtomicCommerceHostInput<unknown>;
  const host = await runEffect(makeAtomicCommerceHost(input));
  registerCleanup(() => runEffect(host.close));
  return { currency, product, categoryReadHost, proof, input, host };
}
