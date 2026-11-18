import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { captureRelationalSchemaArtifact } from "../../../src/storage/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../../../src/storage/relationalSchema/physical/canonical";
import { FRAMEWORK_VALUE_LOCATOR, frameworkTargetNamespace } from "../../installation/frameworkSchema/frameworkMigrationValueFixtures";

describe("non-null ordered predicates preserve physical profile refusal", () => {
  it.each([
    { kind: "isNotNull", columnId: "parent" },
    { kind: "isNullAndNotNull", nullColumnId: "retired", notNullColumnId: "parent" },
  ])("refuses $kind through the historical physical layout owner", async predicate => {
    const origin = { kind: "synthetic", sourceId: "neutral-non-null-physical-refusal" };
    const captured = await Effect.runPromise(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/non-null", revision: "d".repeat(40), paths: ["model.ts"] },
      schema: { owner: "medusa", lineageId: "non-null-physical-refusal", capabilities: [], tables: [{
        tableId: "entries", origin, columns: ["id", "parent", "retired"].map(columnId => ({
          columnId, type: "text", nullable: columnId !== "id", default: { kind: "none" }, origin,
        })), keys: [{ keyId: "entries.primary", kind: "primary", columns: ["id"], origin }],
        indexes: [{ indexId: "entries.member", kind: "btree", columns: ["parent"], predicate, origin }],
        constraints: [], relationships: [],
      }] },
    }));
    expect(await Effect.runPromise(Effect.result(captureRelationalPhysicalLayout({ artifact: captured.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedArtifact" } });
  });
});
