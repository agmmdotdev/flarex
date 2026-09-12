import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { makePGliteFrameworkMigrationTargetEffect } from "../src/migrationCoordination/pgliteTarget";
import { makePostgresFrameworkMigrationTargetEffect } from "../src/migrationCoordination/postgresTarget";
import { makeDataBindingHost, dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";


import { relationReadinessFixture, prepareReadinessEvidence } from "./applicationRelationReadinessFixture";
import { runEffect } from "./effectTestRuntime";
import { makePayloadConformanceProfiles } from "../../payload-adapter/src/conformanceProfile";
import { makePayloadContentProfiles } from "../../payload-adapter/src/profile";
import type { CompiledPayloadCollections } from "../../payload-adapter/src/collections";
import { analyzeLoadedApplicationSourcePackageEffect } from "@flarex/analysis";
import { makeApplicationManifest, verifyApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { createHash } from "node:crypto";

async function compiledManifest(compiled: CompiledPayloadCollections) {
  const analysis = await runEffect(analyzeLoadedApplicationSourcePackageEffect({ executionModules: {}, sourceMaps: {}, schemaDefinition: compiled.schemaDefinition }));
  const result = await runEffect(makeApplicationManifest(analysis, {
    rootSha256: "1".repeat(64), executionModulePath: "_flarex/execution.js", schemaModulePath: "_flarex/schema.js",
    modules: [{ path: "_flarex/execution.js", roles: 8, sourceSha256: "2".repeat(64), sourceByteLength: 48 },
      { path: "_flarex/schema.js", roles: 2, sourceSha256: "3".repeat(64), sourceByteLength: 64 }],
  }));
  const canonical = await runEffect(verifyApplicationManifestV3(result.manifest));
  return { manifest: canonical.manifest, manifestSha256: createHash("sha256").update(canonical.canonicalBytes).digest("hex") };
}

export async function cmsHostFixture(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  options: Parameters<typeof relationReadinessFixture>[0] = {}, compiled?: CompiledPayloadCollections) {
  const fixture = await relationReadinessFixture({ persistence, writePolicy: true, bindingAdmission: true, cmsIndexes: true,
    cmsFields: [{ name: "title", kind: "text", unique: true }], ...options,
    ...(compiled === undefined ? {} : { cmsManifest: await compiledManifest(compiled) }) });
  await prepareReadinessEvidence(fixture);
  await runEffect(fixture.fold.settle(fixture.input));
  await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
  const active = await runEffect(fixture.relationActivation.readActive());
  const targetInput = { deploymentId: fixture.deploymentId, canonicalPhysicalDatabaseIdentity: "cms-host-fixture", physicalLocator: active.basis.authority.physicalLocator };
  const target = "pool" in persistence ? await runEffect(makePostgresFrameworkMigrationTargetEffect({ ...targetInput, persistence })) :
    await runEffect(makePGliteFrameworkMigrationTargetEffect({ ...targetInput, persistence }));
  const payloadProfiles = await runEffect(compiled === undefined ? makePayloadConformanceProfiles() : makePayloadContentProfiles(compiled));
  const bindings = await runEffect(makeDataBindingHost({ database: persistence.drizzle, deploymentId: fixture.deploymentId, target,
    authority: fixture.authorityPorts, application: fixture.relationActivation, payloadProfiles }));
  const reference = await runEffect(bindings.readApplicationReference());
  const policy = fixture.relation.binding;
  if (policy.version !== 3) throw new Error("Expected V3 write policy");
  const claims = policy.writePolicies.filter(policy => policy.owner === "payload");
  const first = claims[0];
  if (first?.owner !== "payload") throw new Error("Expected CMS ownership");
  const candidate = await runEffect(bindings.prepare({ format: "flarex.data-binding-set", application: reference,
    payloadContent: { application: reference, configSha256: first.configSha256, provenanceSha256: first.provenanceSha256,
      tables: claims.map(claim => ({ tableId: claim.tableId.toString(), writePolicySha256: claim.writePolicySha256 })) },
    payloadLifecycle: null, commerce: [], crossDomainReferences: [] }));
  await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "cms-host-activate", candidate.sha256, null)));

  return { fixture, tables: fixture.relation.binding.tables, bindings, reference, candidate, target, payloadProfiles };
}

export async function prepareCmsFixtureReadiness(fixture: Awaited<ReturnType<typeof relationReadinessFixture>>) {
  const posts = fixture.relation.binding.tables.find(table => table.logicalName === "posts");
  if (posts === undefined) throw new Error("Expected posts binding");
  await prepareReadinessEvidence(fixture);
  return posts;
}
