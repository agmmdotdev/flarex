import { expect } from "vitest";

import { SchemaManifestAppIndexDescriptorSchema } from "flarex-protocol/schema-manifest";
import { decodeAppUniqueConstraintPhysicalSpecV1, APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1 } from "flarex-protocol/app-unique-constraint-definition";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { makePGliteFrameworkMigrationTargetEffect } from "../src/migrationCoordination/pgliteTarget";
import { makePostgresFrameworkMigrationTargetEffect } from "../src/migrationCoordination/postgresTarget";
import { makeDataBindingHost, dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";

import { prepareAppUniqueConstraintDefinitionBindingV1Effect, ensureAppUniqueConstraintDefinitionBindingV1InTransaction } from "../src/appUniqueConstraintDefinitions";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../src/appUniqueConstraintSetBuildV1";

import { relationReadinessFixture, prepareReadinessEvidence } from "./applicationRelationReadinessFixture";
import { runEffect } from "./effectTestRuntime";

export async function cmsHostFixture(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  options: Parameters<typeof relationReadinessFixture>[0] = {}) {
  const fixture = await relationReadinessFixture({ persistence, writePolicy: true, bindingAdmission: true, cmsIndexes: true, ...options });
  const posts = await prepareCmsFixtureReadiness(fixture);
  await runEffect(fixture.fold.settle(fixture.input));
  await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
  const active = await runEffect(fixture.relationActivation.readActive());
  const targetInput = { deploymentId: fixture.deploymentId, canonicalPhysicalDatabaseIdentity: "cms-host-fixture", physicalLocator: active.basis.authority.physicalLocator };
  const target = "pool" in persistence ? await runEffect(makePostgresFrameworkMigrationTargetEffect({ ...targetInput, persistence })) :
    await runEffect(makePGliteFrameworkMigrationTargetEffect({ ...targetInput, persistence }));
  const bindings = await runEffect(makeDataBindingHost({ database: persistence.drizzle, deploymentId: fixture.deploymentId, target,
    authority: fixture.authorityPorts, application: fixture.relationActivation }));
  const reference = await runEffect(bindings.readApplicationReference());
  const policy = fixture.relation.binding;
  if (policy.version !== 3) throw new Error("Expected V3 write policy");
  const claims = policy.writePolicies.filter(policy => policy.owner === "payload");
  const first = claims[0];
  if (first?.owner !== "payload") throw new Error("Expected CMS ownership");
  const candidate = await runEffect(bindings.prepare({ format: "flarex.data-binding-set", version: 1, application: reference,
    payloadContent: { application: reference, configSha256: first.configSha256, provenanceSha256: first.provenanceSha256,
      tables: claims.map(claim => ({ tableId: claim.tableId.toString(), writePolicySha256: claim.writePolicySha256 })) },
    payloadLifecycle: null, commerce: null, crossDomainReferences: [] }));
  await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "cms-host-activate", candidate.sha256, null)));

  return { fixture, posts, bindings, reference, candidate, target };
}

export async function prepareCmsFixtureReadiness(fixture: Awaited<ReturnType<typeof relationReadinessFixture>>) {
  const posts = fixture.relation.binding.tables.find(table => table.logicalName === "posts");
  if (posts === undefined) throw new Error("Expected posts binding");
  for (const database of new Set([fixture.control.drizzle, fixture.persistence.drizzle])) {
    const unique = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(database, {
      deploymentId: fixture.deploymentId, schemaVersionId: fixture.relation.binding.schemaVersionId, tableId: posts.tableId,
      descriptor: SchemaManifestAppIndexDescriptorSchema.make("unique_title"),
      physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
        orderedFields: ["title"], sparse: false, localePolicy: { kind: "none" },
        keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 }),
    }));
    await database.transaction(tx => runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, unique)));
  }
  await prepareReadinessEvidence(fixture);
  const uniquePorts = { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts };
  const uniqueInput = { deploymentId: fixture.deploymentId, schemaVersionId: fixture.relation.binding.schemaVersionId };
  await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(uniquePorts, uniqueInput));
  let uniqueReady = false;
  for (let step = 0; step < 8; step += 1) {
    const advanced = await runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(uniquePorts, { ...uniqueInput, pageSize: 16 }));
    if (advanced.lifecycle === "enabled") { uniqueReady = true; break; }
  }
  expect(uniqueReady).toBe(true);
  return posts;
}
