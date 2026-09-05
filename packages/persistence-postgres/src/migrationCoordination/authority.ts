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
  RelationalMigrationPlan,
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
  readonly plan: RelationalMigrationPlan;
}

export interface CapturedMigrationStepReceiptAuthority {
  readonly attempt: MigrationAttempt;
  readonly step: FrameworkMigrationStep;
}

export interface CapturedMigrationAttemptTerminalAuthority {
  readonly admission: PlanAdmission;
  readonly attempt: MigrationAttempt;
  readonly stepReceipts: readonly StepReceipt[];
}

const capturedPlans = new WeakSet<RelationalMigrationPlan>();
const capturedPlanSteps = new WeakMap<
  FrameworkMigrationStep,
  RelationalMigrationPlan
>();
const capturedAdmissions = new WeakMap<PlanAdmission, RelationalMigrationPlan>();
const capturedAttempts = new WeakMap<
  MigrationAttempt,
  CapturedMigrationAttemptAuthority
>();
const capturedStepReceipts = new WeakMap<
  StepReceipt,
  CapturedMigrationStepReceiptAuthority
>();
const capturedTerminals = new WeakMap<
  AttemptTerminal,
  CapturedMigrationAttemptTerminalAuthority
>();

export function registerCapturedFreshRelationalMigrationPlan(
  plan: RelationalMigrationPlan,
): void {
  for (const step of plan.frame.steps) {
    capturedPlanSteps.set(step, plan);
  }
  capturedPlans.add(plan);
}

export function isCapturedFreshRelationalMigrationPlanAuthority(
  plan: RelationalMigrationPlan,
): boolean {
  return capturedPlans.has(plan);
}

export function capturedPlanForStep(
  step: FrameworkMigrationStep,
): RelationalMigrationPlan | undefined {
  return capturedPlanSteps.get(step);
}

export function registerCapturedFrameworkMigrationPlanAdmission(
  admission: PlanAdmission,
  plan: RelationalMigrationPlan,
): void {
  capturedAdmissions.set(admission, plan);
}

export function capturedPlanForAdmission(
  admission: PlanAdmission,
): RelationalMigrationPlan | undefined {
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
  authority: CapturedMigrationAttemptTerminalAuthority,
): void {
  capturedTerminals.set(terminal, Object.freeze({
    admission: authority.admission,
    attempt: authority.attempt,
    stepReceipts: Object.freeze([...authority.stepReceipts]),
  }));
}

export function isCapturedFrameworkMigrationAttemptTerminalAuthority(
  terminal: AttemptTerminal,
): boolean {
  return capturedTerminals.has(terminal);
}

export function capturedFrameworkMigrationTerminalAdmission(
  terminal: AttemptTerminal,
): PlanAdmission | undefined {
  return capturedTerminals.get(terminal)?.admission;
}

export function capturedAuthorityForAttemptTerminal(
  terminal: AttemptTerminal,
): CapturedMigrationAttemptTerminalAuthority | undefined {
  return capturedTerminals.get(terminal);
}
