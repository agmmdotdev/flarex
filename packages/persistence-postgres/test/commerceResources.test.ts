import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureCommerceResources, defaultCommerceResources } from "../src/commerceTransaction/resources";
import { registerCommerceProfile, registerLocalCommerceProfile, requireCommerceProfile } from "../src/commerceTransaction/profile";
import { commerceError } from "../src/commerceTransaction/model";
import { capturePrivateCanonicalValue } from "../src/frameworkSchema/privateCanonicalValue";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { currencySchemaInput, frameworkTargetNamespace, FRAMEWORK_VALUE_LOCATOR } from "./frameworkMigrationValueFixtures";

describe("trusted commerce resource contracts", () => {
  it("rejects unsafe ceilings, excess policy and incomplete query capacity", () => {
    for (const input of [null, { ...defaultCommerceResources, commandMs: 20000 },
      ...[0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 4097].map(facts => ({ ...defaultCommerceResources, facts })),
      { ...defaultCommerceResources, catalogRows: 257 }, { ...defaultCommerceResources, writeBatchRows: 257 }]) {
      expect(captureCommerceResources(input)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
    const source = { ...defaultCommerceResources, commandBytes: 4_194_304 };
    const captured = Result.getOrThrow(captureCommerceResources(source));
    source.commandBytes = 1;
    expect(captured.commandBytes).toBe(4_194_304);
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it("preserves both existing contract encodings and hashes every explicit resource dimension", async () => {
    const run = Effect.runPromise;
    const artifact = await run(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/resource-model", revision: "a".repeat(40), paths: ["model.ts"] },
      schema: { ...currencySchemaInput(), owner: "medusa" },
    }));
    const layout = await run(captureRelationalPhysicalLayout({ artifact: artifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    const declarations = [{ tableId: "currency", keyId: "currency.primary" }];
    const plain = await run(registerLocalCommerceProfile(artifact.artifact, layout, "test.resources", declarations).pipe(Effect.flatMap(requireCommerceProfile)));
    const initialization = { stepId: "test.seed", datasetSha256: "b".repeat(64), expectedRowCount: 7 };
    const scalar = await run(registerCommerceProfile(artifact.artifact, layout, "test.resources", initialization).pipe(Effect.flatMap(requireCommerceProfile)));
    const common = { format: "flarex.commerce-profile-contract", artifact: { ...artifact.artifact.identity }, layoutSha256: layout.layoutSha256, profileId: "test.resources" };
    const failures = { invalidInput: () => commerceError("invalidInput"), hashFailure: (cause: unknown) => commerceError("resourceFailure", cause) };
    expect(plain.contractSha256).toBe((await run(capturePrivateCanonicalValue({ ...common, version: 2, initialization: null,
      localEventPolicy: "buffer-until-confirmed-commit", tables: [{ tableId: "currency", keyId: "currency.primary", mode: "readInsert" }] }, 16384, failures))).sha256Hex);
    expect(scalar.contractSha256).toBe((await run(capturePrivateCanonicalValue({ ...common, version: 1, initialization }, 4096, failures))).sha256Hex);
    expect(plain.resources).toEqual(defaultCommerceResources);
    expect(scalar.resources).toEqual(defaultCommerceResources);
    const explicit = await run(registerLocalCommerceProfile(artifact.artifact, layout, "test.resources", declarations, defaultCommerceResources).pipe(Effect.flatMap(requireCommerceProfile)));
    expect(explicit.contractSha256).not.toBe(plain.contractSha256);
    for (const field of Object.keys(defaultCommerceResources)) {
      const resources = { ...defaultCommerceResources, [field]: 128 };
      // A smaller query requires the matching catalog to stay complete.
      if (field === "queryRows") resources.catalogRows = resources.writeBatchRows = 128;
      const changed = await run(registerLocalCommerceProfile(artifact.artifact, layout, "test.resources", declarations, resources).pipe(Effect.flatMap(requireCommerceProfile)));
      expect(changed.contractSha256).not.toBe(explicit.contractSha256);
    }
  });
});
