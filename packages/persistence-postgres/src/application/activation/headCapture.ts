import type {
  DecodedApplicationActivation,
  DecodedApplicationActiveHead,
} from "../activeHead/contracts";
import type { ApplicationActiveHeadStateError } from "../activeHead/errors";
import type {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "../applicationActivationSchema";
import {
  decodeApplicationActivationRowEffect,
  decodeApplicationActiveHeadRowEffect,
} from "../applicationActiveHeadRead";
import { activationError, type ApplicationActivationError } from "./errors";
import { Effect } from "effect";

export type DecodedHead = DecodedApplicationActiveHead;

export type DecodedActivation = DecodedApplicationActivation;

export function decodeHead(
  row: typeof fxSystemApplicationActiveHeads.$inferSelect,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<DecodedHead, ApplicationActivationError> {
  return decodeApplicationActiveHeadRowEffect(row).pipe(Effect.mapError(error =>
    activationError(
      operation,
      error.reason === "resourceFailure" ? "resourceFailure" : "storedState",
      revisionId ?? error.revisionId,
      error.retryable,
      error.cause,
    )
  ));
}

export function decodeActivation(
  row: typeof fxSystemApplicationActivations.$inferSelect,
  operation: ApplicationActivationError["operation"],
  revisionId: string,
): Effect.Effect<DecodedActivation, ApplicationActivationError> {
  return decodeApplicationActivationRowEffect(row).pipe(Effect.mapError(error =>
    activationError(
      operation,
      error.reason === "resourceFailure" ? "resourceFailure" : "storedState",
      revisionId,
      error.retryable,
      error.cause,
    )
  ));
}

export function activeHeadFailure(
  operation: ApplicationActivationError["operation"],
  error: ApplicationActiveHeadStateError,
  revisionId?: string,
): ApplicationActivationError {
  return activationError(
    operation,
    error.reason === "resourceFailure" ? "resourceFailure" : "storedState",
    revisionId ?? error.revisionId,
    error.retryable,
    error.cause,
  );
}