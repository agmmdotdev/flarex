import { captureRelationalPrimaryKey, decodeRelationalPrimaryKey, captureRelationalRowKey, decodeRelationalRowKey } from "../src/commitPublication/relationalFacts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { registerCommerceProfile, registerLocalCommerceProfile, requireCommerceProfile } from "../src/commerceTransaction/profile";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { captureFreshRelationalMigrationPlan, captureFrameworkMigrationPlanAdmission } from "../src/migrationCoordination/canonical";
import { currencySchemaInput, frameworkTargetNamespace, FRAMEWORK_VALUE_LOCATOR } from "./frameworkMigrationValueFixtures";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("private commerce profile admission", () => {
  it("binds a synthetic pair profile without Product names, primary IDs or initialization", async () => {
    const origin = { kind: "authored", sourceId: "test.assignment" };
    const artifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/assignment", revision: "d".repeat(40), paths: ["model.ts"] },
      schema: { owner: "medusa", lineageId: "synthetic-assignments", tables: [{ tableId: "assignment", origin,
        columns: ["left_ref", "right_ref"].map(columnId => ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
        keys: [{ keyId: "assignment.pair", kind: "unique", columns: ["left_ref", "right_ref"], origin }],
        indexes: [], constraints: [], relationships: [] }], capabilities: [] },
    }));
    const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    const profile = await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.assignment", [{ tableId: "assignment", keyId: "assignment.pair" }]));
    const descriptor = await runEffect(requireCommerceProfile(profile));
    expect(descriptor).toMatchObject({ localOnly: true, initialization: null, tables: [{ tableId: "assignment", keyId: "assignment.pair", mode: "readInsert" }] });
    const pair = await runEffect(captureRelationalRowKey(layout, "assignment", { left_ref: "one", right_ref: "two" }, "assignment.pair"));
    expect(pair.frame.components.map(component => component.columnId)).toEqual(["left_ref", "right_ref"]);
    await runEffectFailure(registerLocalCommerceProfile(artifact.artifact, layout, "test.assignment", [{ tableId: "product", keyId: "assignment.pair" }]));
    await runEffectFailure(registerLocalCommerceProfile(artifact.artifact, layout, "test.assignment", [{ tableId: "assignment", keyId: "id" }]));
    const plan = await runEffect(captureFreshRelationalMigrationPlan({ artifact: artifact.artifact, physicalLayout: layout, commerceProfile: profile }));
    expect(plan.frame.steps.length).toBeGreaterThan(0);
  });
  it("retains primary-key bytes and admits only a declared ordered text pair in codec 2", async () => {
    const schema = currencySchemaInput();
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing table");
    const artifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/test-model", revision: "a".repeat(40), paths: ["model.ts"] },
      schema: { ...schema, owner: "medusa", tables: [{ ...table, keys: [...table.keys,
        { keyId: "currency.pair", kind: "unique", columns: ["code", "name"], origin: { kind: "authored", sourceId: "currency.pair" } }] }] },
    }));
    const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    const primary = await runEffect(captureRelationalPrimaryKey(layout, "currency", { code: "usd" }));
    expect(primary.canonicalJson).toBe('{"components":[{"columnId":"code","type":"text","value":"usd"}],"format":"flarex.relational-primary-key","keyId":"currency.primary","version":1}');
    const pair = await runEffect(captureRelationalRowKey(layout, "currency", { code: "usd", name: "Dollar" }, "currency.pair"));
    expect(pair.frame).toEqual({ format: "flarex.relational-row-key", version: 2, keyId: "currency.pair",
      components: [{ columnId: "code", type: "text", value: "usd" }, { columnId: "name", type: "text", value: "Dollar" }] });
    const bytes = new TextEncoder().encode(pair.canonicalJson);
    expect(await runEffect(decodeRelationalRowKey(layout, "currency", bytes, 2))).toEqual(pair.frame);
    for (const key of ["missing", "currency.active"]) await runEffectFailure(captureRelationalRowKey(layout, "currency", { code: "usd", name: "Dollar" }, key));
    await runEffectFailure(captureRelationalRowKey(layout, "currency", { code: "usd", name: null }, "currency.pair"));
    await runEffectFailure(decodeRelationalRowKey(layout, "currency", bytes, 1));
    await runEffectFailure(decodeRelationalRowKey(layout, "other-table", bytes, 2));
    await runEffectFailure(decodeRelationalRowKey(layout, "currency", new TextEncoder().encode(JSON.stringify({ ...pair.frame, components: [...pair.frame.components].reverse() })), 2));
  });
  it("requires the live descriptor again at admission and keeps initialization requirements adapter-owned", async () => {
    const targetNamespace = await frameworkTargetNamespace();
    const artifact = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/test-model", revision: "a".repeat(40), paths: ["model.ts"] },
      schema: { ...currencySchemaInput(), owner: "medusa" },
    }));
    const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace }));
    for (const value of ["😀", "�"]) {
      const key = await runEffect(captureRelationalPrimaryKey(layout, "currency", { code: value }));
      expect(await runEffect(decodeRelationalPrimaryKey(layout, "currency", new TextEncoder().encode(key.canonicalJson)))).toEqual(key.frame);
    }
    for (const value of ["\ud800", "\udfff", "\0"]) expect(await runEffectFailure(captureRelationalPrimaryKey(layout, "currency", { code: value }))).toMatchObject({ reason: "invalidKey" });
    const profile = await runEffect(registerCommerceProfile(artifact.artifact, layout, "test.catalog", {
      stepId: "test.catalog-initialization", datasetSha256: "b".repeat(64), expectedRowCount: 7,
    }));
    const plan = await runEffect(captureFreshRelationalMigrationPlan({ artifact: artifact.artifact, physicalLayout: layout, commerceProfile: profile }));
    const input = { plan, nameAssignments: layout.nameAssignments, previousPlanSha256: null, admittedAt: "2026-09-07T00:00:00.000Z" };
    await runEffectFailure(captureFrameworkMigrationPlanAdmission(input));
    const admitted = await runEffect(captureFrameworkMigrationPlanAdmission({ ...input, commerceProfile: profile }));
    expect(admitted.frame.admissionProfile).toBe("registered-commerce-fresh");
    expect(admitted.frame.artifact).toEqual(artifact.artifact.identity);
    const alienArtifact = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a", provenance: { kind: "sourceSnapshot", repository: "https://example.com/other-model", revision: "c".repeat(40), paths: ["model.ts"] }, schema: { ...currencySchemaInput(), owner: "medusa" },
    }));
    const alienLayout = await runEffect(captureRelationalPhysicalLayout({ artifact: alienArtifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace }));
    const alien = await runEffect(registerCommerceProfile(alienArtifact.artifact, alienLayout, "test.catalog", {
      stepId: "test.catalog-initialization", datasetSha256: "b".repeat(64), expectedRowCount: 7,
    }));
    await runEffectFailure(captureFrameworkMigrationPlanAdmission({ ...input, commerceProfile: alien }));
    // A forged descriptor fails before any layout fields are read.
    expect(await runEffect(Effect.result(registerCommerceProfile(artifact.artifact, { ...layout }, "test.catalog", {
      stepId: "test.catalog-initialization", datasetSha256: "b".repeat(64), expectedRowCount: 7,
    })))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });
});
