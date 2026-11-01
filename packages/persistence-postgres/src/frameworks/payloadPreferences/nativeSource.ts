import { Effect } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "../../core/nativePolicy";
import { payloadPreferenceSchemaInput, payloadPreferenceSourceRevision } from "./schema";

export const payloadPreferenceCleanupCommand = "payload.preferences.cleanup";
const provenance = {
  kind: "sourceSnapshot", repository: "https://github.com/payloadcms/payload", revision: payloadPreferenceSourceRevision,
  paths: ["packages/payload/src/preferences/config.ts", "packages/payload/src/preferences/deleteUserPreferences.ts"],
} as const;

/** Keep the model inventory; scope/generation belong to Core's logical owner. */
export function payloadPreferenceLogicalSchemaInput() {
  const input = payloadPreferenceSchemaInput();
  return { ...input, tables: input.tables.map(table => ({ ...table,
    columns: table.columns.filter(column => column.columnId !== "storage_generation"),
    keys: table.keys.map(key => ({ ...key, columns: key.columns.filter(column => column !== "storage_generation") })),
    indexes: table.indexes.map(index => ({ ...index, columns: index.columns.filter(column => column !== "storage_generation") })),
  })) };
}

/** The producer is rebuilt on cold reopen; stored metadata alone grants nothing. */
export const makePayloadPreferenceNativeDefinition = Effect.fn("PayloadPreferences.makeNativeDefinition")(function* (target: Readonly<{
  scopeUuid: string; epochUuid: string;
}>) {
  const nativeTarget = Object.freeze({ scopeUuid: target.scopeUuid, epochUuid: target.epochUuid });
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(payloadPreferenceLogicalSchemaInput()));
  const source = yield* captureLogicalSchemaSource({ key: "payload-preferences", owner: "payload", writeProfile: "payload.preferences",
    evidence: { provenance }, definition: { kind: "relational", schema },
    bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "payload", logicalName: `${schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ ...nativeTarget, source, provenance, applicationRead: false,
    commands: [{ name: payloadPreferenceCleanupCommand, mode: "write" }] });
});
