import {
  PointMutationExecutionClaimAcquisitionInputV1Error,
} from "../claims/transactionExecutionClaimErrors";
import type { FiniteEntryAttemptKernelContext } from "./kernelContracts";
import { Result } from "effect";

declare const finiteRecoveryAttemptBrand: unique symbol;

/** Original admitted request evidence only. This grants no execution claim. */
export interface FiniteRecoveryAttempt { readonly [finiteRecoveryAttemptBrand]: true }

const finiteRecoveryAttempts = new WeakMap<FiniteRecoveryAttempt, FiniteEntryAttemptKernelContext>();

export function readFiniteRecoveryAttempt(capture: FiniteRecoveryAttempt): Result.Result<FiniteEntryAttemptKernelContext,
  PointMutationExecutionClaimAcquisitionInputV1Error> {
  const context = finiteRecoveryAttempts.get(capture);
  return context === undefined ? Result.fail(new PointMutationExecutionClaimAcquisitionInputV1Error({ reason: "invalidSelector" })) : Result.succeed(structuredClone(context));
}

/** Package-local issuer called only by the original locked acquisition owner. */
export function issueFiniteRecoveryAttempt(context: FiniteEntryAttemptKernelContext): FiniteRecoveryAttempt {
  // SAFETY: the locked acquisition owner supplies the original admitted evidence.
  const capture = Object.freeze({}) as FiniteRecoveryAttempt;
  finiteRecoveryAttempts.set(capture, context);
  return capture;
}
