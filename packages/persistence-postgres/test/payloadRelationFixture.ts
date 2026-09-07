import { verifyApplicationManifestV3, type ApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { createHash } from "node:crypto";
import { publishApplicationRelationBindingEffect, type RelationEvolutionDecision } from "../src/applicationRelationBinding";
import { payloadRelationConfiguration, payloadManyConfiguration } from "../src/payloadScalar/profile";
import { hashPolicyFixture } from "./applicationWritePolicyFixture";
import { prepareAdditionalRelationRevision, relationBindingRepository, type relationReadinessFixture } from "./applicationRelationReadinessFixture";
import { prepareCmsFixtureReadiness } from "./cmsHostFixture";
import { runEffect } from "./effectTestRuntime";

export async function payloadRelationManifest(prior: ApplicationManifestV3, many = false) {
  const configuration = many ? payloadManyConfiguration : payloadRelationConfiguration;
  const writePolicies = { ...prior.schema.writePolicies, configuration,
    tables: prior.schema.writePolicies.tables.map(table => table.owner === "payload" ? { ...table, configSha256: hashPolicyFixture(configuration) } : table) };
  const posts = prior.schema.tables.find(table => table.name === "posts");
  if (posts === undefined || posts.validator.type !== "object") throw new Error("Expected scalar posts");
  const priorFields = posts.validator.value;
  return runEffect(verifyApplicationManifestV3({ ...prior,
    sourceArtifact: { ...prior.sourceArtifact, rootSha256: (many ? "e" : "d").repeat(64) },
    schema: { ...prior.schema, writePolicies, writePolicySetSha256: hashPolicyFixture(writePolicies),
      tables: prior.schema.tables.map(table => table.name !== "posts" ?
        // A second upgrade attempt needs a distinct schema candidate, not conflicting
        // evolution evidence replayed against the earlier fresh-many binding.
        many && prior.schema.relations.length === 1 && table.name === "audit" && table.validator.type === "object"
          ? { ...table, validator: { ...table.validator, value: { ...table.validator.value, manyUpgrade: { optional: true, fieldType: { type: "string" } } } } }
          : table : { ...table,
        validator: { type: "object", value: { ...priorFields, relatedPost: { optional: true, fieldType: { type: "id", tableName: "posts" } },
          ...(many ? { relatedPosts: { optional: false, fieldType: { type: "array", value: { type: "id", tableName: "posts" } } } } : {}) } } }),
      relations: [{ relationOrdinal: 1, sourceTableOrdinal: posts.tableId, targetTableOrdinal: posts.tableId,
        declaration: { format: "flarex.relation-declaration", version: 1, source: { table: "posts", path: [{ kind: "field", name: "relatedPost" }], forwardName: "relatedPost" },
          target: { table: "posts" }, value: { cardinality: "one", required: false }, inverse: { cardinality: "many", name: null }, localized: false, onTargetDelete: "restrict" } },
        ...(many ? [{ relationOrdinal: 2, sourceTableOrdinal: posts.tableId, targetTableOrdinal: posts.tableId,
          declaration: { format: "flarex.relation-declaration", version: 1, source: { table: "posts", path: [{ kind: "field", name: "relatedPosts" }], forwardName: "relatedPosts" },
            target: { table: "posts" }, value: { cardinality: "many", minItems: 0, maxItems: 32, ordered: true, duplicates: "forbid" },
            inverse: { cardinality: "many", name: null }, localized: false, onTargetDelete: "restrict" } }] : [])],
    } }));
}

export async function preparePayloadRelationSuccessor(fixture: Awaited<ReturnType<typeof relationReadinessFixture>>, many = false, ordinal = 61) {
  if (fixture.manifest.version !== 3) throw new Error("Expected scalar policy manifest");
  const canonical = await payloadRelationManifest(fixture.manifest, many);
  const input = { deploymentId: fixture.deploymentId, manifest: canonical.manifest, manifestSha256: createHash("sha256").update(canonical.canonicalBytes).digest("hex"),
    decisions: canonical.manifest.schema.relations.map((relation): RelationEvolutionDecision =>
      many && relation.relationOrdinal === 1 && fixture.manifest.schema.relations.length === 1
        ? { relationOrdinal: relation.relationOrdinal, evolution: { kind: "preserve", fromSchemaVersionId: fixture.relation.binding.schemaVersionId, fromRelationOrdinal: 1, physical: "reuse" } }
        : { relationOrdinal: relation.relationOrdinal, evolution: { kind: "new" } }) };
  const relation = await runEffect(publishApplicationRelationBindingEffect(relationBindingRepository(fixture.control.drizzle), input));
  if (fixture.control !== fixture.persistence) await runEffect(publishApplicationRelationBindingEffect(relationBindingRepository(fixture.persistence.drizzle), input));
  const next = { ...fixture, relation, manifest: canonical.manifest };
  const prepared = await prepareAdditionalRelationRevision(next, ordinal, async () => { await prepareCmsFixtureReadiness(next); });
  return { ...next, publication: prepared.publication, input: { deploymentId: fixture.deploymentId, revisionId: prepared.publication.revisionId } };
}

/** A subsequent revision explicitly preserves the serving relation through its native evolution contract. */
export async function preparePayloadRelationRevision(fixture: Awaited<ReturnType<typeof relationReadinessFixture>>, ordinal: number) {
  if (fixture.manifest.version !== 3) throw new Error("Expected policy manifest");
  const canonical = await runEffect(verifyApplicationManifestV3({ ...fixture.manifest,
    sourceArtifact: { ...fixture.manifest.sourceArtifact, rootSha256: ordinal.toString(16).padStart(64, "0") },
    // A real Application schema successor: only the unmanaged audit table changes.
    // Changing source bytes alone is a binding replay and cannot change its evolution decision.
    schema: { ...fixture.manifest.schema, tables: fixture.manifest.schema.tables.map(table => table.name === "audit" && table.validator.type === "object" ? {
      ...table, validator: { ...table.validator, value: { ...table.validator.value, [`note${ordinal}`]: { optional: true, fieldType: { type: "string" } } } },
    } : table) },
  }));
  const input = { deploymentId: fixture.deploymentId, manifest: canonical.manifest,
    manifestSha256: createHash("sha256").update(canonical.canonicalBytes).digest("hex"),
    decisions: [{ relationOrdinal: 1, evolution: { kind: "preserve" as const, fromSchemaVersionId: fixture.relation.binding.schemaVersionId, fromRelationOrdinal: 1, physical: "reuse" as const } }],
  };
  const relation = await runEffect(publishApplicationRelationBindingEffect(relationBindingRepository(fixture.control.drizzle), input));
  if (fixture.control !== fixture.persistence) await runEffect(publishApplicationRelationBindingEffect(relationBindingRepository(fixture.persistence.drizzle), input));
  const next = { ...fixture, relation, manifest: canonical.manifest, semanticReuse: true };
  const prepared = await prepareAdditionalRelationRevision(next, ordinal, async () => { await prepareCmsFixtureReadiness(next); });
  return { ...next, publication: prepared.publication, input: { deploymentId: fixture.deploymentId, revisionId: prepared.publication.revisionId } };
}
