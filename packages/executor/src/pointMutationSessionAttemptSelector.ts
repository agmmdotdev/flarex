import type {
  PointMutationSessionAttemptSelectorV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import { Result } from "effect";

import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionSessionIdV1Schema,
  decodeTransactionAttemptFence,
} from "flarex-protocol/transaction-session";

import { isPlainRecord } from "./plainRecord";

export type PointMutationSessionAttemptSelectorIssueV1 =
  | { readonly reason: "notPlainObject" }
  | { readonly reason: "unexpectedFields" }
  | { readonly reason: "invalidFieldShape"; readonly field: string }
  | { readonly reason: "invalidFieldValue"; readonly cause: unknown };

export class InvalidPointMutationSessionAttemptSelectorV1Error extends Error {
  readonly _tag = "InvalidPointMutationSessionAttemptSelectorV1Error" as const;
  readonly name = "InvalidPointMutationSessionAttemptSelectorV1Error";

  constructor(readonly issue: PointMutationSessionAttemptSelectorIssueV1) {
    super(`Point-mutation attempt selector is invalid: ${issue.reason}.`);
  }
}

/**
 * Shared strict decoder for the public throwing compatibility boundary and the
 * private Effect recovery boundary. The selector is only a locator.
 */
export function decodePointMutationSessionAttemptSelectorV1Result(
  input: unknown,
): Result.Result<
  PointMutationSessionAttemptSelectorV1,
  InvalidPointMutationSessionAttemptSelectorV1Error
> {
  return Result.try({
    try: () => decodePointMutationSessionAttemptSelectorV1Unsafe(input),
    catch: (cause) => cause instanceof
        InvalidPointMutationSessionAttemptSelectorV1Error
      ? cause
      : new InvalidPointMutationSessionAttemptSelectorV1Error({
          reason: "invalidFieldValue",
          cause,
        }),
  });
}

export function decodePointMutationSessionAttemptSelectorV1(
  input: unknown,
): PointMutationSessionAttemptSelectorV1 {
  return Result.getOrThrow(
    decodePointMutationSessionAttemptSelectorV1Result(input),
  );
}

function decodePointMutationSessionAttemptSelectorV1Unsafe(
  input: unknown,
): PointMutationSessionAttemptSelectorV1 {
  if (!isPlainRecord(input)) {
    throw new InvalidPointMutationSessionAttemptSelectorV1Error({
      reason: "notPlainObject",
    });
  }
  const expectedKeys = new Set<string>([
    "attemptFence",
    "deploymentId",
    "scopeId",
    "sessionId",
  ]);
  const actualKeys = Reflect.ownKeys(input);
  if (
    actualKeys.length !== expectedKeys.size ||
    actualKeys.some((key) =>
      typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw new InvalidPointMutationSessionAttemptSelectorV1Error({
      reason: "unexpectedFields",
    });
  }
  const deploymentId = readSelectorString(input, "deploymentId");
  const scopeId = readSelectorString(input, "scopeId");
  const sessionId = readSelectorString(input, "sessionId");
  const attemptFenceText = readSelectorString(input, "attemptFence");
  try {
    return Object.freeze({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(deploymentId),
      scopeId: decodeReplacementScopeIdV1(scopeId),
      sessionId: TransactionSessionIdV1Schema.make(sessionId),
      attemptFence: decodeTransactionAttemptFence(attemptFenceText),
    });
  } catch (cause) {
    throw new InvalidPointMutationSessionAttemptSelectorV1Error({
      reason: "invalidFieldValue",
      cause,
    });
  }
}

function readSelectorString(
  input: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const descriptor = Object.getOwnPropertyDescriptor(input, field);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "string"
  ) {
    throw new InvalidPointMutationSessionAttemptSelectorV1Error({
      reason: "invalidFieldShape",
      field,
    });
  }
  return descriptor.value;
}
