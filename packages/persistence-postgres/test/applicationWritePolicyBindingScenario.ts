import { Effect, Result } from "effect";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { locateApplicationRelationManifestBindingEffect, publishApplicationRelationBindingEffect,
  type ApplicationRelationBindingRepository } from "../src/applicationRelationBinding";
import { fxControlBoundApplicationSchemas } from "../src/schema";
import { policyManifestFixture } from "./applicationWritePolicyFixture";

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
  // Digest-correct JSON is not sufficient when it contradicts the retained bytes.
  if (first.binding.version !== 3) throw new Error("Expected V3 fixture");
  await repository.db.update(fxControlBoundApplicationSchemas).set({ bindingJson: {
    ...first.binding, writePolicySetSha256: "f".repeat(64),
  } }).where(eq(fxControlBoundApplicationSchemas.deploymentId, deploymentId));
  expect(Result.isFailure(await Effect.runPromise(Effect.result(locate())))).toBe(true);
}
