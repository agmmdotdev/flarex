import { Effect } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { RelationalSchema } from "flarex-protocol/internal/relational-schema";

type MedusaSchemaSource = Readonly<{ key: string; writeProfile: string; evidence: Json }>;

/** Medusa owns the source identity and evidence; all tables retain their native lineage. */
export const captureMedusaSchemaSource = Effect.fn("Medusa.captureSchemaSource")(function* (
  definition: Readonly<{ schema: RelationalSchema }>, source: MedusaSchemaSource,
) {
  const { schema } = definition;
  return yield* captureLogicalSchemaSource({ ...source, owner: "medusa",
    definition: { kind: "relational", schema },
    bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  });
});

/** Shared construction only: command capabilities remain the trusted host's responsibility. */
export const makeMedusaCoreDefinition = Effect.fn("Medusa.makeCoreDefinition")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string; applicationRead?: boolean }>,
  definition: Readonly<{ schema: RelationalSchema; provenance: Json }>, source: MedusaSchemaSource,
) {
  const captured = yield* captureMedusaSchemaSource(definition, source);
  return yield* makeCoreRelationalNativeDefinition({ ...target, source: captured,
    provenance: definition.provenance, commands: [] });
});
