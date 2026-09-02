import { createHash } from "node:crypto";

import { compareUtf16Strings } from "@flarex/utils/strings";
import { Brand } from "effect";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import {
  captureFrameworkSchemaAvailabilityHead,
  captureFrameworkSchemaAvailabilityHistory,
  captureFrameworkSchemaInstallation,
  captureFrameworkSchemaReadiness,
} from
  "../src/frameworkSchema/installation/canonical";
import {
  restoreStoredFrameworkSchemaAvailabilityHeadMetadata,
  restoreStoredFrameworkSchemaAvailabilityHistoryMetadata,
  restoreStoredFrameworkSchemaInstallationMetadata,
  restoreStoredFrameworkSchemaReadinessMetadata,
  type RestoredFrameworkSchemaAvailabilityHistory,
} from "../src/frameworkSchema/installation/storedMetadataRestoration";
import { captureRelationalSchemaArtifact } from
  "../src/relationalSchema/artifact";
import {
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationAttemptTerminal,
  captureFrameworkMigrationCollisionHead,
  captureFrameworkMigrationEvent,
  captureFrameworkMigrationPlanAdmission,
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
  type FrameworkMigrationEventFrame,
} from "../src/migrationCoordination/model";
import type { CanonicalNonNegativeInt64 } from
  "../src/migrationCoordination/identity";
import {
  restoreStoredFrameworkMigrationCollisionHead,
  restoreStoredFrameworkMigrationEvent,
} from "../src/migrationCoordination/storedEventRestoration";
import {
  restoreStoredFrameworkMigrationAttemptStart,
  restoreStoredFrameworkMigrationAttemptTerminal,
  restoreStoredFrameworkMigrationCollisionDomain,
  restoreStoredFrameworkMigrationPlanAdmission,
  restoreStoredFrameworkMigrationStepReceipt,
  restoreStoredFrameworkSchemaTargetNamespace,
  restoreStoredFreshRelationalMigrationPlan,
  restoreStoredRelationalPhysicalNameAssignment,
  type RestoredFrameworkMigrationStepReceipt,
} from "../src/migrationCoordination/storedRestoration";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  completeFrameworkMigrationPlanSteps,
  expectDeeplyFrozen,
  FRAMEWORK_VALUE_LOCATOR,
  frameworkTargetNamespace,
  syntheticSchemaInput,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";

const T0 = "2026-09-02T00:00:00.000Z";
const T1 = "2026-09-02T00:01:00.000Z";
const T2 = "2026-09-02T00:02:00.000Z";
const VALIDATION_SHA256 = "11".repeat(32);
const AVAILABILITY_REASON_SHA256 = "22".repeat(32);
const eventSequence = Brand.nominal<CanonicalNonNegativeInt64>();

