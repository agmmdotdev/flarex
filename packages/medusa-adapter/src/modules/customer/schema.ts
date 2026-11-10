import { Effect } from "effect";
import { customerModuleModels } from "@medusajs/customer/static-manifest";
import { compileDmlMetadata } from "../../schema/compile";
import { makeMedusaCoreDefinition } from "../../schema/core-definition";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { lowerDmlSchema } from "../../schema/lower";

/** Retain the genuine Customer constructor and lifecycle closure. Selecting
 * this metadata grants no general Customer, Address or Group method surface. */
export const captureCustomerMetadata = Effect.fn("Customer.captureMetadata")(function* () {
  const compiled = yield* compileDmlMetadata(customerModuleModels, cause => commerceError("unsupportedProfile", cause));
  const names = ["customer", "customer_address", "customer_group", "customer_group_customer"];
  if (compiled.tables.length !== names.length || names.some(name => compiled.tables.filter(table => table.name === name).length !== 1)
    || compiled.tables.some(table => table.foreignKeys.some(key => !names.includes(key.referencedTable))
      || table.relationships.some(relation => !names.includes(relation.targetTable)))) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, {
    invalidInput: () => commerceError("unsupportedProfile"), hashFailure: cause => commerceError("unsupportedProfile", cause),
  });
});

export const customerSourceProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/customer/src/models/customer.ts", "packages/modules/customer/src/models/address.ts",
    "packages/modules/customer/src/models/customer-group.ts", "packages/modules/customer/src/models/customer-group-customer.ts",
    "packages/modules/customer/src/static-manifest.ts", "packages/database/drizzle/src/schema.ts"]),
} as const);

/** Complete native four-model definition, including both active Boolean
 * Address uniqueness predicates. No populated installation upgrade. */
export const compileCustomerDefinition = Effect.fn("Customer.compileDefinition")(function* () {
  const metadata = yield* captureCustomerMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.customer")));
  return Object.freeze({ schema, provenance: customerSourceProvenance });
});

export const compileCustomerCoreDefinition = Effect.fn("Customer.compileCoreDefinition")(function* ({ scopeUuid, epochUuid }: Readonly<{
  scopeUuid: string;
  epochUuid: string;
}>) {
  const { schema, provenance } = yield* compileCustomerDefinition();
  return yield* makeMedusaCoreDefinition({ scopeUuid, epochUuid, applicationRead: false }, { schema, provenance }, { key: "medusa.customer", writeProfile: "medusa.customer",
    evidence: { provenance, profile: "medusa.customer" } });
});
