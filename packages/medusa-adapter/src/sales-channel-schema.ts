import { Data, Effect } from "effect";
import { SalesChannel } from "@medusajs/sales-channel/models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { capturePrivateCanonicalValue, captureRelationalPhysicalLayout, registerCommerceSchemaProfile, registerLocalCommerceProfile } from "@flarex/persistence-postgres/internal/commerce-profile";
import { captureProductSchema, productSourceProvenance } from "./product-schema";
import { decodeCompiledDml } from "./schema/compiled";
import { lowerDmlSchema } from "./schema/lower";

export class SalesChannelSchemaError extends Data.TaggedError("SalesChannelSchemaError")<{
  readonly cause: unknown;
}> {}

/** One admitted native model; no link metadata or arbitrary model admission. */
export const captureSalesChannelMetadata = Effect.fn("SalesChannel.captureMetadata")(function* () {
  const source = yield* Effect.try({
    try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema([SalesChannel]))),
    catch: cause => new SalesChannelSchemaError({ cause }),
  });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => new SalesChannelSchemaError({ cause })));
  const table = compiled.tables[0];
  if (compiled.tables.length !== 1 || table?.name !== "sales_channel" || table.relationships.length !== 0 || table.foreignKeys.length !== 0
    || table.cascades.delete.length !== 0 || table.cascades.detach.length !== 0) {
    return yield* Effect.fail(new SalesChannelSchemaError({ cause: "Unsupported Sales Channel model set" }));
  }
  const metadata = yield* capturePrivateCanonicalValue(compiled, 1_048_576, {
    invalidInput: () => new SalesChannelSchemaError({ cause: "Invalid Sales Channel metadata" }),
    hashFailure: cause => new SalesChannelSchemaError({ cause }),
  });
  return metadata;
});

/** Complete configured endpoint set for this capability, not a module registry.
 * Every table comes from a checked native module; Flarex still owns validity,
 * canonical identity, physical scope lowering and installation authority. */
export const captureProductSalesChannelSchema = Effect.fn("Commerce.captureProductSalesChannelSchema")(function* (deploymentId: string) {
  const product = yield* captureProductSchema(deploymentId);
  const salesChannel = yield* captureSalesChannelMetadata();
  const tables = [...product.metadata.frame.tables, ...salesChannel.frame.tables];
  if (new Set(tables.map(table => table.name)).size !== tables.length) {
    return yield* Effect.fail(new SalesChannelSchemaError({ cause: "Conflicting module table ownership" }));
  }
  const captured = yield* captureRelationalSchemaArtifact({ deploymentId,
    provenance: { ...productSourceProvenance, paths: [...productSourceProvenance.paths,
      "packages/modules/sales-channel/src/models", "packages/modules/sales-channel/src/static-manifest.ts"] },
    schema: lowerDmlSchema(tables, "commerce.product-sales-channel"),
  });
  return { ...captured, productMetadata: product.metadata, salesChannelMetadata: salesChannel };
});

export const prepareProductSalesChannelSchema = Effect.fn("Commerce.prepareProductSalesChannelSchema")(function* (
  deploymentId: string, target: Omit<Parameters<typeof captureRelationalPhysicalLayout>[0], "artifact">,
) {
  const captured = yield* captureProductSalesChannelSchema(deploymentId);
  const layout = yield* captureRelationalPhysicalLayout({ ...target, artifact: captured.artifact });
  const profile = yield* registerCommerceSchemaProfile(captured.artifact, layout);
  return { ...captured, layout, profile };
});

/** Only Sales Channel rows are granted here, despite the shared schema artifact. */
export const prepareLocalSalesChannelProfile = Effect.fn("SalesChannel.prepareLocalProfile")(function* (
  ...args: Parameters<typeof prepareProductSalesChannelSchema>
) {
  const prepared = yield* prepareProductSalesChannelSchema(...args);
  const table = prepared.layout.frame.tables.find(table => table.identity.tableId === "sales_channel");
  const key = table?.keys.find(key => key.kind === "primary");
  if (key === undefined) return yield* Effect.fail(new SalesChannelSchemaError({ cause: "Missing Sales Channel primary key" }));
  const profile = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout, "medusa.sales-channel.local",
    [{ tableId: "sales_channel", keyId: key.identity.keyId, update: "existingPrimaryKey", remove: "declaredKey" }]);
  return { ...prepared, profile, initialization: { rows: undefined } };
});