describe("framework coordinator stored restoration", () => {
  it("keeps cold-restoration operations source-private", async () => {
    expect("restoreStoredFreshRelationalMigrationPlan" in persistenceRoot)
      .toBe(false);
    expect("restoreStoredFrameworkSchemaInstallationMetadata" in persistenceRoot)
      .toBe(false);
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/storedRestoration.ts",
    );
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/frameworkSchema/installation/storedMetadataRestoration.ts",
    );
  });

  it("rehydrates the exact dependency graph into the live private authority", async () => {
    const values = await restoreMigrationGraph();

    expect(values.restoredPlan.plan).toEqual(values.plan);
    expect(values.restoredPlan.plan).not.toBe(values.plan);
    expect(values.restoredAdmission.admission).toEqual(values.admission);
    expect(values.restoredAdmission.admission).not.toBe(values.admission);
    expect(values.restoredAttempt.attempt).toEqual(values.attempt);
    expect(values.restoredAttempt.attempt).not.toBe(values.attempt);
    expect(values.restoredTerminal.terminal).toEqual(values.terminal);
    expect(values.restoredTerminal.terminal).not.toBe(values.terminal);
    expect(values.restoredInstallation.installation)
      .toEqual(values.installation);
    expect(values.restoredReadiness.readiness).toEqual(values.readiness);
    expect(values.restoredAvailabilityHead.head)
      .toEqual(values.availabilityHead);
    expect(values.restoredCollisionHead.head).toEqual(values.collisionHead);
    expectDeeplyFrozen(values.restoredPlan);
    expectDeeplyFrozen(values.restoredAdmission);
    expectDeeplyFrozen(values.restoredAttempt);
    expectDeeplyFrozen(values.restoredTerminal);
    expectDeeplyFrozen(values.restoredInstallation);
    expectDeeplyFrozen(values.restoredReadiness);
    expectDeeplyFrozen(values.restoredAvailabilityHead);
    expectDeeplyFrozen(values.restoredCollisionHead);

    const installation = await runEffect(captureFrameworkSchemaInstallation({
      plan: values.restoredPlan.plan,
      admission: values.restoredAdmission.admission,
      terminal: values.restoredTerminal.terminal,
      installedStructureSha256:
        values.restoredPlan.plan.physicalLayout.layoutSha256,
      installedPhysicalCapabilities: [
        ...values.restoredPlan.plan.physicalLayout.frame
          .requiredPhysicalCapabilities,
      ],
      installedAt: T1,
    }));
    expect(installation.frame.identity.migrationPlanSha256)
      .toBe(values.plan.migrationPlanSha256);

    const nextHistory = await runEffect(
      captureFrameworkSchemaAvailabilityHistory({
        readiness: values.restoredReadiness.readiness,
        previous: values.restoredAvailabilityHistory.at(-1)?.history ?? null,
        status: "superseded",
        reasonSha256: AVAILABILITY_REASON_SHA256,
        recordedAt: T2,
      }),
    );
    expect(nextHistory.frame.availabilitySequence).toBe("3");
  });

  it("rejects altered bytes, projection laundering, reordered sidecars, and forged dependencies", async () => {
    const fresh = await freshMigrationGraph();
    const rows = storedRows(fresh);
    const corruptBytes = new Uint8Array(rows.target.canonicalBytes);
    corruptBytes[corruptBytes.byteLength - 2] = 0x20;
    const byteFailure = await runEffectFailure(
      restoreStoredFrameworkSchemaTargetNamespace({
        ...rows.target,
        canonicalBytes: corruptBytes,
      }),
    );
    expect(byteFailure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });

    const target = await runEffect(
      restoreStoredFrameworkSchemaTargetNamespace(rows.target),
    );
    const collision = await runEffect(
      restoreStoredFrameworkMigrationCollisionDomain(rows.collision, target),
    );
    const assignments = [];
    for (let index = 0; index < rows.assignments.length; index += 1) {
      const row = rows.assignments[index];
      if (row === undefined) throw new Error("Missing assignment fixture row");
      assignments.push(await runEffect(
        restoreStoredRelationalPhysicalNameAssignment(row, collision),
      ));
    }
    const sidecarFailure = await runEffectFailure(
      restoreStoredFreshRelationalMigrationPlan({
        row: rows.plan,
        stepRows: rows.planSteps.toReversed(),
        dependencyRows: rows.planDependencies,
        targetNamespace: target,
        collision,
        nameAssignments: assignments,
      }),
    );
    expect(sidecarFailure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });

    const plan = await runEffect(
      restoreStoredFreshRelationalMigrationPlan({
        row: rows.plan,
        stepRows: rows.planSteps,
        dependencyRows: rows.planDependencies,
        targetNamespace: target,
        collision,
        nameAssignments: assignments,
      }),
    );
    const alteredArtifactFrame = {
      ...fresh.admission.frame,
      artifact: {
        ...fresh.admission.frame.artifact,
        artifactSha256: "33".repeat(32),
      },
    };
    const alteredArtifact = canonicalFixture(alteredArtifactFrame);
    const alteredArtifactFailure = await runEffectFailure(
      restoreStoredFrameworkMigrationPlanAdmission({
        row: {
          ...rows.admission,
          admissionSha256: shaBytes(alteredArtifact.sha256Hex),
          ...canonicalColumns(
            alteredArtifactFrame,
            alteredArtifact.canonicalJson,
          ),
        },
        assignmentRows: rows.admissionAssignments,
        collision,
        plan,
        previousPlan: null,
        nameAssignments: assignments,
      }),
    );
    expect(alteredArtifactFailure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });

    const alteredLocatorProjections = [
      { kind: "schema_per_scope" },
      { databaseKey: "secondary" },
    ] as const;
    for (const projection of alteredLocatorProjections) {
      const alteredLocatorFrame = {
        ...fresh.admission.frame,
        physicalLocator: {
          ...fresh.admission.frame.physicalLocator,
          ...projection,
        },
      };
      const alteredLocator = canonicalFixture(alteredLocatorFrame);
      const alteredLocatorFailure = await runEffectFailure(
        restoreStoredFrameworkMigrationPlanAdmission({
          row: {
            ...rows.admission,
            admissionSha256: shaBytes(alteredLocator.sha256Hex),
            ...canonicalColumns(
              alteredLocatorFrame,
              alteredLocator.canonicalJson,
            ),
          },
          assignmentRows: rows.admissionAssignments,
          collision,
          plan,
          previousPlan: null,
          nameAssignments: assignments,
        }),
      );
      expect(alteredLocatorFailure).toMatchObject({
        _tag: "FrameworkMigrationValueError",
        reason: "storedStateCorrupt",
      });
    }

    const alternateSchema = syntheticSchemaInput();
    const extraSourceTable = alternateSchema.tables.find(table =>
      table.tableId === "parent"
    );
    if (extraSourceTable === undefined) {
      throw new Error("Missing source table for alternate assignment");
    }
    const alternateArtifact = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a",
      provenance: {
        kind: "synthetic",
        fixtureId: "relational-system-alternate-assignment",
      },
      schema: {
        ...alternateSchema,
        tables: [
          ...alternateSchema.tables,
          { ...extraSourceTable, tableId: "alternate_parent" },
        ],
      },
    }));
    const alternateLayout = await runEffect(captureRelationalPhysicalLayout({
      artifact: alternateArtifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace: fresh.target,
    }));
    const planAssignmentDigests = new Set(
      fresh.physicalLayout.nameAssignments.map(value =>
        value.assignmentSha256
      ),
    );
    const extraAssignment = alternateLayout.nameAssignments.find(value =>
      !planAssignmentDigests.has(value.assignmentSha256)
    );
    if (extraAssignment === undefined) {
      throw new Error("Missing alternate same-collision assignment");
    }
    const restoredExtraAssignment = await runEffect(
      restoreStoredRelationalPhysicalNameAssignment({
        assignmentStorageId: 999n,
        collisionStorageId: rows.collision.collisionStorageId,
        physicalDatabaseIdentity:
          fresh.target.frame.physicalDatabaseIdentity,
        schemaName: fresh.target.frame.schemaName,
        spelling: extraAssignment.frame.spelling,
        nameSha256: shaBytes(extraAssignment.frame.nameSha256),
        assignmentSha256: shaBytes(extraAssignment.assignmentSha256),
        ...canonicalColumns(
          extraAssignment.frame,
          extraAssignment.canonicalJson,
        ),
      }, collision),
    );
    const launderedAssignments = [
      ...assignments.slice(0, -1),
      restoredExtraAssignment,
    ].toSorted((left, right) => compareUtf16Strings(
      left.assignment.frame.spelling,
      right.assignment.frame.spelling,
    ));
    const alteredAdmissionFrame = {
      ...fresh.admission.frame,
      nameAssignments: launderedAssignments.map(value => ({
        spelling: value.assignment.frame.spelling,
        assignmentSha256: value.assignment.assignmentSha256,
      })),
    };
    const alteredAdmission = canonicalFixture(alteredAdmissionFrame);
    const admissionFailure = await runEffectFailure(
      restoreStoredFrameworkMigrationPlanAdmission({
        row: {
          ...rows.admission,
          admissionSha256: shaBytes(alteredAdmission.sha256Hex),
          ...canonicalColumns(
            alteredAdmissionFrame,
            alteredAdmission.canonicalJson,
          ),
        },
        assignmentRows: launderedAssignments.map((value, index) => ({
          admissionStorageId: rows.admission.admissionStorageId,
          collisionStorageId: rows.collision.collisionStorageId,
          assignmentOrdinal: index,
          assignmentStorageId: value.storageId,
          spelling: value.assignment.frame.spelling,
          assignmentSha256: shaBytes(value.assignment.assignmentSha256),
        })),
        collision,
        plan,
        previousPlan: null,
        nameAssignments: launderedAssignments,
      }),
    );
    expect(admissionFailure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });

    const forgedCollision = { ...collision };
    const firstAssignmentRow = requiredAt(
      rows.assignments,
      0,
      "Missing first assignment fixture row",
    );
    const authorityFailure = await runEffectFailure(
      restoreStoredRelationalPhysicalNameAssignment(
        firstAssignmentRow,
        forgedCollision,
      ),
    );
    expect(authorityFailure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });
  });

  it("rejects receipt topology laundering and a non-increasing event chain", async () => {
    const values = await restoreMigrationGraph();
    const rows = storedRows(values);
    const receiptsByStep = new Map(
      values.restoredReceipts.map(value => [
        value.receipt.frame.stepId,
        value,
      ]),
    );
    const sourceStep = values.plan.frame.steps.find(step => {
      if (step.dependencies.length === 0) return false;
      const declared = new Set(step.dependencies.map(value => value.stepId));
      return values.restoredReceipts.some(value =>
        value.receipt.frame.stepId !== step.stepId &&
        !declared.has(value.receipt.frame.stepId)
      );
    });
    if (sourceStep === undefined) {
      throw new Error("Missing receipt substitution fixture step");
    }
    const declaredDependencyIds = new Set(
      sourceStep.dependencies.map(value => value.stepId),
    );
    const unrelatedReceipt = values.restoredReceipts.find(value =>
      value.receipt.frame.stepId !== sourceStep.stepId &&
      !declaredDependencyIds.has(value.receipt.frame.stepId)
    );
    const targetReceipt = receiptsByStep.get(sourceStep.stepId);
    if (unrelatedReceipt === undefined || targetReceipt === undefined) {
      throw new Error("Missing receipt substitution fixtures");
    }
    const launderedDependencyReceipts = targetReceipt.receipt.frame
      .dependencyReceipts.map((reference, index) => {
        if (index === 0) return unrelatedReceipt;
        const restored = receiptsByStep.get(reference.stepId);
        if (restored === undefined) {
          throw new Error("Missing declared dependency receipt");
        }
        return restored;
      }).toSorted((left, right) => compareUtf16Strings(
        left.receipt.frame.stepId,
        right.receipt.frame.stepId,
      ));
    const targetReceiptRow = rows.receipts.find(row =>
      row.stepId === sourceStep.stepId
    );
    if (targetReceiptRow === undefined) {
      throw new Error("Missing target receipt fixture row");
    }
    const alteredReceiptFrame = {
      ...targetReceipt.receipt.frame,
      dependencyReceipts: launderedDependencyReceipts.map(value => ({
        stepId: value.receipt.frame.stepId,
        stepReceiptSha256: value.receipt.sha256,
      })),
    };
    const alteredReceipt = canonicalFixture(alteredReceiptFrame);
    const receiptFailure = await runEffectFailure(
      restoreStoredFrameworkMigrationStepReceipt({
        row: {
          ...targetReceiptRow,
          stepReceiptSha256: shaBytes(alteredReceipt.sha256Hex),
          ...canonicalColumns(
            alteredReceiptFrame,
            alteredReceipt.canonicalJson,
          ),
        },
        dependencyRows: launderedDependencyReceipts.map((value, index) => ({
          receiptStorageId: targetReceiptRow.receiptStorageId,
          attemptStorageId: rows.attempt.attemptStorageId,
          dependencyOrdinal: index,
          dependencyReceiptStorageId: value.storageId,
          dependencyStepId: value.receipt.frame.stepId,
          dependencyStepReceiptSha256: shaBytes(value.receipt.sha256),
        })),
        collision: values.restoredCollision,
        plan: values.restoredPlan,
        attempt: values.restoredAttempt,
        dependencyReceipts: launderedDependencyReceipts,
      }),
    );
    expect(receiptFailure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });

    const previousEvent = requiredAt(
      values.restoredEvents,
      0,
      "Missing previous restored event",
    );
    const leaseEvent = requiredAt(
      values.events,
      1,
      "Missing lease event",
    );
    const leaseEventRow = requiredAt(
      rows.events,
      1,
      "Missing lease event fixture row",
    );
    const alteredEventFrame = {
      ...leaseEvent.frame,
      sequence: previousEvent.event.frame.sequence,
    };
    const alteredEvent = canonicalFixture(alteredEventFrame);
    const eventFailure = await runEffectFailure(
      restoreStoredFrameworkMigrationEvent({
        row: {
          ...leaseEventRow,
          eventSequence: BigInt(alteredEventFrame.sequence),
          eventSha256: shaBytes(alteredEvent.sha256Hex),
          ...canonicalColumns(
            alteredEventFrame,
            alteredEvent.canonicalJson,
          ),
        },
        collision: values.restoredCollision,
        previous: previousEvent,
        subject: {
          kind: "leaseRenewed",
          attempt: values.restoredAttempt,
        },
      }),
    );
    expect(eventFailure).toMatchObject({
      _tag: "FrameworkMigrationValueError",
      reason: "storedStateCorrupt",
    });
  });

  it("detaches canonical row bytes before returning restored values", async () => {
    const fresh = await freshMigrationGraph();
    const row = storedRows(fresh).target;
    const restored = await runEffect(
      restoreStoredFrameworkSchemaTargetNamespace(row),
    );
    row.canonicalBytes.fill(0);

    expect(restored.targetNamespace).toEqual(fresh.target);
    expect(restored.targetNamespace.canonicalJson).toBe(fresh.target.canonicalJson);
  });
});

