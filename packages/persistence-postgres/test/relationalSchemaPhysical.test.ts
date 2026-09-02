import { createHash } from "node:crypto";

import { describe, expect, expectTypeOf, it } from "vitest";
import { encodeCanonicalJson } from "flarex-protocol/json";

// @ts-expect-error Relational physical values must remain absent from root.
import type { RelationalPhysicalLayout as RootPhysicalLayout } from "../src";
import { captureRelationalSchemaArtifact } from
  "../src/relationalSchema/artifact";
import {
  captureRelationalPhysicalLayout,
  classifyRelationalPhysicalNameAssignmentReplay,
  encodeLowercaseBase32Hex,
  verifyStoredRelationalPhysicalValue,
} from "../src/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  currencyArtifact,
  expectDeeplyFrozen,
  FRAMEWORK_VALUE_LOCATOR,
  frameworkTargetNamespace,
  syntheticSchemaInput,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";

type PublicPhysicalExport = Extract<
  keyof typeof import("../src"),
  `${string}RelationalPhysical${string}` | `${string}RELATIONAL_PHYSICAL${string}`
>;

describe("private relational physical values", () => {
  it("remains absent from root and package export surfaces", async () => {
    expectTypeOf<PublicPhysicalExport>().toEqualTypeOf<never>();
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/relationalSchema/physical/canonical.ts",
    );
  });

  it("pins the domain-owned lowercase unpadded RFC 4648 base32hex codec", () => {
    const utf8 = new TextEncoder();
    expect(encodeLowercaseBase32Hex(utf8.encode(""))).toBe("");
    expect(encodeLowercaseBase32Hex(utf8.encode("f"))).toBe("co");
    expect(encodeLowercaseBase32Hex(utf8.encode("fo"))).toBe("cpng");
    expect(encodeLowercaseBase32Hex(utf8.encode("foo"))).toBe("cpnmu");
    expect(encodeLowercaseBase32Hex(utf8.encode("foobar")))
      .toBe("cpnmuoj1e8");
  });

  it("lowers every structural definition with stable 57-byte names and scope prefixes", async () => {
    const artifact = await syntheticSystemArtifact();
    const targetNamespace = await frameworkTargetNamespace();
    const layout = await runEffect(captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace,
    }));

    expect(layout.layoutSha256).toBe(
      "f30364856dcde3fb5d6a6c6ace40e58f005db730290e2a2bc66f8f8358117a61",
    );
    expect(layout.nameAssignments[0]?.frame.nameSha256).toBe(
      "597398c84efe632e2b82811a6a38838394f63b220c6201fecb535707380fda75",
    );
    expect(layout.nameAssignments[0]?.assignmentSha256).toBe(
      "dd612e91fc6b4984baec80dd926532d79d5bd4c39e5ccac3c24c87f59d98436d",
    );
    const assignmentsByKind = new Map(layout.nameAssignments.map(assignment =>
      [assignment.frame.name.subject.kind, assignment.frame.spelling]
    ));
    expect(assignmentsByKind.get("table")).toMatch(/^fxrt_[0-9a-v]{52}$/);
    expect(assignmentsByKind.get("column")).toMatch(/^fxrc_[0-9a-v]{52}$/);
    expect(assignmentsByKind.get("key")).toMatch(/^fxrk_[0-9a-v]{52}$/);
    expect(assignmentsByKind.get("index")).toMatch(/^fxri_[0-9a-v]{52}$/);
    expect(assignmentsByKind.get("foreignKey"))
      .toMatch(/^fxrf_[0-9a-v]{52}$/);
    expect(assignmentsByKind.get("checkConstraint"))
      .toMatch(/^fxrh_[0-9a-v]{52}$/);
    expect(assignmentsByKind.get("scopeAuthorityForeignKey"))
      .toMatch(/^fxrf_[0-9a-v]{52}$/);
    for (const assignment of layout.nameAssignments) {
      expect(new TextEncoder().encode(assignment.frame.spelling).byteLength)
        .toBe(57);
    }

    const child = layout.frame.tables.find(table =>
      table.identity.tableId === "child"
    );
    expect(child?.scopeColumn).toEqual({
      name: "scope_uuid",
      type: "uuid",
      nullable: false,
    });
    expect(child?.keys.map(key => key.columns[0])).toEqual([
      "scope_uuid",
      "scope_uuid",
    ]);
    expect(child?.indexes[0]?.columns[0]).toBe("scope_uuid");
    expect(layout.frame.foreignKeys).toHaveLength(3);
    expect(layout.frame.foreignKeys.every(foreignKey =>
      foreignKey.sourceColumns[0] === "scope_uuid" &&
      foreignKey.targetColumns[0] === "scope_uuid"
    )).toBe(true);
    expect(layout.frame.relationships).toMatchObject([{
      kind: "oneToOne",
      sourceUnique: true,
    }]);
    expectDeeplyFrozen(layout);
  });

  it("captures the exact physical-locator values it validates", async () => {
    let databaseKeyReads = 0;
    const physicalLocator = new Proxy({ ...FRAMEWORK_VALUE_LOCATOR }, {
      get: (target, property, receiver) => {
        if (property !== "databaseKey") {
          return Reflect.get(target, property, receiver);
        }
        databaseKeyReads += 1;
        return databaseKeyReads === 1 ? target.databaseKey : "x".repeat(513);
      },
    });
    const artifact = await syntheticSystemArtifact();
    const layout = await runEffect(captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator,
      targetNamespace: await frameworkTargetNamespace(),
    }));

    expect(databaseKeyReads).toBe(0);
    expect(layout.frame.physicalLocator).toEqual(FRAMEWORK_VALUE_LOCATOR);
  });

  it("keeps physical evidence separate from residual runtime behavior", async () => {
    const artifact = await currencyArtifact();
    const layout = await runEffect(captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace: await frameworkTargetNamespace(),
    }));

    expect(layout.frame.requiredPhysicalCapabilities.map(capability => [
      capability.kind,
      capability.residualRequirement,
    ])).toEqual([
      ["exactNumericCompanion", "exactNumericCompanionWriteBehavior"],
      ["searchableText", "searchableTextQueryBehavior"],
      ["softDelete", "softDeleteStoreBehavior"],
      ["managedTimestamps", "managedTimestampUpdateBehavior"],
    ]);
    expect(layout.frame.requiredPhysicalCapabilities).not.toContainEqual(
      expect.objectContaining({ runtimeSatisfied: true }),
    );
  });

  it("keeps an authored scope-authority constraint distinct from the implicit scope foreign key", async () => {
    const schema = syntheticSchemaInput();
    const ordinaryConstraint = schema.tables[0]?.constraints[0];
    const relationship = schema.tables[0]?.relationships[0];
    expect(ordinaryConstraint).toBeDefined();
    expect(relationship).toBeDefined();
    if (ordinaryConstraint === undefined || relationship === undefined) return;
    ordinaryConstraint.constraintId = "scope-authority";
    relationship.foreignKeyConstraintId = "scope-authority";
    const artifact = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a",
      provenance: { kind: "synthetic", fixtureId: "sentinel-collision" },
      schema,
    }));
    const layout = await runEffect(captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace: await frameworkTargetNamespace(),
    }));
    const ordinary = layout.frame.foreignKeys.find(foreignKey =>
      foreignKey.kind === "foreignKey" &&
      foreignKey.identity.constraintId === "scope-authority"
    );
    const implicit = layout.frame.foreignKeys.find(foreignKey =>
      foreignKey.kind === "scopeAuthorityForeignKey" &&
      foreignKey.table.tableId === "child"
    );
    expect(ordinary).toBeDefined();
    expect(implicit).toBeDefined();
    expect(ordinary?.name).not.toBe(implicit?.name);
    expect(layout.nameAssignments.find(assignment =>
      assignment.frame.name.subject.kind === "foreignKey" &&
      assignment.frame.name.subject.identity.constraintId ===
        "scope-authority"
    )?.frame.spelling).toBe(ordinary?.name);
  });

  it("classifies exact historical replay separately from a same-spelling preimage collision", async () => {
    const artifact = await syntheticSystemArtifact();
    const layout = await runEffect(captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace: await frameworkTargetNamespace(),
    }));
    const assignment = layout.nameAssignments[0];
    expect(assignment).toBeDefined();
    if (assignment === undefined) return;

    expect(classifyRelationalPhysicalNameAssignmentReplay(
      assignment.frame,
      assignment.frame,
    )).toBe("exact");
    expect(classifyRelationalPhysicalNameAssignmentReplay(
      assignment.frame,
      {
        ...assignment.frame,
        nameCanonicalJson: `${assignment.frame.nameCanonicalJson} `,
      },
    )).toBe("physicalNameCollision");
  });

  it("rejects recomputed stored layouts with unknown or inconsistent nested evidence", async () => {
    const artifact = await syntheticSystemArtifact();
    const layout = await runEffect(captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace: await frameworkTargetNamespace(),
    }));
    const verified = await runEffect(verifyStoredRelationalPhysicalValue({
      kind: "physicalLayout",
      canonicalBytes: new TextEncoder().encode(layout.canonicalJson),
      sha256Hex: layout.layoutSha256,
    }));
    expect(verified).toEqual(layout.frame);

    const altered = { ...layout.frame, unexpected: true };
    const alteredCanonical = encodeCanonicalJson(altered, cause => {
      throw cause;
    });
    const failure = await runEffectFailure(
      verifyStoredRelationalPhysicalValue({
        kind: "physicalLayout",
        canonicalBytes: new TextEncoder().encode(alteredCanonical),
        sha256Hex: createHash("sha256").update(alteredCanonical).digest("hex"),
      }),
    );
    expect(failure).toMatchObject({
      _tag: "RelationalPhysicalValueError",
      reason: "storedStateCorrupt",
    });

    const firstAssignment = layout.frame.nameAssignments[0];
    expect(firstAssignment).toBeDefined();
    if (firstAssignment === undefined) return;
    const nestedAltered = {
      ...layout.frame,
      nameAssignments: [
        {
          ...firstAssignment,
          spelling: `${firstAssignment.spelling.slice(0, 5)}${"0".repeat(52)}`,
        },
        ...layout.frame.nameAssignments.slice(1),
      ],
    };
    const nestedCanonical = encodeCanonicalJson(nestedAltered, cause => {
      throw cause;
    });
    const nestedFailure = await runEffectFailure(
      verifyStoredRelationalPhysicalValue({
        kind: "physicalLayout",
        canonicalBytes: new TextEncoder().encode(nestedCanonical),
        sha256Hex: createHash("sha256").update(nestedCanonical).digest("hex"),
      }),
    );
    expect(nestedFailure).toMatchObject({
      _tag: "RelationalPhysicalValueError",
      reason: "storedStateCorrupt",
    });

    const mismatchedName = {
      ...firstAssignment.name,
      subject: {
        ...firstAssignment.name.subject,
        identity: {
          ...firstAssignment.name.subject.identity,
          owner: "medusa",
        },
      },
    };
    const mismatchedNameCanonical = encodeCanonicalJson(
      mismatchedName,
      cause => {
        throw cause;
      },
    );
    const mismatchedNameFailure = await runEffectFailure(
      verifyStoredRelationalPhysicalValue({
        kind: "physicalName",
        canonicalBytes: new TextEncoder().encode(mismatchedNameCanonical),
        sha256Hex: createHash("sha256").update(mismatchedNameCanonical)
          .digest("hex"),
      }),
    );
    expect(mismatchedNameFailure).toMatchObject({
      _tag: "RelationalPhysicalValueError",
      reason: "storedStateCorrupt",
    });
  });

  it("rejects recomputed layouts outside the exact captured physical graph", async () => {
    const artifact = await syntheticSystemArtifact();
    const layout = await runEffect(captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace: await frameworkTargetNamespace(),
    }));
    const firstTable = layout.frame.tables[0];
    const firstColumn = firstTable?.columns[0];
    const ordinaryForeignKey = layout.frame.foreignKeys.find(value =>
      value.kind === "foreignKey"
    );
    const relationship = layout.frame.relationships[0];
    expect(firstTable).toBeDefined();
    expect(firstColumn).toBeDefined();
    expect(ordinaryForeignKey).toBeDefined();
    expect(relationship).toBeDefined();
    if (firstTable === undefined || firstColumn === undefined ||
      ordinaryForeignKey === undefined || relationship === undefined) return;

    const cases = [
      {
        ...layout.frame,
        nameAssignments: [],
      },
      {
        ...layout.frame,
        artifact: {
          ...layout.frame.artifact,
          lineageId: "different-lineage",
        },
      },
      {
        ...layout.frame,
        tables: [
          {
            ...firstTable,
            columns: [
              {
                ...firstColumn,
                default: {
                  kind: "exactNumericLiteral",
                  value: "not-a-number",
                },
              },
              ...firstTable.columns.slice(1),
            ],
          },
          ...layout.frame.tables.slice(1),
        ],
      },
      {
        ...layout.frame,
        foreignKeys: layout.frame.foreignKeys.map(value =>
          value === ordinaryForeignKey
            ? { ...value, targetTableName: firstTable.name }
            : value
        ),
      },
      {
        ...layout.frame,
        relationships: Array.from({ length: 257 }, (_, index) => ({
          ...relationship,
          identity: {
            ...relationship.identity,
            relationshipId: `relationship-${index.toString().padStart(3, "0")}`,
          },
        })),
      },
    ];
    for (const candidate of cases) {
      await expectStoredLayoutCorruption(candidate);
    }
  });

  it("rejects recomputed capability evidence that does not resolve exactly", async () => {
    const artifact = await currencyArtifact();
    const layout = await runEffect(captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace: await frameworkTargetNamespace(),
    }));
    const searchable = layout.frame.requiredPhysicalCapabilities.find(value =>
      value.kind === "searchableText"
    );
    const replacement = layout.frame.tables[0]?.columns.find(column =>
      column.identity.columnId === "created_at"
    );
    expect(searchable).toBeDefined();
    expect(replacement).toBeDefined();
    if (searchable === undefined || searchable.kind !== "searchableText" ||
      replacement === undefined) return;
    const firstReference = searchable.columns[0];
    expect(firstReference).toBeDefined();
    if (firstReference === undefined) return;

    await expectStoredLayoutCorruption({
      ...layout.frame,
      requiredPhysicalCapabilities:
        layout.frame.requiredPhysicalCapabilities.map(value =>
          value === searchable
            ? {
                ...value,
                columns: [
                  { ...firstReference, columnName: replacement.name },
                  ...value.columns.slice(1),
                ],
              }
            : value
        ),
    });
  });
});

async function expectStoredLayoutCorruption(
  frame: Parameters<typeof encodeCanonicalJson>[0],
): Promise<void> {
  const canonicalJson = encodeCanonicalJson(frame, cause => {
    throw cause;
  });
  const failure = await runEffectFailure(verifyStoredRelationalPhysicalValue({
    kind: "physicalLayout",
    canonicalBytes: new TextEncoder().encode(canonicalJson),
    sha256Hex: createHash("sha256").update(canonicalJson).digest("hex"),
  }));
  expect(failure).toMatchObject({
    _tag: "RelationalPhysicalValueError",
    reason: "storedStateCorrupt",
  });
}
