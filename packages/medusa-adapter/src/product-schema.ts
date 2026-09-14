import { Effect } from "effect";
import { relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import { compileProductDefinition, ProductSchemaError } from "./product-definition";
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { capturePrivateCanonicalValue, captureRelationalPhysicalLayout, registerCommerceSchemaProfile } from "@flarex/persistence-postgres/internal/commerce-profile";

export const captureProductSchema = Effect.fn("MedusaProduct.captureSchema")(
  function* (deploymentId: string) {
    const { schema, metadata, provenance } = yield* compileProductDefinition();
    const captured = yield* captureRelationalSchemaArtifact({
      deploymentId,
      provenance,
      schema: relationalSchemaSourceFromDefinition(schema),
    });
    const retained = yield* capturePrivateCanonicalValue(metadata, 1_048_576, {
      invalidInput: () =>
        new ProductSchemaError({ cause: "Invalid Product metadata" }),
      hashFailure: (cause) => new ProductSchemaError({ cause }),
    });
    return { ...captured, metadata: retained };
  },
);

export const prepareProductSchemaProfile = Effect.fn(
  "MedusaProduct.prepareSchemaProfile",
)(function* (
  deploymentId: string,
  target: Omit<
    Parameters<typeof captureRelationalPhysicalLayout>[0],
    "artifact"
  >,
) {
  const captured = yield* captureProductSchema(deploymentId);
  const layout = yield* captureRelationalPhysicalLayout({
    ...target,
    artifact: captured.artifact,
  });
  const profile = yield* registerCommerceSchemaProfile(
    captured.artifact,
    layout,
  );
  return { ...captured, layout, profile };
});