async function restoreMigrationGraph() {
  const fresh = await freshMigrationGraph();
  const rows = storedRows(fresh);
  const restoredTarget = await runEffect(
    restoreStoredFrameworkSchemaTargetNamespace(rows.target),
  );
  const restoredCollision = await runEffect(
    restoreStoredFrameworkMigrationCollisionDomain(
      rows.collision,
      restoredTarget,
    ),
  );
  const restoredAssignments = [];
  for (let index = 0; index < rows.assignments.length; index += 1) {
    const row = rows.assignments[index];
    if (row === undefined) throw new Error("Missing assignment fixture row");
    restoredAssignments.push(await runEffect(
      restoreStoredRelationalPhysicalNameAssignment(row, restoredCollision),
    ));
  }
  const restoredPlan = await runEffect(
    restoreStoredFreshRelationalMigrationPlan({
      row: rows.plan,
      stepRows: rows.planSteps,
      dependencyRows: rows.planDependencies,
      targetNamespace: restoredTarget,
      collision: restoredCollision,
      nameAssignments: restoredAssignments,
    }),
  );
  const restoredAdmission = await runEffect(
    restoreStoredFrameworkMigrationPlanAdmission({
      row: rows.admission,
      assignmentRows: rows.admissionAssignments,
      collision: restoredCollision,
      plan: restoredPlan,
      previousPlan: null,
      nameAssignments: restoredAssignments,
    }),
  );
  const restoredAttempt = await runEffect(
    restoreStoredFrameworkMigrationAttemptStart({
      row: rows.attempt,
      collision: restoredCollision,
      plan: restoredPlan,
      admission: restoredAdmission,
      previousAttempt: null,
    }),
  );
  const restoredReceipts: RestoredFrameworkMigrationStepReceipt[] = [];
  const restoredReceiptsByStep = new Map<
    string,
    RestoredFrameworkMigrationStepReceipt
  >();
  for (let index = 0; index < rows.receipts.length; index += 1) {
    const row = rows.receipts[index];
    const dependencyRows = rows.receiptDependencies[index];
    if (row === undefined || dependencyRows === undefined) {
      throw new Error("Missing receipt fixture row");
    }
    const dependencyReceipts = fresh.receipts[index]?.frame.dependencyReceipts
      .map(dependency => {
        const restored = restoredReceiptsByStep.get(dependency.stepId);
        if (restored === undefined) {
          throw new Error("Missing restored dependency receipt");
        }
        return restored;
      }) ?? [];
    const restored = await runEffect(
      restoreStoredFrameworkMigrationStepReceipt({
        row,
        dependencyRows,
        collision: restoredCollision,
        plan: restoredPlan,
        attempt: restoredAttempt,
        dependencyReceipts,
      }),
    );
    restoredReceipts.push(restored);
    restoredReceiptsByStep.set(restored.receipt.frame.stepId, restored);
  }
  const restoredTerminal = await runEffect(
    restoreStoredFrameworkMigrationAttemptTerminal({
      row: rows.terminal,
      collision: restoredCollision,
      plan: restoredPlan,
      admission: restoredAdmission,
      attempt: restoredAttempt,
      stepReceipts: restoredReceipts,
    }),
  );
  const restoredInstallation = await runEffect(
    restoreStoredFrameworkSchemaInstallationMetadata({
      row: rows.installation,
      collision: restoredCollision,
      plan: restoredPlan,
      admission: restoredAdmission,
      terminal: restoredTerminal,
    }),
  );
  const restoredReadiness = await runEffect(
    restoreStoredFrameworkSchemaReadinessMetadata({
      row: rows.readiness,
      installation: restoredInstallation,
    }),
  );
  const restoredAvailabilityHistory:
    RestoredFrameworkSchemaAvailabilityHistory[] = [];
  for (const row of rows.availabilityHistory) {
    restoredAvailabilityHistory.push(await runEffect(
      restoreStoredFrameworkSchemaAvailabilityHistoryMetadata({
        row,
        installation: restoredInstallation,
        readiness: restoredReadiness,
        previous: restoredAvailabilityHistory.at(-1) ?? null,
      }),
    ));
  }
  const lastHistory = restoredAvailabilityHistory.at(-1);
  if (lastHistory === undefined) {
    throw new Error("Missing restored availability history");
  }
  const restoredAvailabilityHead = await runEffect(
    restoreStoredFrameworkSchemaAvailabilityHeadMetadata({
      row: rows.availabilityHead,
      installation: restoredInstallation,
      readiness: restoredReadiness,
      history: lastHistory,
    }),
  );
  const firstEventRow = requiredAt(
    rows.events,
    0,
    "Missing first event fixture row",
  );
  const secondEventRow = requiredAt(
    rows.events,
    1,
    "Missing second event fixture row",
  );
  const thirdEventRow = requiredAt(
    rows.events,
    2,
    "Missing third event fixture row",
  );
  const firstEvent = await runEffect(restoreStoredFrameworkMigrationEvent({
    row: firstEventRow,
    collision: restoredCollision,
    previous: null,
    subject: { kind: "planAdmitted", admission: restoredAdmission },
  }));
  const secondEvent = await runEffect(restoreStoredFrameworkMigrationEvent({
    row: secondEventRow,
    collision: restoredCollision,
    previous: firstEvent,
    subject: { kind: "leaseRenewed", attempt: restoredAttempt },
  }));
  const thirdEvent = await runEffect(restoreStoredFrameworkMigrationEvent({
    row: thirdEventRow,
    collision: restoredCollision,
    previous: secondEvent,
    subject: { kind: "readinessPublished", readiness: restoredReadiness },
  }));
  const restoredCollisionHead = await runEffect(
    restoreStoredFrameworkMigrationCollisionHead({
      row: rows.collisionHead,
      collision: restoredCollision,
      plan: restoredPlan,
      admission: restoredAdmission,
      currentAttempt: restoredAttempt,
      lastEvent: thirdEvent,
    }),
  );
  return {
    ...fresh,
    restoredTarget,
    restoredCollision,
    restoredAssignments,
    restoredPlan,
    restoredAdmission,
    restoredAttempt,
    restoredReceipts,
    restoredTerminal,
    restoredInstallation,
    restoredReadiness,
    restoredAvailabilityHistory,
    restoredAvailabilityHead,
    restoredEvents: [firstEvent, secondEvent, thirdEvent],
    restoredCollisionHead,
  };
}

