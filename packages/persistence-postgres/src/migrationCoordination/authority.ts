import type {
  FrameworkMigrationAttemptStartSha256,
  FrameworkMigrationAttemptTerminalSha256,
  FrameworkMigrationPlanAdmissionSha256,
  FrameworkMigrationStepReceiptSha256,
} from "./identity";
import type {
  CapturedFrameworkMigrationValue,
  FrameworkMigrationAttemptStartFrame,
  FrameworkMigrationAttemptTerminalFrame,
  FrameworkMigrationPlanAdmissionFrame,
  FrameworkMigrationStep,
  FrameworkMigrationStepReceiptFrame,
  FreshRelationalMigrationPlan,
} from "./model";

type PlanAdmission = CapturedFrameworkMigrationValue<
  FrameworkMigrationPlanAdmissionFrame,
  FrameworkMigrationPlanAdmissionSha256
>;

type MigrationAttempt = CapturedFrameworkMigrationValue<
  FrameworkMigrationAttemptStartFrame,
  FrameworkMigrationAttemptStartSha256
>;

type StepReceipt = CapturedFrameworkMigrationValue<
  FrameworkMigrationStepReceiptFrame,
  FrameworkMigrationStepReceiptSha256
>;

type AttemptTerminal = CapturedFrameworkMigrationValue<
  FrameworkMigrationAttemptTerminalFrame,
  FrameworkMigrationAttemptTerminalSha256
>;

export interface CapturedMigrationAttemptAuthority {
  readonly admission: PlanAdmission;
  readonly plan: FreshRelationalMigrationPlan;
}

export interface CapturedMigrationStepReceiptAuthority {
  readonly attempt: MigrationAttempt;
  readonly step: FrameworkMigrationStep;
}

const capturedPlans = new WeakSet<FreshRelationalMigrationPlan>();
const capturedPlanSteps = new WeakMap<
  FrameworkMigrationStep,
  FreshRelationalMigrationPlan
>();
const capturedAdmissions = new WeakMap<PlanAdmission, FreshRelationalMigrationPlan>();
const capturedAttempts = new WeakMap<
  MigrationAttempt,
  CapturedMigrationAttemptAuthority
>();
const capturedStepReceipts = new WeakMap<
  StepReceipt,
  CapturedMigrationStepReceiptAuthority
>();
const capturedTerminals = new WeakMap<AttemptTerminal, PlanAdmission>();

export function registerCapturedFreshRelationalMigrationPlan(
  plan: FreshRelationalMigrationPlan,
): void {
  for (const step of plan.frame.steps) {
    capturedPlanSteps.set(step, plan);
  }
  capturedPlans.add(plan);
}

export function isCapturedFreshRelationalMigrationPlanAuthority(
  plan: FreshRelationalMigrationPlan,
): boolean {
  return capturedPlans.has(plan);
}

export function capturedPlanForStep(
  step: FrameworkMigrationStep,
): FreshRelationalMigrationPlan | undefined {
  return capturedPlanSteps.get(step);
}

export function registerCapturedFrameworkMigrationPlanAdmission(
  admission: PlanAdmission,
  plan: FreshRelationalMigrationPlan,
): void {
  capturedAdmissions.set(admission, plan);
}

export function capturedPlanForAdmission(
  admission: PlanAdmission,
): FreshRelationalMigrationPlan | undefined {
  return capturedAdmissions.get(admission);
}

export function registerCapturedFrameworkMigrationAttemptStart(
  attempt: MigrationAttempt,
  authority: CapturedMigrationAttemptAuthority,
): void {
  capturedAttempts.set(attempt, Object.freeze({ ...authority }));
}

export function capturedAuthorityForAttempt(
  attempt: MigrationAttempt,
): CapturedMigrationAttemptAuthority | undefined {
  return capturedAttempts.get(attempt);
}

export function registerCapturedFrameworkMigrationStepReceipt(
  receipt: StepReceipt,
  authority: CapturedMigrationStepReceiptAuthority,
): void {
  capturedStepReceipts.set(receipt, Object.freeze({ ...authority }));
}

export function capturedAuthorityForStepReceipt(
  receipt: StepReceipt,
): CapturedMigrationStepReceiptAuthority | undefined {
  return capturedStepReceipts.get(receipt);
}

export function registerCapturedFrameworkMigrationAttemptTerminal(
  terminal: AttemptTerminal,
  admission: PlanAdmission,
): void {
  capturedTerminals.set(terminal, admission);
}

export function isCapturedFrameworkMigrationAttemptTerminalAuthority(
  terminal: AttemptTerminal,
): boolean {
  return capturedTerminals.has(terminal);
}

export function capturedFrameworkMigrationTerminalAdmission(
  terminal: AttemptTerminal,
): PlanAdmission | undefined {
  return capturedTerminals.get(terminal);
}
