/** A bounded test-runner policy; it grants no database or runtime authority. */
export function frameworkTestWorkers(input: {
  readonly native: boolean;
  readonly freeMemoryBytes: number;
  readonly availableProcessors: number;
  readonly requestedWorkers: string | undefined;
}): 1 | 2 {
  const requested = input.requestedWorkers;
  if (requested !== undefined && requested !== "1" && requested !== "2") {
    throw new Error("FLAREX_TEST_WORKERS must be 1 or 2");
  }
  const gibibyte = 1024 ** 3;
  const requiredMemory = (input.native ? 4 : 7) * gibibyte;
  return requested !== "1" && input.availableProcessors >= 2 &&
    input.freeMemoryBytes >= requiredMemory ? 2 : 1;
}