async function freshMigrationGraph() {
  const artifact = await syntheticSystemArtifact();
  const target = await frameworkTargetNamespace();
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
    artifact: artifact.artifact,
    physicalLocator: FRAMEWORK_VALUE_LOCATOR,
    targetNamespace: target,
  }));
  const plan = await runEffect(captureFreshRelationalMigrationPlan({
    artifact: artifact.artifact,
    physicalLayout,
  }));
  const admission = await runEffect(captureFrameworkMigrationPlanAdmission({
    plan,
    nameAssignments: physicalLayout.nameAssignments,
    previousPlanSha256: null,
    admittedAt: T0,
  }));
  const attempt = await runEffect(captureFrameworkMigrationAttemptStart({
    admission,
    attemptId: "attempt-restored",
    attemptFence: "1",
    leaseOwnerId: "worker-restored",
    leaseExpiresAt: T1,
    previousAttemptId: null,
    startedAt: T0,
  }));
  const receipts = await completeFrameworkMigrationPlanSteps(plan, attempt, T1);
  const terminal = await runEffect(captureFrameworkMigrationAttemptTerminal({
    attempt,
    outcome: {
      kind: "succeeded",
      requiredStepSetSha256: plan.requiredStepSetSha256,
    },
    stepReceipts: receipts,
    terminalAt: T1,
  }));
  const installedPhysicalCapabilities = [
    ...plan.physicalLayout.frame.requiredPhysicalCapabilities,
  ];
  const installation = await runEffect(captureFrameworkSchemaInstallation({
    plan,
    admission,
    terminal,
    installedStructureSha256: plan.physicalLayout.layoutSha256,
    installedPhysicalCapabilities,
    installedAt: T1,
  }));
  const readiness = await runEffect(captureFrameworkSchemaReadiness({
    installation,
    validationSha256: VALIDATION_SHA256,
    validatedStructureSha256: installation.frame.installedStructureSha256,
    validatedPhysicalCapabilities: installedPhysicalCapabilities,
    residualRequirements: installedPhysicalCapabilities.map(capability => ({
      capability: capability.identity,
      requirement: capability.residualRequirement,
    })),
    validatedAt: T1,
  }));
  const ready = await runEffect(captureFrameworkSchemaAvailabilityHistory({
    readiness,
    previous: null,
    status: "ready",
    reasonSha256: null,
    recordedAt: T1,
  }));
  const withdrawn = await runEffect(
    captureFrameworkSchemaAvailabilityHistory({
      readiness,
      previous: ready,
      status: "withdrawn",
      reasonSha256: AVAILABILITY_REASON_SHA256,
      recordedAt: T2,
    }),
  );
  const availabilityHistory = [ready, withdrawn] as const;
  const availabilityHead = await runEffect(
    captureFrameworkSchemaAvailabilityHead(withdrawn),
  );
  const admittedEvent = await runEffect(captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: plan.frame.collision,
    sequence: eventSequence("0"),
    previousEvent: null,
    recordedAt: admission.frame.admittedAt,
    kind: "planAdmitted",
    admissionSha256: admission.sha256,
  }));
  const leaseEvent = await runEffect(captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: plan.frame.collision,
    sequence: eventSequence("1"),
    previousEvent: {
      sequence: admittedEvent.frame.sequence,
      eventSha256: admittedEvent.sha256,
    },
    recordedAt: attempt.frame.startedAt,
    kind: "leaseRenewed",
    attemptId: attempt.frame.attemptId,
    attemptFence: attempt.frame.attemptFence,
    leaseOwnerId: attempt.frame.leaseOwnerId,
    leaseExpiresAt: attempt.frame.leaseExpiresAt,
  }));
  const readinessEvent = await runEffect(captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: plan.frame.collision,
    sequence: eventSequence("2"),
    previousEvent: {
      sequence: leaseEvent.frame.sequence,
      eventSha256: leaseEvent.sha256,
    },
    recordedAt: readiness.frame.validatedAt,
    kind: "readinessPublished",
    readinessSha256: readiness.sha256,
  }));
  const events = [admittedEvent, leaseEvent, readinessEvent] as const;
  const collisionHead = await runEffect(
    captureFrameworkMigrationCollisionHead({
      admission,
      headRevision: "3",
      attemptFence: attempt.frame.attemptFence,
      currentAttempt: {
        attemptId: attempt.frame.attemptId,
        attemptFence: attempt.frame.attemptFence,
        leaseOwnerId: attempt.frame.leaseOwnerId,
        leaseExpiresAt: attempt.frame.leaseExpiresAt,
      },
      lastEvent: {
        sequence: readinessEvent.frame.sequence,
        eventSha256: readinessEvent.sha256,
      },
      updatedAt: T2,
    }),
  );
  return {
    target,
    physicalLayout,
    plan,
    admission,
    attempt,
    receipts,
    terminal,
    installation,
    readiness,
    availabilityHistory,
    availabilityHead,
    events,
    collisionHead,
  };
}

