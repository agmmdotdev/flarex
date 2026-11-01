import { Effect, Result } from "effect";
import { captureSchemaManifestAppTableDeclarationsV1Result, decodeSchemaManifestAppIndexDeclarationsV1Result } from "flarex-protocol/schema-manifest";
import { payloadUniqueDeclarations } from "@flarex/analysis/internal/application-write-policy";
import { payloadContentIdentity, payloadPostsCollection, payloadScalarConfiguration, payloadScalarFields } from "../../../../payload-adapter/src/testing/profiles";
import type { CorePayloadFixture, CorePayloadFixtureSource } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { policyManifestFixture } from "../../application/ownership/applicationWritePolicyFixture";
import { payloadRelationManifest } from "./payloadRelationFixture";

/** The actual fixed native producer, without its displaced storage assembly.
 * This is deliberately not a compilePayloadCollections issuer proof. */
export async function preparePayloadConformanceSource(
  profile: "payload.content-relations" | "payload.content-many" | "payload.content-joins",
): Promise<CorePayloadFixtureSource> {
  const scalar = await policyManifestFixture(undefined, true, payloadScalarFields, payloadScalarConfiguration);
  const canonical = await payloadRelationManifest(scalar.manifest, profile !== "payload.content-relations", profile === "payload.content-joins");
  const manifest = canonical.manifest;
  const policies = manifest.schema.writePolicies;
  const nativePolicies = policies.tables.filter(table => table.owner === "payload");
  const names = new Set(nativePolicies.map(table => table.logicalTableName));
  const nativeTables = manifest.schema.tables.filter(table => names.has(table.name));
  const byNumber = new Map(nativeTables.map(table => [table.tableId, table.name]));
  const tables = Result.getOrThrow(captureSchemaManifestAppTableDeclarationsV1Result(nativeTables.map(table => ({
    logicalName: table.name, definition: { kind: "appDocument", definitionVersion: 2, documentType: table.validator },
  }))));
  const indexes = Result.getOrThrow(decodeSchemaManifestAppIndexDeclarationsV1Result(manifest.schema.indexes.flatMap(index => {
    const tableLogicalName = byNumber.get(index.tableId);
    return tableLogicalName === undefined ? [] : [{ tableLogicalName, descriptor: index.name, fields: index.fields }];
  })));
  const uniqueConstraints = (await Effect.runPromise(Effect.forEach(policies.configuration.tables, payloadUniqueDeclarations))).flat();
  const definition = { kind: "documents" as const, tables, indexes, uniqueConstraints,
    relations: manifest.schema.relations.filter(relation => names.has(relation.declaration.source.table)).map(relation => relation.declaration) };
  return Object.freeze({ configuration: policies.configuration,
    contentIdentity: payloadContentIdentity(profile),
    sourceContract: { sourceKey: "payload" as const, writeProfile: profile, configuration: policies.configuration,
      definition, evidence: { ...policies, tables: nativePolicies } },
    createNativeCollections: () => [payloadPostsCollection(profile)],
  });
}

/** Durable byte evidence is independent of the current owner's safe published
 * prefix after an uncertain acknowledgement. Lease/publication metadata may
 * legitimately advance during recovery; application, child and outcome rows
 * and their index history may not be written again merely to replay a result. */
export async function readPayloadPhysicalData(fixture: CorePayloadFixture) {
  const namespace = '"' + fixture.physical.namespace + '"';
  const documents = await fixture.physical.query('SELECT ts::text,encode(table_id,\'hex\') AS table_id,encode(id,\'hex\') AS id,'
    + 'encode(json_value,\'hex\') AS json_value,deleted,prev_ts::text FROM ' + namespace
    + '."documents" WHERE instance_name=$1 ORDER BY ts,table_id,id', [fixture.instanceName]);
  const indexes = await fixture.physical.query('SELECT ts::text,encode(index_id,\'hex\') AS index_id,encode(key_sha256,\'hex\') AS key_sha256,'
    + 'encode(key_prefix,\'hex\') AS key_prefix,encode(key_suffix,\'hex\') AS key_suffix,deleted,'
    + 'encode(table_id,\'hex\') AS table_id,encode(document_id,\'hex\') AS document_id FROM ' + namespace
    + '."indexes" WHERE instance_name=$1 ORDER BY index_id,key_sha256,ts', [fixture.instanceName]);
  return { documents, indexes };
}
