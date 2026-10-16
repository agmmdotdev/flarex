import { isNonArrayRecord, type UnknownRecord } from "@flarex/utils/records";
import type { FlarexMetadataTransaction } from
  "../../../src/database/metadataTransaction";
import {
  captureFrameworkSchemaAvailabilityHistory,
  captureFrameworkSchemaInstallation,
  captureFrameworkSchemaReadiness,
} from "../../../src/installation/frameworkSchema/installation/canonical";
import {
  appendFrameworkSchemaAvailabilityHistoryInTransactionEffect,
} from "../../../src/installation/frameworkSchema/installation/availabilityHistoryRepository";
import {
  ensureFrameworkSchemaInstallationInTransactionEffect,
} from "../../../src/installation/frameworkSchema/installation/installationRepository";
import {
  ensureFrameworkSchemaReadinessInTransactionEffect,
} from "../../../src/installation/frameworkSchema/installation/readinessRepository";
import {
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationAttemptTerminal,
  captureFrameworkMigrationPlanAdmission,
  captureFreshRelationalMigrationPlan,
} from "../../../src/installation/migrationCoordination/canonical";
import {
  ensureFrameworkMigrationAttemptStartInTransactionEffect,
} from "../../../src/installation/migrationCoordination/migrationAttemptRepository";
import {
  ensureFrameworkMigrationAttemptTerminalInTransactionEffect,
} from "../../../src/installation/migrationCoordination/migrationAttemptTerminalRepository";
import {
  ensureFrameworkMigrationPlanAdmissionInTransactionEffect,
} from "../../../src/installation/migrationCoordination/migrationPlanAdmissionRepository";
import {
  ensureFreshRelationalMigrationPlanInTransactionEffect,
} from "../../../src/installation/migrationCoordination/migrationPlanRepository";
import {
  ensureRelationalPhysicalNameAssignmentsInTransactionEffect,
} from "../../../src/installation/migrationCoordination/physicalNameAssignmentRepository";
import {
  ensureFrameworkMigrationStepReceiptInTransactionEffect,
} from "../../../src/installation/migrationCoordination/migrationStepReceiptRepository";
import type {
  RestoredFrameworkMigrationStepReceipt,
} from "../../../src/installation/migrationCoordination/storedRestoration";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "../../../src/installation/migrationCoordination/targetCollisionRepository";
import { captureRelationalPhysicalLayout } from
  "../../../src/storage/relationalSchema/physical/canonical";
