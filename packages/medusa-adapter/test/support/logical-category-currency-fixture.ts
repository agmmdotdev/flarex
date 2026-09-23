import { Effect } from "effect";
import { makeCategoryCurrencyAtomicCommand } from "../../src/category-currency-atomic-command";
import { prepareLocalProductProfile } from "../../src/product-profile";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../../src/product-local-events";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from "../../../persistence-postgres/src/atomicCommerce/host";
import type { AtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/commands";
import { requireCommerceProfile, type CommerceProfile, type CommerceProfileState } from "../../../persistence-postgres/src/commerceTransaction/profile";
import { makeCommerceBinding } from "../../../persistence-postgres/src/commerce";
import { frameworkSchemaTargetSnapshot } from "../../../persistence-postgres/src/frameworkSchema/target";
import { installCommerceProfileFixture } from
  "../../../persistence-postgres/test/commerceProfileInstallationFixture";
import { installationBindingReference } from
  "../../../persistence-postgres/test/frameworkDataBindingPhysicalTestSupport";
import { makeDataBindingHost, dataBindingActivationRequest, type DataBindingHost } from
  "../../../persistence-postgres/src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from
  "../../../persistence-postgres/src/frameworkSchema/binding/selection";
import { commerceBindings } from "../../../persistence-postgres/src/frameworkSchema/binding/model";
import { runEffect } from "../../../persistence-postgres/test/effectTestRuntime";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";

interface LogicalCategoryCurrencyFixture {
  readonly currency: LogicalCurrencyFixture;
  readonly product: { readonly profile: CommerceProfile; readonly descriptor: CommerceProfileState };
  readonly installation: ReturnType<typeof installationBindingReference>;
  readonly bindings: DataBindingHost<unknown>;
  readonly proof: Effect.Success<ReturnType<typeof makeCategoryCurrencyAtomicCommand>>;
  readonly input: AtomicCommerceHostInput<unknown>;
  readonly host: AtomicCommerceHost;
}

/** The real Category/Currency command on one mixed binding and one settlement owner. */
export async function logicalCategoryCurrencyFixture(
  driver: "pglite" | "postgres",
  registerCleanup: (cleanup: () => Promise<void>) => void,
  options?: Readonly<{ includeUserNameIndex?: boolean }>,
): Promise<LogicalCategoryCurrencyFixture> {
  const currency = await logicalCurrencyFixture(driver, registerCleanup, options);
  const prepare = Effect.fn("LogicalCategoryCurrencyFixture.prepare")(function* () {
    const target = frameworkSchemaTargetSnapshot(currency.bindingTarget);
    if (target === undefined) throw new Error("Missing mixed commerce target");
    const product = yield* prepareLocalProductProfile(currency.deploymentId,
      { physicalLocator: target.physicalLocator, targetNamespace: target.namespace });
    const descriptor = yield* requireCommerceProfile(product.profile);
    const persistence = currency.persistence;
    const availability = yield* installCommerceProfileFixture({ persistence,
      target: currency.bindingTarget, descriptor, profile: product.profile,
      attemptId: "mixed-product-install", leaseOwnerId: "mixed-product-test" });
    const installation = installationBindingReference(availability);
    const bindings = yield* makeDataBindingHost({ database: persistence.drizzle,
      target: currency.bindingTarget, deploymentId: currency.deploymentId,
      authority: currency.hostInput.authority, application: currency.hostInput.application,
      logicalStorage: { controlDb: currency.control.drizzle, schemaVersionId: currency.schemaVersionId,
        unique: currency.hostInput.logicalStorage.unique }, commerceProfiles: [product.profile] });
    const current = yield* bindings.withCurrent(readAdmittedDataBinding);
    const commerce = yield* makeCommerceBinding(availability, [product.profile]);
    const frame = { ...current.frame, commerce: [...commerceBindings(current.frame), commerce] };
    const candidate = yield* bindings.prepare(frame);
    yield* bindings.activate(dataBindingActivationRequest(frame.application.scopeId,
      frame.application.storageGeneration, "mixed-product-activate", candidate.sha256, current.head));
    const proof = yield* makeCategoryCurrencyAtomicCommand();
    const metadata = yield* captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame)));
    const input = { ...currency.hostInput,
      commands: [proof.command], participants: [
        { participant: proof.productParticipant, profile: product.profile, installation,
          commands: proof.productCommands,
          validate: productLocalEventPolicy(descriptor, metadata, () => Effect.void).validate },
        { participant: proof.currencyParticipant, logicalStorage: currency.hostInput.logicalStorage,
          commands: proof.currencyCommands },
      ] };
    const host = yield* makeAtomicCommerceHost(input);
    yield* Effect.sync(() => registerCleanup(() => runEffect(host.close)));
    return { currency, product: { profile: product.profile, descriptor }, installation, bindings, proof, input, host };
  });
  return runEffect(prepare());
}
