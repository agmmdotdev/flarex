import type {
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationResultV1,
  PointMutationSessionTerminalLifecycleV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import { isCanonicalIsoTimestamp } from "flarex-protocol/iso-timestamp";
import { Result } from "effect";

import { isPlainRecord } from "./plainRecord";

export type PointMutationSessionAttemptTerminalizationContractIssueV1 =
  | { readonly reason: "selectorMismatch" }
  | { readonly reason: "invalidStatusOrLifecycle" }
  | { readonly reason: "invalidTerminalTimestamp" };

export class PointMutationSessionAttemptTerminalizationContractV1Error
  extends Error {
  readonly _tag =
    "PointMutationSessionAttemptTerminalizationContractV1Error" as const;
  readonly name =
    "PointMutationSessionAttemptTerminalizationContractV1Error";

  constructor(
    readonly issue: PointMutationSessionAttemptTerminalizationContractIssueV1,
  ) {
    super(
      `Attempt-terminalization persistence violated its contract: ${issue.reason}.`,
    );
  }
}

export function capturePointMutationSessionAttemptTerminalizationResultV1(
  selector: PointMutationSessionAttemptSelectorV1,
  result: unknown,
): Result.Result<
  PointMutationSessionAttemptTerminalizationResultV1,
  PointMutationSessionAttemptTerminalizationContractV1Error
> {
  if (!isPlainRecord(result)) {
    return Result.fail(
      terminalizationContractError("invalidStatusOrLifecycle"),
    );
  }
  return Result.gen(function* () {
    const status = yield* readTerminalizationDataProperty(
      result,
      "status",
      "invalidStatusOrLifecycle",
    );
    const terminalValue = yield* readTerminalizationDataProperty(
      result,
      "terminal",
      "invalidStatusOrLifecycle",
    );
    if (!isPlainRecord(terminalValue)) {
      return yield* Result.fail(
        terminalizationContractError("invalidStatusOrLifecycle"),
      );
    }
    const deploymentId = yield* readTerminalizationDataProperty(
      terminalValue,
      "deploymentId",
      "selectorMismatch",
    );
    const scopeId = yield* readTerminalizationDataProperty(
      terminalValue,
      "scopeId",
      "selectorMismatch",
    );
    const sessionId = yield* readTerminalizationDataProperty(
      terminalValue,
      "sessionId",
      "selectorMismatch",
    );
    const attemptFence = yield* readTerminalizationDataProperty(
      terminalValue,
      "attemptFence",
      "selectorMismatch",
    );
    if (
      deploymentId !== selector.deploymentId ||
      scopeId !== selector.scopeId ||
      sessionId !== selector.sessionId ||
      attemptFence !== selector.attemptFence
    ) {
      return yield* Result.fail(
        terminalizationContractError("selectorMismatch"),
      );
    }
    const lifecycle = yield* readTerminalizationDataProperty(
      terminalValue,
      "lifecycle",
      "invalidStatusOrLifecycle",
    );
    if (
      !isPointMutationSessionTerminalLifecycle(lifecycle) ||
      (status !== "terminalized" && status !== "observed")
    ) {
      return yield* Result.fail(
        terminalizationContractError("invalidStatusOrLifecycle"),
      );
    }
    const terminalizedAt = yield* readTerminalizationDataProperty(
      terminalValue,
      "terminalizedAt",
      "invalidTerminalTimestamp",
    );
    if (
      typeof terminalizedAt !== "string" ||
      !isCanonicalIsoTimestamp(terminalizedAt)
    ) {
      return yield* Result.fail(
        terminalizationContractError("invalidTerminalTimestamp"),
      );
    }
    switch (status) {
      case "terminalized": {
        if (lifecycle === "committed") {
          return yield* Result.fail(
            terminalizationContractError("invalidStatusOrLifecycle"),
          );
        }
        return Object.freeze({
          status: "terminalized" as const,
          terminal: Object.freeze({
            ...selector,
            lifecycle,
            terminalizedAt,
          }),
        });
      }
      case "observed":
        return Object.freeze({
          status: "observed" as const,
          terminal: Object.freeze({
            ...selector,
            lifecycle,
            terminalizedAt,
          }),
        });
    }
  });
}

function readTerminalizationDataProperty(
  input: Readonly<Record<string, unknown>>,
  field: string,
  invalidReason: PointMutationSessionAttemptTerminalizationContractIssueV1["reason"],
): Result.Result<
  unknown,
  PointMutationSessionAttemptTerminalizationContractV1Error
> {
  const descriptor = Object.getOwnPropertyDescriptor(input, field);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !("value" in descriptor)
  ) {
    return Result.fail(terminalizationContractError(invalidReason));
  }
  return Result.succeed(descriptor.value);
}

function isPointMutationSessionTerminalLifecycle(
  value: unknown,
): value is PointMutationSessionTerminalLifecycleV1 {
  return value === "committed" || value === "aborted" || value === "expired";
}

function terminalizationContractError(
  reason: PointMutationSessionAttemptTerminalizationContractIssueV1["reason"],
): PointMutationSessionAttemptTerminalizationContractV1Error {
  return new PointMutationSessionAttemptTerminalizationContractV1Error({
    reason,
  });
}