function storedRows(fresh: Awaited<ReturnType<typeof freshMigrationGraph>>) {
  const targetStorageId = 1n;
  const collisionStorageId = 2n;
  const planStorageId = 100n;
  const admissionStorageId = 200n;
  const attemptStorageId = 300n;
  const terminalStorageId = 500n;
  const assignmentIds = new Map(
    fresh.physicalLayout.nameAssignments.map((assignment, index) => [
      assignment,
      10n + BigInt(index),
    ]),
  );
  const receiptIds = new Map(
    fresh.receipts.map((receipt, index) => [receipt, 400n + BigInt(index)]),
  );
  const receiptByStep = new Map(
    fresh.receipts.map(receipt => [receipt.frame.stepId, receipt]),
  );
  const target = {
    targetNamespaceStorageId: targetStorageId,
    deploymentId: fresh.target.frame.deploymentId,
    physicalDatabaseIdentity: fresh.target.frame.physicalDatabaseIdentity,
    schemaName: fresh.target.frame.schemaName,
    targetNamespaceSha256: shaBytes(fresh.target.targetNamespaceSha256),
    ...canonicalColumns(fresh.target.frame, fresh.target.canonicalJson),
  };
  const collision = {
    collisionStorageId,
    targetNamespaceStorageId: targetStorageId,
    physicalDatabaseIdentity: fresh.target.frame.physicalDatabaseIdentity,
    schemaName: fresh.target.frame.schemaName,
    owner: fresh.plan.frame.collision.owner,
    lineageId: fresh.plan.frame.collision.lineageId,
    physicalNamespaceProfile:
      fresh.plan.frame.collision.physicalNamespaceProfile,
  };
  const assignments = fresh.physicalLayout.nameAssignments.map(assignment => ({
    assignmentStorageId: assignmentIds.get(assignment),
    collisionStorageId,
    physicalDatabaseIdentity: fresh.target.frame.physicalDatabaseIdentity,
    schemaName: fresh.target.frame.schemaName,
    spelling: assignment.frame.spelling,
    nameSha256: shaBytes(assignment.frame.nameSha256),
    assignmentSha256: shaBytes(assignment.assignmentSha256),
    ...canonicalColumns(assignment.frame, assignment.canonicalJson),
  }));
  const plan = {
    planStorageId,
    collisionStorageId,
    artifactSha256: shaBytes(fresh.plan.frame.artifact.artifactSha256),
    locatorKind: fresh.plan.frame.physicalLocator.kind,
    locatorDatabaseKey: fresh.plan.frame.physicalLocator.databaseKey,
    locatorSchemaName: fresh.plan.frame.physicalLocator.schemaName,
    migrationPlanSha256: shaBytes(fresh.plan.migrationPlanSha256),
    requiredStepSetSha256: shaBytes(fresh.plan.requiredStepSetSha256),
    physicalLayoutSha256: shaBytes(fresh.plan.physicalLayout.layoutSha256),
    ...canonicalColumns(fresh.plan.frame, fresh.plan.canonicalJson),
  };
  const planSteps = fresh.plan.frame.steps.map((step, index) => ({
    planStorageId,
    collisionStorageId,
    stepOrdinal: index,
    stepId: step.stepId,
    stepSha256: shaBytes(step.stepSha256),
    preconditionSha256: shaBytes(step.preconditionSha256),
    postconditionSha256: shaBytes(step.postconditionSha256),
    phase: step.phase,
    operationFormat: step.operation.codec.format,
    operationVersion: step.operation.codec.version,
    dependencyCount: step.dependencies.length,
  }));
  const planDependencies = fresh.plan.frame.steps.flatMap(step =>
    step.dependencies.map((dependency, index) => ({
      planStorageId,
      sourceStepId: step.stepId,
      dependencyOrdinal: index,
      dependencyStepId: dependency.stepId,
      dependencyStepSha256: shaBytes(dependency.stepSha256),
    }))
  );
  const admission = {
    admissionStorageId,
    collisionStorageId,
    planStorageId,
    migrationPlanSha256: shaBytes(fresh.plan.migrationPlanSha256),
    previousPlanStorageId: null,
    previousPlanSha256: null,
    admissionSha256: shaBytes(fresh.admission.sha256),
    admissionProfile: fresh.admission.frame.admissionProfile,
    assignmentCount: fresh.admission.frame.nameAssignments.length,
    ...canonicalColumns(fresh.admission.frame, fresh.admission.canonicalJson),
  };
  const admissionAssignments = fresh.physicalLayout.nameAssignments.map(
    (assignment, index) => ({
      admissionStorageId,
      collisionStorageId,
      assignmentOrdinal: index,
      assignmentStorageId: assignmentIds.get(assignment),
      spelling: assignment.frame.spelling,
      assignmentSha256: shaBytes(assignment.assignmentSha256),
    }),
  );
  const attempt = {
    attemptStorageId,
    collisionStorageId,
    planStorageId,
    migrationPlanSha256: shaBytes(fresh.plan.migrationPlanSha256),
    admissionStorageId,
    admissionSha256: shaBytes(fresh.admission.sha256),
    attemptId: fresh.attempt.frame.attemptId,
    attemptFence: BigInt(fresh.attempt.frame.attemptFence),
    leaseOwnerId: fresh.attempt.frame.leaseOwnerId,
    leaseExpiresAt: new Date(fresh.attempt.frame.leaseExpiresAt),
    previousAttemptStorageId: null,
    previousAttemptId: null,
    attemptStartSha256: shaBytes(fresh.attempt.sha256),
    ...canonicalColumns(fresh.attempt.frame, fresh.attempt.canonicalJson),
  };
  const receipts = fresh.receipts.map(receipt => {
    const step = fresh.plan.frame.steps.find(value =>
      value.stepId === receipt.frame.stepId
    );
    if (step === undefined) throw new Error("Missing fixture step");
    return {
      receiptStorageId: receiptIds.get(receipt),
      collisionStorageId,
      planStorageId,
      attemptStorageId,
      attemptId: fresh.attempt.frame.attemptId,
      attemptFence: BigInt(fresh.attempt.frame.attemptFence),
      stepId: step.stepId,
      stepSha256: shaBytes(step.stepSha256),
      preconditionSha256: shaBytes(step.preconditionSha256),
      postconditionSha256: shaBytes(step.postconditionSha256),
      observedPostconditionSha256: shaBytes(step.postconditionSha256),
      dependencyCount: receipt.frame.dependencyReceipts.length,
      stepReceiptSha256: shaBytes(receipt.sha256),
      ...canonicalColumns(receipt.frame, receipt.canonicalJson),
    };
  });
  const receiptDependencies = fresh.receipts.map(receipt =>
    receipt.frame.dependencyReceipts.map((dependency, index) => {
      const dependencyReceipt = receiptByStep.get(dependency.stepId);
      if (dependencyReceipt === undefined) {
        throw new Error("Missing fixture dependency receipt");
      }
      return {
        receiptStorageId: receiptIds.get(receipt),
        attemptStorageId,
        dependencyOrdinal: index,
        dependencyReceiptStorageId: receiptIds.get(dependencyReceipt),
        dependencyStepId: dependency.stepId,
        dependencyStepReceiptSha256: shaBytes(
          dependency.stepReceiptSha256,
        ),
      };
    })
  );
  const lastReceipt = fresh.receipts.at(-1);
  if (lastReceipt === undefined) throw new Error("Missing terminal receipt");
  const terminal = {
    terminalStorageId,
    collisionStorageId,
    planStorageId,
    attemptStorageId,
    admissionStorageId,
    admissionSha256: shaBytes(fresh.admission.sha256),
    attemptId: fresh.attempt.frame.attemptId,
    attemptFence: BigInt(fresh.attempt.frame.attemptFence),
    outcomeKind: fresh.terminal.frame.outcome.kind,
    requiredStepSetSha256: shaBytes(fresh.plan.requiredStepSetSha256),
    failureReason: null,
    evidenceSha256: null,
    lastReceiptStorageId: receiptIds.get(lastReceipt),
    lastStepReceiptSha256: shaBytes(lastReceipt.sha256),
    attemptTerminalSha256: shaBytes(fresh.terminal.sha256),
    ...canonicalColumns(fresh.terminal.frame, fresh.terminal.canonicalJson),
  };
  const installationStorageId = 600n;
  const readinessStorageId = 601n;
  const installation = {
    installationStorageId,
    collisionStorageId,
    planStorageId,
    migrationPlanSha256: shaBytes(fresh.plan.migrationPlanSha256),
    admissionStorageId,
    admissionSha256: shaBytes(fresh.admission.sha256),
    terminalStorageId,
    terminalOutcomeKind: fresh.terminal.frame.outcome.kind,
    terminalSha256: shaBytes(fresh.terminal.sha256),
    installationSha256: shaBytes(
      fresh.installation.frame.identity.installationSha256,
    ),
    installationReceiptSha256: shaBytes(fresh.installation.sha256),
    installedStructureSha256: shaBytes(
      fresh.installation.frame.installedStructureSha256,
    ),
    ...canonicalColumns(
      fresh.installation.frame,
      fresh.installation.canonicalJson,
    ),
  };
  const readiness = {
    readinessStorageId,
    installationStorageId,
    installationSha256: shaBytes(
      fresh.installation.frame.identity.installationSha256,
    ),
    installationReceiptSha256: shaBytes(fresh.installation.sha256),
    readinessSha256: shaBytes(fresh.readiness.sha256),
    validationSha256: shaBytes(fresh.readiness.frame.validationSha256),
    validatedStructureSha256: shaBytes(
      fresh.readiness.frame.validatedStructureSha256,
    ),
    ...canonicalColumns(fresh.readiness.frame, fresh.readiness.canonicalJson),
  };
  const historyIds = new Map(
    fresh.availabilityHistory.map((history, index) => [
      history,
      610n + BigInt(index),
    ]),
  );
  const availabilityHistory = fresh.availabilityHistory.map(
    (history, index) => {
      const previous = index === 0
        ? undefined
        : fresh.availabilityHistory[index - 1];
      return {
        availabilityHistoryStorageId: historyIds.get(history),
        installationStorageId,
        readinessStorageId,
        readinessSha256: shaBytes(fresh.readiness.sha256),
        availabilitySequence: BigInt(history.frame.availabilitySequence),
        status: history.frame.status,
        reasonSha256: history.frame.reasonSha256 === null
          ? null
          : shaBytes(history.frame.reasonSha256),
        historySha256: shaBytes(history.sha256),
        previousHistoryStorageId: previous === undefined
          ? null
          : historyIds.get(previous),
        previousAvailabilitySequence: previous === undefined
          ? null
          : BigInt(previous.frame.availabilitySequence),
        previousHistorySha256: previous === undefined
          ? null
          : shaBytes(previous.sha256),
        previousStatus: previous?.frame.status ?? null,
        ...canonicalColumns(history.frame, history.canonicalJson),
      };
    },
  );
  const availabilityHead = {
    installationStorageId,
    readinessStorageId,
    availabilityHistoryStorageId: historyIds.get(
      fresh.availabilityHistory[1],
    ),
    availabilitySequence: BigInt(
      fresh.availabilityHead.frame.availabilitySequence,
    ),
    status: fresh.availabilityHead.frame.status,
    historySha256: shaBytes(fresh.availabilityHead.frame.historySha256),
    availabilityHeadSha256: shaBytes(fresh.availabilityHead.sha256),
    ...canonicalColumns(
      fresh.availabilityHead.frame,
      fresh.availabilityHead.canonicalJson,
    ),
  };
  const eventIds = new Map(
    fresh.events.map((event, index) => [event, 700n + BigInt(index)]),
  );
  const events = fresh.events.map((event, index) => {
    const previous = index === 0 ? undefined : fresh.events[index - 1];
    const leaseRenewed = event.frame.kind === "leaseRenewed";
    return {
      eventStorageId: eventIds.get(event),
      collisionStorageId,
      eventSequence: BigInt(event.frame.sequence),
      eventSha256: shaBytes(event.sha256),
      previousEventStorageId: previous === undefined
        ? null
        : eventIds.get(previous),
      previousEventSequence: previous === undefined
        ? null
        : BigInt(previous.frame.sequence),
      previousEventSha256: previous === undefined
        ? null
        : shaBytes(previous.sha256),
      eventKind: event.frame.kind,
      subjectSha256: leaseRenewed
        ? null
        : shaBytes(eventSubjectSha256(event.frame)),
      leaseAttemptId: leaseRenewed ? event.frame.attemptId : null,
      leaseAttemptFence: leaseRenewed
        ? BigInt(event.frame.attemptFence)
        : null,
      leaseOwnerId: leaseRenewed ? event.frame.leaseOwnerId : null,
      leaseExpiresAt: leaseRenewed
        ? new Date(event.frame.leaseExpiresAt)
        : null,
      ...canonicalColumns(event.frame, event.canonicalJson),
    };
  });
  const collisionHead = {
    collisionStorageId,
    currentPlanStorageId: planStorageId,
    currentPlanSha256: shaBytes(fresh.plan.migrationPlanSha256),
    currentAdmissionStorageId: admissionStorageId,
    currentAdmissionSha256: shaBytes(fresh.admission.sha256),
    headRevision: BigInt(fresh.collisionHead.frame.headRevision),
    attemptFence: BigInt(fresh.collisionHead.frame.attemptFence),
    currentAttemptStorageId: attemptStorageId,
    currentAttemptId: fresh.attempt.frame.attemptId,
    currentAttemptFence: BigInt(fresh.attempt.frame.attemptFence),
    currentLeaseOwnerId: fresh.attempt.frame.leaseOwnerId,
    currentLeaseExpiresAt: new Date(fresh.attempt.frame.leaseExpiresAt),
    lastEventStorageId: eventIds.get(fresh.events[2]),
    lastEventSequence: BigInt(fresh.events[2].frame.sequence),
    lastEventSha256: shaBytes(fresh.events[2].sha256),
    collisionHeadSha256: shaBytes(fresh.collisionHead.sha256),
    ...canonicalColumns(
      fresh.collisionHead.frame,
      fresh.collisionHead.canonicalJson,
    ),
  };
  return {
    target,
    collision,
    assignments,
    plan,
    planSteps,
    planDependencies,
    admission,
    admissionAssignments,
    attempt,
    receipts,
    receiptDependencies,
    terminal,
    installation,
    readiness,
    availabilityHistory,
    availabilityHead,
    events,
    collisionHead,
  };
}

