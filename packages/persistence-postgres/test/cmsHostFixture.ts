import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { makePGliteFrameworkMigrationTargetEffect } from "../src/migrationCoordination/pgliteTarget";
import { makePostgresFrameworkMigrationTargetEffect } from "../src/migrationCoordination/postgresTarget";
import { makeDataBindingHost, dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";


import { relationReadinessFixture, prepareReadinessEvidence } from "./applicationRelationReadinessFixture";
import { runEffect } from "./effectTestRuntime";
import { makePayloadContentProfiles } from "../../payload-adapter/src/profile";

export async function cmsHostFixture(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  options: Parameters<typeof relationReadinessFixture>[0] = {}) {
  const fixture = await relationReadinessFixture({ persistence, writePolicy: true, bindingAdmission: true, cmsIndexes: true,
    cmsFields: [{ name: "title", kind: "text", unique: true }], ...options });
  const posts = await prepareCmsFixtureReadiness(fixture);
  await runEffect(fixture.fold.settle(fixture.input));
  await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
  const active = await runEffect(fixture.relationActivation.readActive());
  const targetInput = { deploymentId: fixture.deploymentId, canonicalPhysicalDatabaseIdentity: "cms-host-fixture", physicalLocator: active.basis.authority.physicalLocator };
  const target = "pool" in persistence ? await runEffect(makePostgresFrameworkMigrationTargetEffect({ ...targetInput, persistence })) :
    await runEffect(makePGliteFrameworkMigrationTargetEffect({ ...targetInput, persistence }));
  const payloadProfiles = await runEffect(makePayloadContentProfiles());
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

  return { fixture, posts, bindings, reference, candidate, target, payloadProfiles };
}

export async function prepareCmsFixtureReadiness(fixture: Awaited<ReturnType<typeof relationReadinessFixture>>) {
  const posts = fixture.relation.binding.tables.find(table => table.logicalName === "posts");
  if (posts === undefined) throw new Error("Expected posts binding");
  await prepareReadinessEvidence(fixture);
  return posts;
}
