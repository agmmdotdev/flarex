import { Effect } from "effect";

import type { LocatedScopeClockReader } from "./scopeAuthorityResolution";
import type {
  ExactRunningAttemptEffectWorkV1,
  FiniteRunningAttemptEffectWork,
  ExactRunningAttemptKernelInputV1,
  ExactRunningAttemptTransactionV1Error,
} from "./transactionSessionAttemptKernel";

/**
 * Genuinely package-local O10-P0 capability. Unlike the existing exact-attempt
 * kernel module, this file has no package export, including no system-test
 * subpath. Only persistence-postgres owners can receive the raw transaction
 * callback used to capture a bounded indexed-read syscall atomically.
 */
export const RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1:
  unique symbol = Symbol(
    "FlarexDB/runExactRunningPointMutationReadSyscallEffectV1",
  );

export interface LocatedExactRunningAttemptReadSyscallKernelV1
  extends LocatedScopeClockReader {
  readonly [RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1]: <
    Result,
    Failure,
  >(
    input: ExactRunningAttemptKernelInputV1,
    work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
  ) => Effect.Effect<Result, Failure | ExactRunningAttemptTransactionV1Error>;
}

export function isLocatedExactRunningAttemptReadSyscallKernelV1(
  target: LocatedScopeClockReader,
): target is LocatedExactRunningAttemptReadSyscallKernelV1 {
  return typeof Reflect.get(
    target,
    RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  ) === "function";
}

/** Explicit finite-only entry. Retained full/durable callbacks keep their existing lock profile. */
export const RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT: unique symbol =
  Symbol("FlarexDB/runFiniteRunningPointMutationReadSyscallEffect");
export interface LocatedFiniteRunningAttemptReadSyscallKernel extends LocatedScopeClockReader {
  readonly [RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT]: <Result, Failure>(
    input: ExactRunningAttemptKernelInputV1, work: FiniteRunningAttemptEffectWork<Result, Failure>,
  ) => Effect.Effect<Result, Failure | ExactRunningAttemptTransactionV1Error>;
}
export function isLocatedFiniteRunningAttemptReadSyscallKernel(target: LocatedScopeClockReader):
  target is LocatedFiniteRunningAttemptReadSyscallKernel {
  return typeof Reflect.get(target, RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT) === "function";
}
