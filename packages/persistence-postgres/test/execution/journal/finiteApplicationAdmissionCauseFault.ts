import { Cause, Effect, Exit } from "effect";
import { expect, vi } from "vitest";
import * as finiteStorageCapture from "../../../src/execution/finiteStorageCapture";
import type { FiniteStorageCaptureError, FiniteStorageCaptureOperation } from "../../../src/execution/finiteStorageCapture";
import type { ExactRunningAttemptKernelInputV1 } from "../../../src/execution/session/kernelContracts";
import type { LocatedScopeClockReader } from "../../../src/scope/scopeAuthorityResolution";

/** This test-only finalizer fault delegates the real capture unchanged. Arming
 * happens after committed revocation; no accepted or refused header is forged. */
export function observeFiniteAdmissionCleanupFault() {
  const cleanupDefect = new Error("Finite admission test cleanup defect");
  const interruptionFiberId = 1_004_001;
  const cleanupCause = Cause.combine(Cause.die(cleanupDefect), Cause.interrupt(interruptionFiberId));
  const captureCauses: Cause.Cause<FiniteStorageCaptureError>[] = [];
  const actualCapture = finiteStorageCapture.captureFiniteStorageEffect;
  let armed = false;
  const observer = vi.spyOn(finiteStorageCapture, "captureFiniteStorageEffect").mockImplementation(
    function <K extends FiniteStorageCaptureOperation["kind"]>(target: LocatedScopeClockReader,
      input: ExactRunningAttemptKernelInputV1, operation: Extract<FiniteStorageCaptureOperation, { kind: K }>) {
      const effect = actualCapture<K>(target, input, operation);
      if (!armed || operation.kind !== "admission") return effect;
      armed = false;
      return effect.pipe(Effect.onExit(exit => Effect.sync(() => {
        if (Exit.isFailure(exit)) captureCauses.push(exit.cause);
      })), Effect.ensuring(Effect.failCause(cleanupCause)));
    });
  return { cleanupDefect, interruptionFiberId, captureCauses,
    arm() { armed = true; }, restore() { observer.mockRestore(); },
  };
}

/** Inspect every reason and its original identity at the owning test boundary.
 * No find-first, catchTag, squash or reconstructed Cause can hide a lost reason. */
export function expectFiniteAdmissionCleanupReasons<E>(cause: Cause.Cause<E>,
  fault: ReturnType<typeof observeFiniteAdmissionCleanupFault>) {
  expect(fault.captureCauses).toHaveLength(1);
  const original = fault.captureCauses[0];
  if (original === undefined) throw new Error("No genuine capture refusal was observed");
  expect(original.reasons).toMatchObject([{ _tag: "Fail", error: {
    _tag: "FiniteStorageCaptureError", reason: "authorizationRevocationEpochChanged",
  } }]);
  expect(cause.reasons).toHaveLength(3);
  expect(cause.reasons.map(reason => reason._tag).toSorted()).toEqual(["Die", "Fail", "Interrupt"]);
  expect(cause.reasons.some(reason => reason._tag === "Die" && reason.defect === fault.cleanupDefect)).toBe(true);
  expect(cause.reasons.some(reason => reason._tag === "Interrupt" && reason.fiberId === fault.interruptionFiberId)).toBe(true);
}
