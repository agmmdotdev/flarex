import { Effect } from "effect";
import { CustomerAccountHolder } from "@medusajs/link-modules";
import { makeMedusaCoreDefinition } from "../schema/core-definition";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

export const captureCustomerAccountHolderLinkMetadata = Effect.fn("CustomerAccountHolderLink.captureMetadata")(function* () {
  const [customer, holder] = CustomerAccountHolder.relationships ?? [];
  if (customer?.serviceName !== "customer" || customer.entity !== "Customer" || customer.foreignKey !== "customer_id" || customer.hasMany !== undefined ||
    holder?.serviceName !== "payment" || holder.entity !== "AccountHolder" || holder.foreignKey !== "account_holder_id" || holder.hasMany !== true ||
    customer.deleteCascade !== undefined || holder.deleteCascade !== undefined ||
    CustomerAccountHolder.databaseConfig?.tableName !== "customer_account_holder" || CustomerAccountHolder.databaseConfig.idPrefix !== "custacchldr")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported native Customer-AccountHolder Link" }));
  return yield* captureLinkMetadata(CustomerAccountHolder);
});
export const customerAccountHolderLinkProvenance = Object.freeze({ kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git", revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/customer-account-holder.ts", "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
const compileCustomerAccountHolderLinkDefinition = Effect.fn("CustomerAccountHolderLink.compileDefinition")(function* () {
  const metadata = yield* captureCustomerAccountHolderLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema([metadata.frame], "commerce.link.customer-account-holder", linkSchemaOrigins)));
  return Object.freeze({ schema, provenance: customerAccountHolderLinkProvenance });
});

export const compileCustomerAccountHolderLinkCoreDefinition = Effect.fn("CustomerAccountHolderLink.compileCoreDefinition")(function* ({ scopeUuid, epochUuid }: Readonly<{
  scopeUuid: string; epochUuid: string;
}>) {
  const { schema, provenance } = yield* compileCustomerAccountHolderLinkDefinition();
  return yield* makeMedusaCoreDefinition({ scopeUuid, epochUuid, applicationRead: false },
    { schema, provenance },
    { key: "medusa.link.customerAccountHolder", writeProfile: "medusa.link.customerAccountHolder", evidence: { provenance, profile: "medusa.link.customerAccountHolder" } });
});
