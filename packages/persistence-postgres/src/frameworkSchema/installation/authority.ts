import type {
  FrameworkMigrationAttemptTerminalSha256,
  FrameworkMigrationPlanAdmissionSha256,
  FrameworkSchemaAvailabilityHistorySha256,
  FrameworkSchemaInstallationReceiptSha256,
  FrameworkSchemaReadinessSha256,
} from "../../migrationCoordination/identity";
import type {
  CapturedFrameworkMigrationValue,
  FrameworkMigrationAttemptTerminalFrame,
  FrameworkMigrationPlanAdmissionFrame,
  FreshRelationalMigrationPlan,
} from "../../migrationCoordination/model";
import type {
  CapturedFrameworkSchemaInstallationValue,
  FrameworkSchemaAvailabilityHead,
  FrameworkSchemaAvailabilityHistoryFrame,
  FrameworkSchemaInstallationFrame,
  FrameworkSchemaReadinessFrame,
} from "./model";

type Installation = CapturedFrameworkSchemaInstallationValue<
  FrameworkSchemaInstallationFrame,
  FrameworkSchemaInstallationReceiptSha256
>;

type Readiness = CapturedFrameworkSchemaInstallationValue<
  FrameworkSchemaReadinessFrame,
  FrameworkSchemaReadinessSha256
>;

type AvailabilityHistory = CapturedFrameworkSchemaInstallationValue<
  FrameworkSchemaAvailabilityHistoryFrame,
  FrameworkSchemaAvailabilityHistorySha256
>;

type PlanAdmission = CapturedFrameworkMigrationValue<
  FrameworkMigrationPlanAdmissionFrame,
  FrameworkMigrationPlanAdmissionSha256
>;

type AttemptTerminal = CapturedFrameworkMigrationValue<
  FrameworkMigrationAttemptTerminalFrame,
  FrameworkMigrationAttemptTerminalSha256
>;

export interface CapturedFrameworkSchemaInstallationAuthority {
  readonly plan: FreshRelationalMigrationPlan;
  readonly admission: PlanAdmission;
  readonly terminal: AttemptTerminal;
}

export interface CapturedFrameworkSchemaReadinessAuthority {
  readonly installation: Installation;
}

export interface CapturedFrameworkSchemaAvailabilityHistoryAuthority {
  readonly readiness: Readiness;
  readonly previous: AvailabilityHistory | null;
}

export interface CapturedFrameworkSchemaAvailabilityHeadAuthority {
  readonly readiness: Readiness;
  readonly history: AvailabilityHistory;
}

const capturedInstallations = new WeakSet<Installation>();
const capturedInstallationAuthorities = new WeakMap<
  Installation,
  CapturedFrameworkSchemaInstallationAuthority
>();
const capturedReadiness = new WeakSet<Readiness>();
const capturedReadinessAuthorities = new WeakMap<
  Readiness,
  CapturedFrameworkSchemaReadinessAuthority
>();
const capturedAvailabilityHistory = new WeakSet<AvailabilityHistory>();
const capturedAvailabilityHistoryAuthorities = new WeakMap<
  AvailabilityHistory,
  CapturedFrameworkSchemaAvailabilityHistoryAuthority
>();
const capturedAvailabilityHeads = new WeakSet<FrameworkSchemaAvailabilityHead>();
const capturedAvailabilityHeadAuthorities = new WeakMap<
  FrameworkSchemaAvailabilityHead,
  CapturedFrameworkSchemaAvailabilityHeadAuthority
>();

export function registerCapturedFrameworkSchemaInstallation(
  installation: Installation,
  authority: CapturedFrameworkSchemaInstallationAuthority,
): void {
  capturedInstallationAuthorities.set(
    installation,
    Object.freeze({ ...authority }),
  );
  capturedInstallations.add(installation);
}

export function isCapturedFrameworkSchemaInstallationAuthority(
  installation: Installation,
): boolean {
  return capturedInstallations.has(installation);
}

export function capturedAuthorityForFrameworkSchemaInstallation(
  installation: Installation,
): CapturedFrameworkSchemaInstallationAuthority | undefined {
  return capturedInstallationAuthorities.get(installation);
}

export function registerCapturedFrameworkSchemaReadiness(
  readiness: Readiness,
  authority: CapturedFrameworkSchemaReadinessAuthority,
): void {
  capturedReadinessAuthorities.set(readiness, Object.freeze({ ...authority }));
  capturedReadiness.add(readiness);
}

export function isCapturedFrameworkSchemaReadinessAuthority(
  readiness: Readiness,
): boolean {
  return capturedReadiness.has(readiness);
}

export function capturedAuthorityForFrameworkSchemaReadiness(
  readiness: Readiness,
): CapturedFrameworkSchemaReadinessAuthority | undefined {
  return capturedReadinessAuthorities.get(readiness);
}

export function registerCapturedFrameworkSchemaAvailabilityHistory(
  history: AvailabilityHistory,
  authority: CapturedFrameworkSchemaAvailabilityHistoryAuthority,
): void {
  capturedAvailabilityHistoryAuthorities.set(
    history,
    Object.freeze({ ...authority }),
  );
  capturedAvailabilityHistory.add(history);
}

export function isCapturedFrameworkSchemaAvailabilityHistoryAuthority(
  history: AvailabilityHistory,
): boolean {
  return capturedAvailabilityHistory.has(history);
}

export function capturedAuthorityForFrameworkSchemaAvailabilityHistory(
  history: AvailabilityHistory,
): CapturedFrameworkSchemaAvailabilityHistoryAuthority | undefined {
  return capturedAvailabilityHistoryAuthorities.get(history);
}

export function registerCapturedFrameworkSchemaAvailabilityHead(
  head: FrameworkSchemaAvailabilityHead,
  authority: CapturedFrameworkSchemaAvailabilityHeadAuthority,
): void {
  capturedAvailabilityHeadAuthorities.set(head, Object.freeze({ ...authority }));
  capturedAvailabilityHeads.add(head);
}

export function isCapturedFrameworkSchemaAvailabilityHeadAuthority(
  head: FrameworkSchemaAvailabilityHead,
): boolean {
  return capturedAvailabilityHeads.has(head);
}

export function capturedAuthorityForFrameworkSchemaAvailabilityHead(
  head: FrameworkSchemaAvailabilityHead,
): CapturedFrameworkSchemaAvailabilityHeadAuthority | undefined {
  return capturedAvailabilityHeadAuthorities.get(head);
}
