export interface ExecutorCleanupErrorInput {
  readonly primaryError: unknown;
  readonly cleanupError: unknown;
}

export type ExecutorCleanupErrorReporter<Input> = (
  input: Input,
) => void | Promise<void>;

export async function reportSecondaryCleanupError<Input>(
  reporter: ExecutorCleanupErrorReporter<Input> | undefined,
  input: Input,
): Promise<void> {
  try {
    await reporter?.(input);
  } catch {
    // Cleanup reporting is best effort and must never replace the primary error.
  }
}
