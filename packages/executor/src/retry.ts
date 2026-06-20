import {
  InvokeSessionIndexOccConflictError,
  InvokeSessionOccConflictError,
  InvokeSessionTableOccConflictError,
} from "@flarex/persistence-postgres";

import {
  InvokeRetryExhaustedError,
  InvokeRetryPolicyError,
} from "./errors";
import {
  abortInvokeSession,
  beginInvokeSession,
  finishInvokeSession,
  invokeSyscall,
} from "./sessions";
import type {
  Clock,
  FlarexExecutorPersistence,
  IdGenerator,
  RunInvokeWithRetriesInput,
  RunInvokeWithRetriesResult,
} from "./types";

const DEFAULT_MAX_ATTEMPTS = 8;

export async function runInvokeWithRetries(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  ids: IdGenerator,
  input: RunInvokeWithRetriesInput,
): Promise<RunInvokeWithRetriesResult> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isFinite(maxAttempts) ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts <= 0
  ) {
    throw new InvokeRetryPolicyError("maxAttempts must be a positive integer.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session = await beginInvokeSession(persistence, clock, ids, input);

    try {
      const value = await input.runAttempt({
        attempt,
        maxAttempts,
        session,
        syscall: (syscall) =>
          invokeSyscall(persistence, {
            deploymentId: input.deploymentId,
            projectId: input.projectId,
            sessionId: session.sessionId,
            syscall,
          }),
      });
      const finished = await finishInvokeSession(persistence, clock, {
        deploymentId: input.deploymentId,
        projectId: input.projectId,
        sessionId: session.sessionId,
        value,
      });
      return {
        ...finished,
        attempts: attempt,
      };
    } catch (error) {
      await abortAttempt(persistence, clock, input, session.sessionId);

      if (session.function.kind === "mutation" && isRetryableInvokeError(error)) {
        if (attempt < maxAttempts) {
          continue;
        }
        throw new InvokeRetryExhaustedError(maxAttempts, error);
      }

      throw error;
    }
  }

  throw new InvokeRetryPolicyError("maxAttempts must be a positive integer.");
}

export function isRetryableInvokeError(error: unknown): boolean {
  if (
    error instanceof InvokeSessionOccConflictError ||
    error instanceof InvokeSessionTableOccConflictError ||
    error instanceof InvokeSessionIndexOccConflictError
  ) {
    return true;
  }

  const record = asErrorRecord(error);
  if (record === null) {
    return false;
  }
  return (
    record.name === "InvokeSessionOccConflictError" ||
    record.name === "InvokeSessionTableOccConflictError" ||
    record.name === "InvokeSessionIndexOccConflictError" ||
    record.code === "40001"
  );
}

async function abortAttempt(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: Pick<RunInvokeWithRetriesInput, "deploymentId" | "projectId">,
  sessionId: string,
): Promise<void> {
  try {
    await abortInvokeSession(persistence, clock, {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      sessionId,
    });
  } catch {
    // The attempt may already be non-active if the failure happened after a
    // successful finish path. Preserve the original user or commit error.
  }
}

function asErrorRecord(
  error: unknown,
): { name?: unknown; code?: unknown } | null {
  return typeof error === "object" && error !== null
    ? (error as { name?: unknown; code?: unknown })
    : null;
}
