import { createHash } from "node:crypto";

import { describe, expect, expectTypeOf, it } from "vitest";
import { encodeCanonicalJson } from "flarex-protocol/json";

// @ts-expect-error Migration coordination values must remain absent from root.
import type { FreshRelationalMigrationPlan as RootMigrationPlan } from "../src";
import {
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationAttemptTerminal,
  captureFrameworkMigrationCollisionHead,
  captureFrameworkMigrationEvent,
  captureFrameworkMigrationPlanAdmission,
  captureFrameworkMigrationStepReceipt,
  captureFreshRelationalMigrationPlan,
  classifyFrameworkMigrationPlanReplay,
  verifyStoredFrameworkMigrationValue,
} from "../src/migrationCoordination/canonical";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import {
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
} from "../src/migrationCoordination/model";
import { captureFrameworkSchemaTargetNamespace } from
  "../src/migrationCoordination/targetNamespace";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  completeFrameworkMigrationPlanSteps,
  expectDeeplyFrozen,
  FRAMEWORK_VALUE_LOCATOR,
  frameworkTargetNamespace,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";

type PublicMigrationValueExport = Extract<
  keyof typeof import("../src"),
  `${string}FrameworkMigration${string}` | `${string}MIGRATION_PLAN${string}`
>;

const T0 = "2026-09-02T00:00:00.000Z";
const T1 = "2026-09-02T00:01:00.000Z";
const EVIDENCE_SHA256 = "ab".repeat(32);

