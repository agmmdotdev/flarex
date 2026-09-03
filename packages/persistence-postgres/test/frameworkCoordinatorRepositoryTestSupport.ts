import type { FlarexMetadataTransaction } from
  "../src/metadataTransaction";
import {
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationAttemptTerminal,
  captureFrameworkMigrationPlanAdmission,
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  ensureFrameworkMigrationAttemptStartInTransactionEffect,
} from "../src/migrationCoordination/migrationAttemptRepository";
import {
  ensureFrameworkMigrationAttemptTerminalInTransactionEffect,
} from "../src/migrationCoordination/migrationAttemptTerminalRepository";
import {
  ensureFrameworkMigrationPlanAdmissionInTransactionEffect,
} from "../src/migrationCoordination/migrationPlanAdmissionRepository";
import {
  ensureFreshRelationalMigrationPlanInTransactionEffect,
} from "../src/migrationCoordination/migrationPlanRepository";
import {
  ensureRelationalPhysicalNameAssignmentInTransactionEffect,
} from "../src/migrationCoordination/physicalNameAssignmentRepository";
import {
  ensureFrameworkMigrationStepReceiptInTransactionEffect,
} from "../src/migrationCoordination/migrationStepReceiptRepository";
import type {
  RestoredFrameworkMigrationStepReceipt,
} from "../src/migrationCoordination/storedRestoration";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "../src/migrationCoordination/targetCollisionRepository";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import { runEffect } from "./effectTestRuntime";
import {
  FRAMEWORK_VALUE_LOCATOR,
  completeFrameworkMigrationPlanSteps,
  frameworkTargetNamespace,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";

export const COORDINATOR_STARTED_AT = "2026-08-27T08:30:00.000Z";
export const COORDINATOR_COMPLETED_AT = "2026-08-27T08:31:00.000Z";
export const COORDINATOR_TERMINAL_AT = "2026-08-27T08:33:00.000Z";

export async function createSuccessfulTerminalPlanValues() {
  const artifact = await syntheticSystemArtifact();
  const targetValue = await frameworkTargetNamespace();
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
    artifact: artifact.artifact,
    physicalLocator: FRAMEWORK_VALUE_LOCATOR,
    targetNamespace: targetValue,
  }));
  const planValue = await runEffect(captureFreshRelationalMigrationPlan({
    artifact: artifact.artifact,
    physicalLayout,
  }));
  return Object.freeze({ artifact, targetValue, physicalLayout, planValue });
}

export async function storeSuccessfulTerminalGraphInTransaction(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof createSuccessfulTerminalPlanValues>>,
) {
  const { artifact, targetValue, physicalLayout, planValue } = values;
  const target = await runEffect(
    ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
      transaction,
      targetValue,
    ),
  );
  const collision = await runEffect(
    ensureFrameworkMigrationCollisionDomainInTransactionEffect(
      transaction,
      target,
      planValue,
    ),
  );
  for (const assignment of physicalLayout.nameAssignments) {
    await runEffect(
      ensureRelationalPhysicalNameAssignmentInTransactionEffect(
        transaction,
        collision,
        assignment,
      ),
    );
  }
  const plan = await runEffect(
    ensureFreshRelationalMigrationPlanInTransactionEffect(
      transaction,
      collision,
      planValue,
    ),
  );
  const admissionValue = await runEffect(
    captureFrameworkMigrationPlanAdmission({
      plan: plan.plan,
      nameAssignments: plan.plan.physicalLayout.nameAssignments,
      previousPlanSha256: null,
      admittedAt: COORDINATOR_STARTED_AT,
    }),
  );
  const admission = await runEffect(
    ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
      transaction,
      plan,
      null,
      admissionValue,
    ),
  );
  const attemptValue = await runEffect(captureFrameworkMigrationAttemptStart({
    admission: admission.admission,
    attemptId: "attempt-a",
    attemptFence: "1",
    leaseOwnerId: "worker-a",
    leaseExpiresAt: COORDINATOR_TERMINAL_AT,
    previousAttemptId: null,
    startedAt: COORDINATOR_STARTED_AT,
  }));
  const attempt = await runEffect(
    ensureFrameworkMigrationAttemptStartInTransactionEffect(
      transaction,
      admission,
      null,
      attemptValue,
    ),
  );
  const receiptValues = await completeFrameworkMigrationPlanSteps(
    attempt.plan.plan,
    attempt.attempt,
    COORDINATOR_COMPLETED_AT,
  );
  const receiptByStepId = new Map<
    string,
    RestoredFrameworkMigrationStepReceipt
  >();
  const receipts: RestoredFrameworkMigrationStepReceipt[] = [];
  for (const receiptValue of receiptValues) {
    const dependencyReceipts = receiptValue.frame.dependencyReceipts.map(
      reference => {
        const receipt = receiptByStepId.get(reference.stepId);
        if (receipt === undefined) {
          throw new Error("Stored dependency receipt is missing");
        }
        return receipt;
      },
    );
    const receipt = await runEffect(
      ensureFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        attempt,
        dependencyReceipts,
        receiptValue,
      ),
    );
    receiptByStepId.set(receiptValue.frame.stepId, receipt);
    receipts.push(receipt);
  }
  const terminalValue = await runEffect(
    captureFrameworkMigrationAttemptTerminal({
      attempt: attempt.attempt,
      outcome: Object.freeze({
        kind: "succeeded",
        requiredStepSetSha256: attempt.plan.plan.requiredStepSetSha256,
      }),
      stepReceipts: receiptValues,
      terminalAt: COORDINATOR_TERMINAL_AT,
    }),
  );
  const terminal = await runEffect(
    ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
      transaction,
      attempt,
      receipts,
      terminalValue,
    ),
  );
  return Object.freeze({
    artifact,
    targetValue,
    target,
    physicalLayout,
    planValue,
    collision,
    plan: terminal.attempt.plan,
    admissionValue,
    admission: terminal.attempt.admission,
    attemptValue,
    attempt: terminal.attempt,
    receiptValues,
    receipts: Object.freeze(receipts),
    terminalValue,
    terminal,
  });
}