import { runEffect } from "../../support/effectTestRuntime";
import {
  FRAMEWORK_VALUE_LOCATOR,
  completeFrameworkMigrationPlanSteps,
  frameworkTargetNamespace,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";

export const COORDINATOR_STARTED_AT = "2026-08-27T08:30:00.000Z";
export const COORDINATOR_COMPLETED_AT = "2026-08-27T08:31:00.000Z";
export const COORDINATOR_TERMINAL_AT = "2026-08-27T08:33:00.000Z";
export const COORDINATOR_INSTALLED_AT = "2026-08-27T08:34:00.000Z";
export const COORDINATOR_VALIDATED_AT = "2026-08-27T08:35:00.000Z";
export const COORDINATOR_AVAILABLE_AT = "2026-08-27T08:36:00.000Z";

export async function createSuccessfulTerminalPlanValues(extraTables = 0, schemaName: string = FRAMEWORK_VALUE_LOCATOR.schemaName) {
  const artifact = await syntheticSystemArtifact(extraTables);
  const targetValue = await frameworkTargetNamespace(schemaName);
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
    artifact: artifact.artifact,
    physicalLocator: { ...FRAMEWORK_VALUE_LOCATOR, schemaName },
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
  attemptId = "attempt-a",
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
  await runEffect(
    ensureRelationalPhysicalNameAssignmentsInTransactionEffect(
      transaction,
      collision,
      physicalLayout.nameAssignments,
    ),
  );
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
    attemptId,
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

export async function storeSuccessfulInstallationGraphInTransaction(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof createSuccessfulTerminalPlanValues>>,
) {
  const graph = await storeSuccessfulTerminalGraphInTransaction(
    transaction,
    values,
  );
  const installationValue = await runEffect(
    captureFrameworkSchemaInstallation({
      plan: graph.terminal.attempt.plan.plan,
      admission: graph.terminal.attempt.admission.admission,
      terminal: graph.terminal.terminal,
      installedStructureSha256:
        graph.terminal.attempt.plan.plan.physicalLayout.layoutSha256,
      installedPhysicalCapabilities:
        graph.terminal.attempt.plan.plan.physicalLayout.frame
          .requiredPhysicalCapabilities,
      installedAt: COORDINATOR_INSTALLED_AT,
    }),
  );
  const installation = await runEffect(
    ensureFrameworkSchemaInstallationInTransactionEffect(
      transaction,
      graph.terminal,
      installationValue,
    ),
  );
  return Object.freeze({ ...graph, installationValue, installation });
}

export async function storeSuccessfulReadinessGraphInTransaction(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof createSuccessfulTerminalPlanValues>>,
) {
  const graph = await storeSuccessfulInstallationGraphInTransaction(
    transaction,
    values,
  );
  const capabilities =
    graph.installation.installation.frame.installedPhysicalCapabilities;
  const readinessValue = await runEffect(captureFrameworkSchemaReadiness({
    installation: graph.installation.installation,
    validationSha256: "33".repeat(32),
    validatedStructureSha256:
      graph.installation.installation.frame.installedStructureSha256,
    validatedPhysicalCapabilities: capabilities,
    residualRequirements: capabilities.map(capability => Object.freeze({
      capability: capability.identity,
      requirement: capability.residualRequirement,
    })),
    validatedAt: COORDINATOR_VALIDATED_AT,
  }));
  const readiness = await runEffect(
    ensureFrameworkSchemaReadinessInTransactionEffect(
      transaction,
      graph.installation,
      readinessValue,
    ),
  );
  return Object.freeze({
    ...graph,
    collision: readiness.installation.collision,
    plan: readiness.installation.plan,
    admission: readiness.installation.admission,
    attempt: readiness.installation.terminal.attempt,
    terminal: readiness.installation.terminal,
    installation: readiness.installation,
    readinessValue,
    readiness,
  });
}

export async function storeSuccessfulAvailabilityHistoryGraphInTransaction(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof createSuccessfulTerminalPlanValues>>,
) {
  const graph = await storeSuccessfulReadinessGraphInTransaction(
    transaction,
    values,
  );
  const availabilityHistoryValue = await runEffect(
    captureFrameworkSchemaAvailabilityHistory({
      readiness: graph.readiness.readiness,
      previous: null,
      status: "ready",
      reasonSha256: null,
      recordedAt: COORDINATOR_AVAILABLE_AT,
    }),
  );
  const availabilityHistory = await runEffect(
    appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
      transaction,
      graph.readiness,
      null,
      availabilityHistoryValue,
    ),
  );
  return Object.freeze({
    availabilityHistoryValue,
    availabilityHistory,
  });
}

export function rejectingSelectTransaction(
  transaction: FlarexMetadataTransaction,
  cause: unknown,
  matchesSelection?: (selection: unknown) => boolean,
): FlarexMetadataTransaction {
  function rejectAtLimit(input: UnknownRecord): UnknownRecord {
    return new Proxy(input, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (typeof member !== "function") return member;
        if (property === "limit") return () => Promise.reject(cause);
        return (...args: unknown[]) => {
          const next = Reflect.apply(member, target, args);
          if (!isNonArrayRecord(next)) {
            throw new TypeError("Coordinator read builder must remain an object");
          }
          return rejectAtLimit(next);
        };
      },
    });
  }

  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property !== "select") return Reflect.get(target, property, receiver);
      if (matchesSelection === undefined) {
        return () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.reject(cause),
            }),
          }),
        });
      }
      const select = Reflect.get(target, property, receiver);
      if (typeof select !== "function") return select;
      return (...args: unknown[]) => {
        const query = Reflect.apply(select, target, args);
        if (!matchesSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError("Coordinator select must return an object");
        }
        return rejectAtLimit(query);
      };
    },
  });
}
