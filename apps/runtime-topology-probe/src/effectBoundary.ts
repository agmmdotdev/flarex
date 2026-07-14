import { Effect, Result } from "effect";

export async function protocolValueOrNull<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A | null> {
  const result = await Effect.runPromise(Effect.result(effect));
  return Result.isSuccess(result) ? result.success : null;
}
