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
  readonly completedStepCount: number;
}

const capturedPlans = new WeakMap<RelationalMigrationPlan, ReadonlyMap<string, FrameworkMigrationStep>>();
const planAdmissionRequirements = new WeakMap<RelationalMigrationPlan, "ordinary" | "commerce">();
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
  admissionRequirement?: "ordinary" | "commerce",
): void {
  const stepsById = new Map<string, FrameworkMigrationStep>();
  for (const step of plan.frame.steps) {
    capturedPlanSteps.set(step, plan);
    stepsById.set(step.stepId, step);
  }
  capturedPlans.set(plan, stepsById);
  if (admissionRequirement !== undefined) planAdmissionRequirements.set(plan, admissionRequirement);
}

export function capturedPlanAdmissionRequirement(plan: RelationalMigrationPlan): "ordinary" | "commerce" | undefined {
  return planAdmissionRequirements.get(plan);
}

/** Stored plans restore evidence. A freshly captured exact plan reissues admission authority. */
export function reaffirmCapturedPlanAdmissionAuthority(restored: RelationalMigrationPlan, source: RelationalMigrationPlan): boolean {
  const requirement = planAdmissionRequirements.get(source);
  if (!capturedPlans.has(restored) || requirement === undefined || restored.canonicalJson !== source.canonicalJson ||
    restored.physicalLayout.canonicalJson !== source.physicalLayout.canonicalJson) return false;
  planAdmissionRequirements.set(restored, requirement);
  return true;
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

/** Exact issued step identity, indexed once with its immutable owning plan. */
export function capturedStepForPlan(
  plan: RelationalMigrationPlan,
  stepId: string,
): FrameworkMigrationStep | undefined {
  return capturedPlans.get(plan)?.get(stepId);
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

/** Immutable value compatibility only. Stored ancestry is checked by restoration. */
export function capturedReceiptBelongsToAttemptPlan(
  receipt: StepReceipt,
  attempt: MigrationAttempt,
): boolean {
  const producer = capturedStepReceipts.get(receipt)?.attempt;
  const source = producer === undefined ? undefined : capturedAttempts.get(producer);
  const target = capturedAttempts.get(attempt);
  return producer !== undefined && source !== undefined && target !== undefined &&
    source.plan.migrationPlanSha256 === target.plan.migrationPlanSha256 &&
    source.plan.canonicalJson === target.plan.canonicalJson &&
    source.admission.sha256 === target.admission.sha256 &&
    source.admission.canonicalJson === target.admission.canonicalJson &&
    BigInt(producer.frame.attemptFence) <= BigInt(attempt.frame.attemptFence);
}

export function registerCapturedFrameworkMigrationAttemptTerminal(
  terminal: AttemptTerminal,
  authority: CapturedMigrationAttemptTerminalAuthority,
): void {
  capturedTerminals.set(terminal, Object.freeze({
    admission: authority.admission,
    attempt: authority.attempt,
    stepReceipts: Object.isFrozen(authority.stepReceipts) ? authority.stepReceipts : Object.freeze([...authority.stepReceipts]),
    completedStepCount: authority.completedStepCount,
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
