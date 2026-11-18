import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { captureRelationalSchemaArtifact } from "../../../src/storage/relationalSchema/artifact";
import { captureRelationalPhysicalLayout, verifyStoredRelationalPhysicalValue } from "../../../src/storage/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { FRAMEWORK_VALUE_LOCATOR, frameworkTargetNamespace } from "../../installation/frameworkSchema/frameworkMigrationValueFixtures";
import { numericLowerBoundSchemaInput } from "./numericLowerBoundFixture";

describe("canonical physical numeric lower bounds", () => {
  it("retains minima and refuses recomputed malformed checks or incompatible defaults", async () => {
    const artifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a", schema: numericLowerBoundSchemaInput(),
      provenance: { kind: "synthetic", fixtureId: "numeric-bound" } }));
    const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    expect(layout.frame.tables[0]?.checks.map(check => check.kind === "numericLowerBound" ? check.minimum : null)).toEqual(["0", "1.000000000000000001", "-1.25"]);
    expect(await runEffect(verifyStoredRelationalPhysicalValue({ kind: "physicalLayout", canonicalBytes: new TextEncoder().encode(layout.canonicalJson), sha256Hex: layout.layoutSha256 }))).toEqual(layout.frame);
    for (const replacement of [{ minimum: "-0" }, { minimum: "0\n" }, { minimum: "1; SELECT 1" }, { minimum: "0", maximum: "2" }, { minimum: "2" }]) {
      const changed = { ...layout.frame, tables: layout.frame.tables.map(table => ({ ...table,
        checks: table.checks.map(check => check.identity.constraintId === "entry.floor" ? { ...check, ...replacement } : check) })) };
      const canonical = encodeCanonicalJson(changed, cause => { throw cause; });
      expect(await runEffectFailure(verifyStoredRelationalPhysicalValue({ kind: "physicalLayout",
        canonicalBytes: new TextEncoder().encode(canonical), sha256Hex: createHash("sha256").update(canonical).digest("hex") }))).toMatchObject({ reason: "storedStateCorrupt" });
    }
  });
});