function canonicalColumns(
  frame: Readonly<{ readonly format: string; readonly version: number }>,
  canonicalJson: string,
) {
  const canonicalBytes = new TextEncoder().encode(canonicalJson);
  return {
    frameFormat: frame.format,
    frameVersion: frame.version,
    canonicalByteLength: canonicalBytes.byteLength,
    observedCanonicalByteLength: canonicalBytes.byteLength,
    canonicalBytes,
  };
}

function canonicalFixture(
  frame: Parameters<typeof encodeCanonicalJson>[0],
): Readonly<{ readonly canonicalJson: string; readonly sha256Hex: string }> {
  const canonicalJson = encodeCanonicalJson(frame, cause => {
    throw new Error("Fixture frame was not canonical JSON", { cause });
  });
  return Object.freeze({
    canonicalJson,
    sha256Hex: createHash("sha256").update(canonicalJson).digest("hex"),
  });
}

function requiredAt<Value>(
  values: readonly Value[],
  index: number,
  message: string,
): Value {
  const value = values[index];
  if (value === undefined) throw new Error(message);
  return value;
}

function shaBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function eventSubjectSha256(
  frame: Exclude<FrameworkMigrationEventFrame, { readonly kind: "leaseRenewed" }>,
): string {
  switch (frame.kind) {
    case "planAdmitted":
      return frame.admissionSha256;
    case "attemptStarted":
      return frame.attemptStartSha256;
    case "stepCompleted":
      return frame.stepReceiptSha256;
    case "attemptTerminated":
      return frame.terminalSha256;
    case "installationPublished":
      return frame.installationReceiptSha256;
    case "readinessPublished":
      return frame.readinessSha256;
  }
}
