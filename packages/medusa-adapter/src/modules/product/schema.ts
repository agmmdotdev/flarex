import { Effect } from "effect";
import { relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import { compileProductDefinition, ProductSchemaError } from "./definition";
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";

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

/** The actual Product DML graph feeds the shared native logical lifecycle. */
export const compileProductCoreDefinition = Effect.fn("MedusaProduct.compileCoreDefinition")(function* (target: Readonly<{
  scopeUuid: string; epochUuid: string; applicationRead?: boolean;
}>) {
  const nativeTarget = Object.freeze({ scopeUuid: target.scopeUuid, epochUuid: target.epochUuid,
    applicationRead: target.applicationRead ?? false });
  const definition = yield* compileProductDefinition();
  const source = yield* captureLogicalSchemaSource({ key: "medusa.product", owner: "medusa", writeProfile: "medusa.product",
    evidence: { provenance: definition.provenance, profile: "medusa.product" },
    definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ ...nativeTarget, source, provenance: definition.provenance, commands: [] });
});
