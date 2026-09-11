import { captureRelationalPrimaryKey, decodeRelationalPrimaryKey, captureRelationalRowKey, decodeRelationalRowKey } from "../src/commitPublication/relationalFacts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { registerCommerceProfile, registerLocalCommerceProfile, requireCommerceProfile } from "../src/commerceTransaction/profile";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { captureFreshRelationalMigrationPlan, captureFrameworkMigrationPlanAdmission } from "../src/migrationCoordination/canonical";
import { currencySchemaInput, syntheticSchemaInput, frameworkTargetNamespace, FRAMEWORK_VALUE_LOCATOR } from "./frameworkMigrationValueFixtures";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { validateCommerceProfileSet } from "../src/frameworkSchema/binding/commerceBinding";

describe("private commerce profile admission", () => {
  it("requires relational closure inside each shared-installation profile, including ungranted targets", async () => {
    const schema = syntheticSchemaInput();
    const parent = schema.tables.find(table => table.tableId === "parent");
    if (parent === undefined) throw new Error("Missing neutral parent fixture");
    const artifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/profile-closure", revision: "e".repeat(40), paths: ["model.ts"] },
      schema: { ...schema, owner: "medusa", tables: [...schema.tables, { ...parent, tableId: "independent",
        keys: [{ ...parent.keys[0], keyId: "independent.primary", kind: "primary", columns: ["id"] }] }] },
    }));
    const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    const descriptor = (id: string, tables: readonly string[]) => runEffect(registerLocalCommerceProfile(artifact.artifact, layout, id,
      tables.map(tableId => ({ tableId, keyId: `${tableId}.primary` }))).pipe(Effect.flatMap(requireCommerceProfile)));
    const child = await descriptor("test.child", ["child"]);
    const parentOnly = await descriptor("test.parent", ["parent"]);
    const independent = await descriptor("test.independent", ["independent"]);
    for (const selected of [[child, parentOnly], [child, independent], [parentOnly, independent]]) {
      expect(await runEffectFailure(validateCommerceProfileSet(selected))).toMatchObject({ reason: "unsupportedProfile" });
    }
    const closed = await descriptor("test.closed", ["child", "parent"]);
    expect(await runEffect(validateCommerceProfileSet([closed, independent]))).toBeUndefined();
  });

  it("keeps seeded singleton profiles supported but refuses a multi-profile seeded installation", async () => {
    const artifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/seed", revision: "e".repeat(40), paths: ["model.ts"] },
      schema: { ...currencySchemaInput(), owner: "medusa" },
    }));
    const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    const seeded = await runEffect(registerCommerceProfile(artifact.artifact, layout, "test.seed", { stepId: "seed", datasetSha256: "a".repeat(64), expectedRowCount: 1 }).pipe(Effect.flatMap(requireCommerceProfile)));
    const local = await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.local", [{ tableId: "currency", keyId: "currency.primary" }]).pipe(Effect.flatMap(requireCommerceProfile)));
    expect(await runEffect(validateCommerceProfileSet([seeded]))).toBeUndefined();
    expect(await runEffectFailure(validateCommerceProfileSet([seeded, local]))).toMatchObject({ reason: "unsupportedProfile" });
  });
  it("hashes managed lifecycle permission separately and refuses tables without declared lifecycle columns", async () => {
    const artifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/lifecycle", revision: "f".repeat(40), paths: ["model.ts"] },
      schema: { ...currencySchemaInput(), owner: "medusa" },
    }));
    const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    const declaration = { tableId: "currency", keyId: "currency.primary", update: "existingPrimaryKey" as const };
    const original = await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.lifecycle", [declaration]).pipe(Effect.flatMap(requireCommerceProfile)));
    const lifecycle = await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.lifecycle", [{ ...declaration, lifecycle: "managedSoftDelete" }]).pipe(Effect.flatMap(requireCommerceProfile)));
    expect(lifecycle.tables).toEqual([{ tableId: "currency", keyId: "currency.primary", mode: "readInsertUpdate", lifecycle: "managedSoftDelete" }]);
    expect(lifecycle.contractSha256).not.toBe(original.contractSha256);
    expect(await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.lifecycle", [declaration]).pipe(Effect.flatMap(requireCommerceProfile)))).toEqual(original);
    const plain = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/plain", revision: "f".repeat(40), paths: ["model.ts"] },
      schema: { ...syntheticSchemaInput(), owner: "medusa" },
    }));
    const plainLayout = await runEffect(captureRelationalPhysicalLayout({ artifact: plain.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    expect(await runEffectFailure(registerLocalCommerceProfile(plain.artifact, plainLayout, "test.lifecycle", [{ tableId: "child", keyId: "child.primary", lifecycle: "managedSoftDelete" }]))).toMatchObject({ reason: "unsupportedProfile" });
  });
  it("hashes separately admitted references and removal and rejects undeclared reference authority", async () => {
    const artifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/references", revision: "e".repeat(40), paths: ["model.ts"] },
      schema: { ...syntheticSchemaInput(), owner: "medusa" },
    }));
    const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    const base = { tableId: "child", keyId: "child.primary", update: "existingPrimaryKey" as const };
    const scalar = await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.references", [base]).pipe(Effect.flatMap(requireCommerceProfile)));
    const references = ["parent_id"];
    const expanded = await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.references", [{ ...base, referenceColumns: references, remove: "declaredKey" }]).pipe(Effect.flatMap(requireCommerceProfile)));
    references[0] = "id";
    expect(expanded.tables).toEqual([{ tableId: "child", keyId: "child.primary", mode: "readInsertUpdate", referenceColumns: ["parent_id"], remove: "declaredKey" }]);
    expect(expanded.contractSha256).not.toBe(scalar.contractSha256);
    expect(await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.references", [base]).pipe(Effect.flatMap(requireCommerceProfile)))).toEqual(scalar);
    for (const columns of [[], ["id"], ["ordinal"], ["scope_uuid"], ["missing"], ["parent_id", "parent_id"]]) {
      expect(await runEffectFailure(registerLocalCommerceProfile(artifact.artifact, layout, "test.references", [{ ...base, referenceColumns: columns }]))).toMatchObject({ reason: "unsupportedProfile" });
    }
    expect(await runEffectFailure(registerLocalCommerceProfile(artifact.artifact, layout, "test.references", [{ tableId: "child", keyId: "child.primary", referenceColumns: ["parent_id"] }]))).toMatchObject({ reason: "unsupportedProfile" });
  });
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
    const removable = await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.assignment", [{ tableId: "assignment", keyId: "assignment.pair", remove: "declaredKey" }]).pipe(Effect.flatMap(requireCommerceProfile)));
    expect(removable.contractSha256).not.toBe(descriptor.contractSha256);
    expect(removable.tables).toEqual([{ tableId: "assignment", keyId: "assignment.pair", mode: "readInsert", remove: "declaredKey" }]);
    await runEffectFailure(registerLocalCommerceProfile(artifact.artifact, layout, "test.assignment", [{ tableId: "product", keyId: "assignment.pair" }]));
    await runEffectFailure(registerLocalCommerceProfile(artifact.artifact, layout, "test.assignment", [{ tableId: "assignment", keyId: "id" }]));
    expect(await runEffectFailure(registerLocalCommerceProfile(artifact.artifact, layout, "test.assignment", [{ tableId: "assignment", keyId: "assignment.pair", update: "existingPrimaryKey" }])))
      .toMatchObject({ reason: "unsupportedProfile" });
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
    const declaration = { tableId: "currency", keyId: "currency.primary" };
    const readInsert = await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.keyed", [declaration]).pipe(Effect.flatMap(requireCommerceProfile)));
    const update = await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.keyed", [{ ...declaration, update: "existingPrimaryKey" }]).pipe(Effect.flatMap(requireCommerceProfile)));
    expect(update.tables).toEqual([{ ...declaration, mode: "readInsertUpdate" }]);
    expect(update.contractSha256).not.toBe(readInsert.contractSha256);
    expect(await runEffect(registerLocalCommerceProfile(artifact.artifact, layout, "test.keyed", [declaration]).pipe(Effect.flatMap(requireCommerceProfile))))
      .toEqual(readInsert);
    expect(await runEffectFailure(registerLocalCommerceProfile(artifact.artifact, layout, "test.keyed", [{ tableId: "currency", keyId: "currency.pair", update: "existingPrimaryKey" }])))
      .toMatchObject({ reason: "unsupportedProfile" });
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