describe("private migration coordination values", () => {
  it("keeps the value family private", async () => {
    expectTypeOf<PublicMigrationValueExport>().toEqualTypeOf<never>();
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/canonical.ts",
    );
  });

  it("captures the alias-safe target namespace without logical routing names", async () => {
    const mutable = {
      deploymentId: "deployment-a",
      physicalDatabaseIdentity: "postgres-cluster-a/database-a",
      schemaName: "flarex_shared",
    };
    const target = await runEffect(
      captureFrameworkSchemaTargetNamespace(mutable),
    );
    mutable.physicalDatabaseIdentity = "changed";

    expect(target.frame).toEqual({
      format: "flarex.framework-schema-target-namespace",
      version: 1,
      deploymentId: "deployment-a",
      physicalDatabaseIdentity: "postgres-cluster-a/database-a",
      schemaName: "flarex_shared",
    });
    expect(target.frame).not.toHaveProperty("databaseKey");
    expect(target.frame).not.toHaveProperty("owner");
    expect(target.targetNamespaceSha256)
      .toBe(
        "82b91a76e8ddcacc5411ce3c374c975e7974342ed14ff2868febd03f9879a9f8",
      );
    expectDeeplyFrozen(target);
  });

  it("creates one deterministic fresh expansion plan with no SQL or callback surface", async () => {
    const { plan } = await planFixture();

    expect(plan.migrationPlanSha256).toBe(
      "d0d6d6e8ae02802d6dfd273be07977e76b04f6beb3928fec5e0ccb8a2f034c42",
    );
    expect(plan.frame.baseInstallation).toBeNull();
    expect(plan.frame.steps.map(step => step.operation.codec.format)).toEqual([
      "flarex.relational-create-table",
      "flarex.relational-create-table",
      "flarex.relational-create-index",
      "flarex.relational-add-foreign-key",
      "flarex.relational-add-foreign-key",
      "flarex.relational-add-foreign-key",
      "flarex.relational-validate-structure",
    ]);
    expect(plan.frame.steps.at(-1)?.dependencies).toHaveLength(6);
    expect(plan.frame.steps.slice(0, -1).every(step =>
      step.phase === "expansion" &&
      step.precondition.kind === "absentOrExact" &&
      step.postcondition.kind === "exact"
    )).toBe(true);
    expect(plan.frame.steps.at(-1)).toMatchObject({
      phase: "validation",
      precondition: { kind: "exact", projectionKind: "layout" },
      postcondition: { kind: "exact", projectionKind: "layout" },
      operation: {
        codec: { format: "flarex.relational-validate-structure" },
      },
    });
    expect(plan.frame.steps.map(step => [
      step.operation.codec.format,
      step.phase,
      step.precondition.projectionKind,
    ])).toEqual([
      ["flarex.relational-create-table", "expansion", "table"],
      ["flarex.relational-create-table", "expansion", "table"],
      ["flarex.relational-create-index", "expansion", "index"],
      ["flarex.relational-add-foreign-key", "expansion", "foreignKey"],
      ["flarex.relational-add-foreign-key", "expansion", "foreignKey"],
      ["flarex.relational-add-foreign-key", "expansion", "foreignKey"],
      ["flarex.relational-validate-structure", "validation", "layout"],
    ]);
    expect(plan.canonicalJson).not.toMatch(/\b(?:sql|callback|databaseHandle)\b/i);
    expect(plan.frame).not.toHaveProperty("installationSha256");
    expectDeeplyFrozen(plan);
  });

  it("captures the complete immutable ledger frame chain", async () => {
    const { plan } = await planFixture();
    const admission = await runEffect(captureFrameworkMigrationPlanAdmission({
      plan,
      nameAssignments: plan.physicalLayout.nameAssignments,
      previousPlanSha256: null,
      admittedAt: T0,
    }));
    const head = await runEffect(captureFrameworkMigrationCollisionHead({
      admission,
      headRevision: "1",
      attemptFence: "1",
      currentAttempt: null,
      lastEvent: null,
      updatedAt: T0,
    }));
    const attempt = await runEffect(captureFrameworkMigrationAttemptStart({
      admission,
      attemptId: "attempt-a",
      attemptFence: "1",
      leaseOwnerId: "worker-a",
      leaseExpiresAt: T1,
      previousAttemptId: null,
      startedAt: T0,
    }));
    const receipts = await completeFrameworkMigrationPlanSteps(plan, attempt, T1);
    const receipt = receipts[0];
    expect(receipt).toBeDefined();
    if (receipt === undefined) return;
    const terminal = await runEffect(captureFrameworkMigrationAttemptTerminal({
      attempt,
      outcome: {
        kind: "succeeded",
        requiredStepSetSha256: plan.requiredStepSetSha256,
      },
      stepReceipts: receipts,
      terminalAt: T1,
    }));
    const event = await runEffect(captureFrameworkMigrationEvent({
      format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
      version: FRAMEWORK_MIGRATION_EVENT_VERSION,
      collision: plan.frame.collision,
      sequence: head.frame.headRevision,
      previousEvent: null,
      recordedAt: attempt.frame.startedAt,
      kind: "planAdmitted",
      admissionSha256: admission.sha256,
    }));

    expect({
      admission: admission.sha256,
      head: head.sha256,
      attempt: attempt.sha256,
      receipt: receipt.sha256,
      terminal: terminal.sha256,
      event: event.sha256,
    }).toEqual({
      admission:
        "e0cdab33d8771ef8a8333a4eff5b771bbeb578d9614e3cb0659d92a53aee2371",
      head:
        "0e0a25afbc654585cc593f834ceb86a3a98b8bd3c4e43e5d45cb7c2c1f800292",
      attempt:
        "3bfd44637b061ec965277965cd15254b007aed59c80e373ef96c92db3310a005",
      receipt:
        "1fa33e7b86e3fb76981fe2cdc8701f0616628bcd53350d04a44670bfde53eae4",
      terminal:
        "b418d3ab615a4d6b6586579d1307b2068bcc69f78e2d602b38165b4cb3572844",
      event:
        "26b984b41212bf13073d4058c544002bf41bfc3ce9dc9ce49c6b7961d5d9acb5",
    });
    expect(receipt.frame).not.toHaveProperty("replayed");
    expectDeeplyFrozen(admission);
    expectDeeplyFrozen(head);
    expectDeeplyFrozen(attempt);
    expectDeeplyFrozen(receipt);
    expectDeeplyFrozen(terminal);
    expectDeeplyFrozen(event);
  });

  it("distinguishes exact replay from a changed locator-bound plan", async () => {
    const first = await planFixture();
    const second = await planFixture();
    expect(classifyFrameworkMigrationPlanReplay(first.plan, second.plan))
      .toBe("exact");

    const aliasLocator = {
      ...FRAMEWORK_VALUE_LOCATOR,
      databaseKey: "logical-alias",
    };
    const aliasLayout = await runEffect(captureRelationalPhysicalLayout({
      artifact: first.artifact.artifact,
      physicalLocator: aliasLocator,
      targetNamespace: await frameworkTargetNamespace(),
    }));
    const aliasPlan = await runEffect(captureFreshRelationalMigrationPlan({
      artifact: first.artifact.artifact,
      physicalLayout: aliasLayout,
    }));
    expect(aliasPlan.frame.collision).toEqual(first.plan.frame.collision);
    expect(classifyFrameworkMigrationPlanReplay(first.plan, aliasPlan))
      .toBe("differentPlan");
  });

  it("rejects forged assignment evidence before plan admission", async () => {
    const { plan } = await planFixture();
    const assignment = plan.physicalLayout.nameAssignments[0];
    expect(assignment).toBeDefined();
    if (assignment === undefined) return;
    const forged = {
      ...assignment,
      frame: {
        ...assignment.frame,
        spelling: `fxrt_${"0".repeat(52)}`,
      },
    };
    const failure = await runEffectFailure(
      captureFrameworkMigrationPlanAdmission({
        plan,
        nameAssignments: [
          forged,
          ...plan.physicalLayout.nameAssignments.slice(1),
        ],
        previousPlanSha256: null,
        admittedAt: T0,
      }),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "invalidInput",
    });
  });

  it("binds receipts and successful terminals to exact issued plan evidence", async () => {
    const first = await planFixture();
    const equalButDistinct = await planFixture();
    const admission = await runEffect(captureFrameworkMigrationPlanAdmission({
      plan: first.plan,
      nameAssignments: first.plan.physicalLayout.nameAssignments,
      previousPlanSha256: null,
      admittedAt: T0,
    }));
    const attempt = await runEffect(captureFrameworkMigrationAttemptStart({
      admission,
      attemptId: "attempt-provenance",
      attemptFence: "1",
      leaseOwnerId: "worker-a",
      leaseExpiresAt: T1,
      previousAttemptId: null,
      startedAt: T0,
    }));
    const foreignStep = equalButDistinct.plan.frame.steps[0];
    const firstStep = first.plan.frame.steps[0];
    expect(foreignStep).toBeDefined();
    expect(firstStep).toBeDefined();
    if (foreignStep === undefined || firstStep === undefined) return;

    const foreignStepFailure = await runEffectFailure(
      captureFrameworkMigrationStepReceipt({
        attempt,
        step: foreignStep,
        dependencyReceipts: [],
        observedPostconditionSha256: foreignStep.postconditionSha256,
        completedAt: T1,
      }),
    );
    const postconditionFailure = await runEffectFailure(
      captureFrameworkMigrationStepReceipt({
        attempt,
        step: firstStep,
        dependencyReceipts: [],
        observedPostconditionSha256: EVIDENCE_SHA256,
        completedAt: T1,
      }),
    );
    const incompleteTerminalFailure = await runEffectFailure(
      captureFrameworkMigrationAttemptTerminal({
        attempt,
        outcome: {
          kind: "succeeded",
          requiredStepSetSha256: first.plan.requiredStepSetSha256,
        },
        stepReceipts: [],
        terminalAt: T1,
      }),
    );
    const receipts = await completeFrameworkMigrationPlanSteps(
      first.plan,
      attempt,
      T1,
    );
    const dependentStep = first.plan.frame.steps.find(step =>
      step.dependencies.length > 1
    );
    expect(dependentStep).toBeDefined();
    if (dependentStep === undefined) return;
    const dependencyReceipt = receipts.find(receipt =>
      receipt.frame.stepId === dependentStep.dependencies[0]?.stepId
    );
    expect(dependencyReceipt).toBeDefined();
    if (dependencyReceipt === undefined) return;
    const duplicateDependencyFailure = await runEffectFailure(
      captureFrameworkMigrationStepReceipt({
        attempt,
        step: dependentStep,
        dependencyReceipts: [dependencyReceipt, dependencyReceipt],
        observedPostconditionSha256: dependentStep.postconditionSha256,
        completedAt: T1,
      }),
    );
    for (const failure of [
      foreignStepFailure,
      postconditionFailure,
      incompleteTerminalFailure,
      duplicateDependencyFailure,
    ]) {
      expect(failure).toMatchObject({
        _tag: "FrameworkMigrationValueError",
        reason: "invalidInput",
      });
    }
  });

  it("rejects recomputed stored target bytes with an unknown field", async () => {
    const target = await frameworkTargetNamespace();
    const altered = { ...target.frame, logicalDatabaseKey: "alias" };
    const canonicalJson = encodeCanonicalJson(altered, cause => {
      throw cause;
    });
    const failure = await runEffectFailure(verifyStoredFrameworkMigrationValue({
      kind: "targetNamespace",
      canonicalBytes: new TextEncoder().encode(canonicalJson),
      sha256Hex: createHash("sha256").update(canonicalJson).digest("hex"),
    }));
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });
  });

  it("rejects a recomputed stored plan with inconsistent nested step semantics", async () => {
    const { plan } = await planFixture();
    const finalStep = plan.frame.steps.at(-1);
    expect(finalStep).toBeDefined();
    if (finalStep === undefined) return;
    const altered = {
      ...plan.frame,
      steps: [
        ...plan.frame.steps.slice(0, -1),
        {
          ...finalStep,
          precondition: {
            ...finalStep.precondition,
            kind: "absentOrExact",
          },
        },
      ],
    };
    const canonicalJson = encodeCanonicalJson(altered, cause => {
      throw cause;
    });
    const failure = await runEffectFailure(verifyStoredFrameworkMigrationValue({
      kind: "plan",
      canonicalBytes: new TextEncoder().encode(canonicalJson),
      sha256Hex: createHash("sha256").update(canonicalJson).digest("hex"),
    }));
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });
  });

  it("rejects non-issuable stored admission assignment evidence", async () => {
    const { plan } = await planFixture();
    const admission = await runEffect(captureFrameworkMigrationPlanAdmission({
      plan,
      nameAssignments: plan.physicalLayout.nameAssignments,
      previousPlanSha256: null,
      admittedAt: T0,
    }));
    expect(admission.frame.nameAssignments.length).toBeGreaterThan(1);
    const candidates = [
      { ...admission.frame, nameAssignments: [] },
      {
        ...admission.frame,
        nameAssignments: admission.frame.nameAssignments.toReversed(),
      },
      {
        ...admission.frame,
        artifact: { ...admission.frame.artifact, owner: "medusa" },
        collision: { ...admission.frame.collision, owner: "medusa" },
      },
    ];
    for (const candidate of candidates) {
      const canonicalJson = encodeCanonicalJson(candidate, cause => {
        throw cause;
      });
      const failure = await runEffectFailure(
        verifyStoredFrameworkMigrationValue({
          kind: "planAdmission",
          canonicalBytes: new TextEncoder().encode(canonicalJson),
          sha256Hex: createHash("sha256").update(canonicalJson).digest("hex"),
        }),
      );
      expect(failure).toMatchObject({
        _tag: "FrameworkMigrationValueError",
        reason: "storedStateCorrupt",
      });
    }
  });

  it("rejects reordered stored dependency-receipt evidence", async () => {
    const { plan } = await planFixture();
    const admission = await runEffect(captureFrameworkMigrationPlanAdmission({
      plan,
      nameAssignments: plan.physicalLayout.nameAssignments,
      previousPlanSha256: null,
      admittedAt: T0,
    }));
    const attempt = await runEffect(captureFrameworkMigrationAttemptStart({
      admission,
      attemptId: "attempt-stored-order",
      attemptFence: "1",
      leaseOwnerId: "worker-a",
      leaseExpiresAt: T1,
      previousAttemptId: null,
      startedAt: T0,
    }));
    const receipts = await completeFrameworkMigrationPlanSteps(
      plan,
      attempt,
      T1,
    );
    const receipt = receipts.find(value =>
      value.frame.dependencyReceipts.length > 1
    );
    expect(receipt).toBeDefined();
    if (receipt === undefined) return;
    const candidate = {
      ...receipt.frame,
      dependencyReceipts: receipt.frame.dependencyReceipts.toReversed(),
    };
    const canonicalJson = encodeCanonicalJson(candidate, cause => {
      throw cause;
    });
    const failure = await runEffectFailure(
      verifyStoredFrameworkMigrationValue({
        kind: "stepReceipt",
        canonicalBytes: new TextEncoder().encode(canonicalJson),
        sha256Hex: createHash("sha256").update(canonicalJson).digest("hex"),
      }),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });
  });

  it("rejects recomputed plans not exactly derived from their physical layout", async () => {
    const { plan } = await planFixture();
    const finalStep = plan.frame.steps.at(-1);
    const firstDependency = finalStep?.dependencies[0];
    expect(finalStep).toBeDefined();
    expect(firstDependency).toBeDefined();
    if (finalStep === undefined || firstDependency === undefined) return;

    const { stepId: _stepId, stepSha256: _stepSha256, ...originalBody } =
      finalStep;
    const duplicateBody = {
      ...originalBody,
      dependencies: [...finalStep.dependencies, firstDependency],
    };
    const duplicateStepSha256 = hashCanonicalJson(duplicateBody);
    const duplicateStep = {
      ...duplicateBody,
      stepId: `step_${duplicateStepSha256.slice(0, 32)}`,
      stepSha256: duplicateStepSha256,
    };
    const candidates = [
      {
        ...plan.frame,
        artifact: {
          ...plan.frame.artifact,
          lineageId: "different-lineage",
        },
      },
      {
        ...plan.frame,
        steps: [...plan.frame.steps.slice(0, -1), duplicateStep],
      },
    ];
    for (const candidate of candidates) {
      const canonicalJson = encodeCanonicalJson(candidate, cause => {
        throw cause;
      });
      const failure = await runEffectFailure(
        verifyStoredFrameworkMigrationValue({
          kind: "plan",
          canonicalBytes: new TextEncoder().encode(canonicalJson),
          sha256Hex: createHash("sha256").update(canonicalJson).digest("hex"),
        }),
      );
      expect(failure).toMatchObject({
        _tag: "FrameworkMigrationValueError",
        reason: "storedStateCorrupt",
      });
    }
  });
});

function hashCanonicalJson(
  input: Parameters<typeof encodeCanonicalJson>[0],
): string {
  const canonicalJson = encodeCanonicalJson(input, cause => {
    throw cause;
  });
  return createHash("sha256").update(canonicalJson).digest("hex");
}

async function planFixture() {
  const artifact = await syntheticSystemArtifact();
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
    artifact: artifact.artifact,
    physicalLocator: FRAMEWORK_VALUE_LOCATOR,
    targetNamespace: await frameworkTargetNamespace(),
  }));
  const plan = await runEffect(captureFreshRelationalMigrationPlan({
    artifact: artifact.artifact,
    physicalLayout,
  }));
  return { artifact, plan };
}
