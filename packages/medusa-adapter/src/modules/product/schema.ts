import { Effect } from "effect";
import { relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import { compileProductDefinition, ProductSchemaError } from "./definition";
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";

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
