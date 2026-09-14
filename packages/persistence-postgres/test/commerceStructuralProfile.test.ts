import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile, requireCommerceProfile } from "../src/commerceTransaction/profile";
import { validateCommerceProfileSet } from "../src/frameworkSchema/binding/commerceBinding";
import { capturePrivateCanonicalValue } from "../src/frameworkSchema/privateCanonicalValue";
import { commerceError } from "../src/commerceTransaction/model";
import { defaultCommerceResources } from "../src/commerceTransaction/resources";
import { FRAMEWORK_VALUE_LOCATOR, frameworkTargetNamespace } from "./frameworkMigrationValueFixtures";
import { structuralCommerceProvenance, structuralCommerceSchema } from "./structuralCommerceSchema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

async function fixture(chain = false, extraTables = 0) {
  const { artifact } = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
    provenance: structuralCommerceProvenance, schema: structuralCommerceSchema(chain, extraTables) }));
  const layout = await runEffect(captureRelationalPhysicalLayout({ artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
  return { artifact, layout, issue: (id: string, data: readonly string[], structural?: readonly string[]) =>
    registerLocalCommerceProfile(artifact, layout, id, data.map(tableId => ({ tableId, keyId: `${tableId}.primary` })), undefined, structural)
      .pipe(Effect.flatMap(requireCommerceProfile)) };
}

describe("zero-access structural profile contracts", () => {
  it("captures and sorts structural ownership separately from data grants", async () => {
    const { issue } = await fixture();
    const selection = ["parent", "child"];
    const descriptor = await runEffect(issue("test.structural", ["independent"], selection));
    selection[0] = "missing";
    expect(descriptor.structuralTables).toEqual(["child", "parent"]);
    expect(Object.isFrozen(descriptor.structuralTables)).toBe(true);
    expect(descriptor.tables.map(table => table.tableId)).toEqual(["independent"]);
    expect(await runEffect(issue("test.structural", ["independent"], ["child", "parent"]))).toEqual(descriptor);
    expect(await runEffect(validateCommerceProfileSet([descriptor]))).toBeUndefined();
    const dataOwner = await runEffect(issue("test.owner", ["parent"], ["child"]));
    const independent = await runEffect(issue("test.independent", ["independent"]));
    expect(await runEffect(validateCommerceProfileSet([dataOwner, independent]))).toBeUndefined();
    for (const competing of [await runEffect(issue("test.child", ["child"])),
      await runEffect(issue("test.other", ["independent"], ["child", "parent"]))]) {
      expect(await runEffectFailure(validateCommerceProfileSet([dataOwner, competing]))).toMatchObject({ reason: "unsupportedProfile" });
    }
  });

  it("rejects malformed, overlapping, missing and unclosed declarations at issuance", async () => {
    const { artifact, layout, issue } = await fixture(true, 14);
    for (const structural of [["missing"], ["parent"], ["child", "child"], ["child"], ["child", "parent"], ["ancestor", "parent", "child"]]) {
      expect(await runEffectFailure(issue("test.parent", ["parent"], structural))).toMatchObject({ reason: "unsupportedProfile" });
    }
    expect(await runEffectFailure(issue("test.child", ["child"], ["parent"]))).toMatchObject({ reason: "unsupportedProfile" });
    expect(await runEffect(issue("test.child", ["child"], ["parent", "ancestor"]))).toMatchObject({ structuralTables: ["ancestor", "parent"] });
    expect(await runEffectFailure(issue("test.empty", [], ["child", "parent", "ancestor"]))).toMatchObject({ reason: "unsupportedProfile" });
    const extras = Array.from({ length: 14 }, (_, index) => `extra_${index}`);
    expect(await runEffect(issue("test.bound", ["independent", ...extras.slice(0, 12)], ["child", "parent", "ancestor"]))).toBeDefined();
    expect(await runEffectFailure(issue("test.bound", ["independent", ...extras.slice(0, 13)], ["child", "parent", "ancestor"]))).toMatchObject({ reason: "unsupportedProfile" });
    let reads = 0;
    const accessor = Object.defineProperty([], "0", { enumerable: true, get: () => { reads++; return "child"; } });
    expect(await runEffectFailure(issue("test.accessor", ["parent"], accessor))).toMatchObject({ reason: "invalidInput" });
    expect(reads).toBe(0);
    expect(await runEffectFailure(registerLocalCommerceProfile(artifact, { ...layout }, "test.forged", [{ tableId: "child", keyId: "child.primary" }], undefined, ["parent", "ancestor"])))
      .toMatchObject({ reason: "unsupportedProfile" });
    const alien = await fixture();
    expect(await runEffectFailure(registerLocalCommerceProfile(alien.artifact, layout, "test.alien", [{ tableId: "child", keyId: "child.primary" }], undefined, ["parent", "ancestor"])))
      .toMatchObject({ reason: "unsupportedProfile" });
  });

  it("keeps omitted and empty declarations on the exact legacy encodings", async () => {
    const { artifact, layout, issue } = await fixture();
    for (const resourceContract of [undefined, defaultCommerceResources]) for (const update of [undefined, "existingPrimaryKey" as const]) {
      const capabilities = [{ tableId: "child", keyId: "child.primary", ...(update === undefined ? {} : { update }) }];
      const original = await runEffect(registerLocalCommerceProfile(artifact, layout, "test.legacy", capabilities, resourceContract).pipe(Effect.flatMap(requireCommerceProfile)));
      const empty = await runEffect(registerLocalCommerceProfile(artifact, layout, "test.legacy", capabilities, resourceContract, []).pipe(Effect.flatMap(requireCommerceProfile)));
      expect(empty).toEqual(original);
      const legacy = await runEffect(capturePrivateCanonicalValue({ format: "flarex.commerce-profile-contract",
        version: resourceContract === undefined ? update === undefined ? 2 : 3 : 6,
        artifact: { ...artifact.identity }, layoutSha256: layout.layoutSha256, profileId: "test.legacy", initialization: null,
        localEventPolicy: "buffer-until-confirmed-commit", ...(resourceContract === undefined ? {} : { resources: resourceContract }),
        tables: [{ tableId: "child", keyId: "child.primary", mode: update === undefined ? "readInsert" : "readInsertUpdate" }] }, 16_384,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
      expect(empty.contractSha256).toBe(legacy.sha256Hex);
      expect(await runEffect(validateCommerceProfileSet([empty]))).toBeUndefined();
    }
    const legacy = await runEffect(issue("test.child", ["child"]));
    const structural = await runEffect(issue("test.child", ["child"], ["parent"]));
    expect(structural.contractSha256).not.toBe(legacy.contractSha256);
    const independent = await runEffect(issue("test.independent", ["independent"]));
    expect(await runEffectFailure(validateCommerceProfileSet([legacy, independent]))).toMatchObject({ reason: "unsupportedProfile" });
  });
});
