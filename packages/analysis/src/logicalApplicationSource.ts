import { Effect, Schema } from "effect";
import { decodeSchemaManifestAppTableDeclarationsV1Result, decodeSchemaManifestAppIndexDeclarationsV1Result } from "flarex-protocol/schema-manifest";
import type { LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import type { ApplicationManifest } from "./applicationAnalysis";
import { ApplicationManifestV3Schema } from "./applicationAnalysis";
import { captureLogicalSchemaSource, LogicalSchemaCandidateError } from "./logicalSchemaCandidate";
import { encodeCanonicalJson, isJson, isJsonObject } from "flarex-protocol/json";

export const ApplicationLogicalV3Evidence = Schema.Struct({ manifest: ApplicationManifestV3Schema,
  manifestSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) }).annotate({ parseOptions: { onExcessProperty: "error" } });

/** Projection of authenticated analysis, shared by all framework composition
 * roots. V3's complete schema/policy evidence retains placements and command
 * ownership; Payload's native compiler supplies its own single definition. */
export const prepareApplicationLogicalSource = Effect.fn("LogicalSchema.prepareApplicationSource")(function* (
  manifest: ApplicationManifest, manifestSha256: string,
  payload?: LogicalSchemaSource,
) {
  const failed = () => new LogicalSchemaCandidateError({ reason: "invalidInput" });
  const policies = manifest.version === 3 ? manifest.schema.writePolicies : undefined;
  const payloadNames = new Set(policies?.tables.filter(table => table.owner === "payload").map(table => table.logicalTableName) ?? []);
  if (manifest.schema.tables.some(table => table.placement.kind !== "global" &&
    !(manifest.version === 3 && table.placement.kind === "partitionBy" && table.placement.field === "_id")))
    return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "unsupportedPlacement" }));
  if (policies !== undefined && manifest.version === 3) {
    if (payload === undefined || payload.owner !== "payload" || payload.definition.kind !== "documents" ||
      canonical(payload.evidence) !== canonical({ ...policies, tables: policies.tables.filter(table => table.owner === "payload") }) ||
      payload.definition.tables.length !== payloadNames.size)
      return yield* Effect.fail(failed());
    for (const table of payload.definition.tables) {
      const original = manifest.schema.tables.find(original => original.name === table.logicalName && payloadNames.has(original.name));
      if (original === undefined || canonical(original.validator) !== canonical(table.definition.documentType))
        return yield* Effect.fail(failed());
    }
    // Indices/relations are part of the same compiler contract, not inferred
    // from matching collection names or a copied configuration digest.
    const expectedIndexes = manifest.schema.indexes.filter(index => payloadNames.has(
      manifest.schema.tables.find(table => table.tableId === index.tableId)?.name ?? "")).map(index => ({
        tableLogicalName: manifest.schema.tables.find(table => table.tableId === index.tableId)!.name,
        descriptor: index.name, fields: index.fields, ...(index.decimalFields === undefined ? {} : { decimalFields: index.decimalFields }),
      }));
    if (canonical(expectedIndexes) !== canonical(payload.definition.indexes) ||
      canonical(manifest.schema.relations.filter(relation => payloadNames.has(relation.declaration.source.table)).map(relation => relation.declaration)) !==
        canonical(payload.definition.relations)) return yield* Effect.fail(failed());
  }
  const nativeTables = manifest.schema.tables.filter(table => !payloadNames.has(table.name));
  const tables = yield* Effect.fromResult(decodeSchemaManifestAppTableDeclarationsV1Result(nativeTables.map(table => ({
    logicalName: table.name, definition: { kind: "appDocument", definitionVersion: 1, documentType: table.validator },
  })))).pipe(Effect.mapError(cause => new LogicalSchemaCandidateError({ reason: "invalidInput", cause })));
  const names = new Set(nativeTables.map(table => table.name));
  const manifestData: unknown = manifest;
  if (!isJson(manifestData) || !isJsonObject(manifestData)) return yield* Effect.die(new Error("Decoded Application manifest lost JSON"));
  const indexes = yield* Effect.fromResult(decodeSchemaManifestAppIndexDeclarationsV1Result(manifest.schema.indexes
    .filter(index => names.has(manifest.schema.tables.find(table => table.tableId === index.tableId)?.name ?? ""))
    .map(index => ({ tableLogicalName: manifest.schema.tables.find(table => table.tableId === index.tableId)!.name,
      descriptor: index.name, fields: index.fields, ...(index.decimalFields === undefined ? {} : { decimalFields: index.decimalFields }) })))).pipe(
        Effect.mapError(cause => new LogicalSchemaCandidateError({ reason: "invalidInput", cause })));
  return yield* captureLogicalSchemaSource({ key: "application", owner: "application", writeProfile: "application.occ",
    evidence: manifest.version === 3 ? { manifestSha256, manifest: manifestData } :
      { sourceArtifact: manifest.sourceArtifact, manifestSha256 },
    definition: { kind: "documents", tables, indexes, uniqueConstraints: [], relations: manifest.version === 1 ? [] :
      manifest.schema.relations.filter(relation => names.has(relation.declaration.source.table)).map(relation => relation.declaration) },
    bindings: tables.map(table => ({ kind: "definition", localName: table.logicalName, table: { namespace: "app", logicalName: table.logicalName } })),
  });
});

const canonical = (value: Parameters<typeof encodeCanonicalJson>[0]) => encodeCanonicalJson(value, issue => {
  throw new Error(`Application source JSON invariant: ${issue.reason}`);
});
