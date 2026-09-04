/**
 * Returns UUIDs from a fixed test sequence, failing when exhausted.
 *
 * Test-local deterministic UUID supply; each executor test module keeps its
 * own sequence values while sharing only this exhaustion mechanic.
 */
export function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("UUID test sequence exhausted.");
    }
    return value;
  };
}
