import { Effect, Result, Schema } from "effect";
import { applicationSchemaPublicationFrameV3 } from "@flarex/analysis/internal/application-publication-v3";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { locateApplicationRelationManifestBindingEffect, publishApplicationRelationBindingEffect,
  type ApplicationRelationBindingRepository } from "../../../src/application/relations/binding";
import { fxControlBoundApplicationSchemas } from "../../../src/database/schema";
import { policyManifestFixture } from "./applicationWritePolicyFixture";
import { verifyStoredApplicationWritePolicyBinding } from "../../../src/application/ownership/applicationWritePolicyBinding";
import { runEffectFailure } from "../../support/effectTestRuntime";

const decodeFrameRecord = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
const encodeFrame = (frame: unknown) => new TextEncoder().encode(JSON.stringify(frame));

export async function applicationWritePolicyBindingScenario(repository: ApplicationRelationBindingRepository, deploymentId: string) {
  const fixture = await policyManifestFixture();
  const input = { ...fixture, deploymentId, decisions: [] };
  const first = await Effect.runPromise(publishApplicationRelationBindingEffect(repository, input));
  expect(first.status).toBe("created");
  expect(first.binding).toMatchObject({ version: 3, relationBindings: [], writePolicies: [
    { logicalName: "audit", owner: "application" }, { logicalName: "posts", owner: "payload" },
  ] });
  const replay = await Effect.runPromise(publishApplicationRelationBindingEffect(repository, input));
  expect(replay.status).toBe("existing");
  expect(replay.boundPublicationSha256).toBe(first.boundPublicationSha256);
  const next = await Effect.runPromise(publishApplicationRelationBindingEffect(repository, {
    ...await policyManifestFixture("4".repeat(64)), deploymentId, decisions: [],
  }));
  expect(next.binding).toEqual(first.binding);
  const locate = () => locateApplicationRelationManifestBindingEffect(repository.db, {
    deploymentId, applicationManifestSha256: fixture.manifestSha256,
  });
  const retained = await Effect.runPromise(locate());
  expect(retained?.relationBinding.binding).toEqual(first.binding);
  const schemaBytes = Result.getOrThrow(applicationSchemaPublicationFrameV3(fixture.manifest));
  await Effect.runPromise(verifyStoredApplicationWritePolicyBinding(first.binding, schemaBytes));
  const frame = decodeFrameRecord(JSON.parse(new TextDecoder().decode(schemaBytes)));
  const { validatorIdentityEncoding: _encoding, ...unmarkedFrame } = frame;
  const schema = decodeFrameRecord(frame.schema);
  // The current writer's explicit marker is mandatory independently of V3.
  for (const invalid of [
    unmarkedFrame,
    ...[1, 3, "2", null].map(validatorIdentityEncoding => ({ ...frame, validatorIdentityEncoding })),
    { ...frame, format: "unknown" },
    { ...frame, version: 2 },
    { ...frame, extra: true },
    { ...unmarkedFrame, schema: { ...schema, validatorIdentityEncoding: 2 } },
    { ...frame, schema: { ...schema, extra: true } },
    { ...frame, schema: { ...schema, version: 2 } },
  ]) {
    expect(await runEffectFailure(verifyStoredApplicationWritePolicyBinding(first.binding, encodeFrame(invalid))))
      .toMatchObject({ _tag: "ApplicationWritePolicyBindingError", reason: "invalidEvidence" });
  }
  // Marker admission never bypasses the policy/provenance/configuration checks.
  const policies = fixture.manifest.schema.writePolicies;
  for (const writePolicies of [
    { ...policies, provenance: { ...policies.provenance, release: "unknown" } },
    { ...policies, configuration: { ...policies.configuration, tables: policies.configuration.tables.map(table => ({
      ...table, fields: [{ name: "title", kind: "boolean" }],
    })) } },
  ]) {
    expect(await runEffectFailure(verifyStoredApplicationWritePolicyBinding(first.binding,
      encodeFrame({ ...frame, schema: { ...schema, writePolicies } }))))
      .toMatchObject({ _tag: "ApplicationWritePolicyBindingError", reason: "invalidEvidence" });
  }
  const changed = await policyManifestFixture("1".repeat(64), false, [{ name: "title", kind: "boolean" }]);
  expect(await runEffectFailure(verifyStoredApplicationWritePolicyBinding(first.binding,
    Result.getOrThrow(applicationSchemaPublicationFrameV3(changed.manifest)))))
    .toMatchObject({ _tag: "ApplicationWritePolicyBindingError", reason: "policyMismatch" });
  expect(await runEffectFailure(verifyStoredApplicationWritePolicyBinding(first.binding,
    encodeFrame({ ...frame, schema: { ...schema, writePolicySetSha256: "f".repeat(64) } }))))
    .toMatchObject({ _tag: "ApplicationWritePolicyBindingError", reason: "policyMismatch" });
  // Digest-correct JSON is not sufficient when it contradicts the retained bytes.
  if (first.binding.version !== 3) throw new Error("Expected V3 fixture");
  await repository.db.update(fxControlBoundApplicationSchemas).set({ bindingJson: {
    ...first.binding, writePolicySetSha256: "f".repeat(64),
  } }).where(eq(fxControlBoundApplicationSchemas.deploymentId, deploymentId));
  expect(Result.isFailure(await Effect.runPromise(Effect.result(locate())))).toBe(true);
}
