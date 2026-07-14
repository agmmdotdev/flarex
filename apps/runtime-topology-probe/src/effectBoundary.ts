import { Effect, Option, Result, Schema } from "effect";

export async function protocolValueOrNull<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A | null> {
  const result = await Effect.runPromise(Effect.result(effect));
  return Result.isSuccess(result) ? result.success : null;
}

/**
 * Compile a strict, synchronous schema decoder for host adapters that
 * intentionally normalize ordinary wire-contract mismatches to `null`.
 * Unlike `protocolValueOrNull`, this does not start an Effect runtime for each
 * RPC value converted inside one Worker or Durable Object request.
 */
export function strictSchemaValueOrNullDecoder<
  S extends Schema.ConstraintDecoder<unknown>,
>(schema: S): (value: unknown) => S["Type"] | null {
  const decode = Schema.decodeUnknownOption(schema, {
    onExcessProperty: "error",
  });
  return value => Option.getOrNull(decode(value));
}

/**
 * Cloudflare RPC adds a non-enumerable Symbol.dispose property to every
 * returned object. Copy the enumerable string-keyed wire fields before a
 * strict Schema decode so the transport lifecycle marker is not mistaken for
 * an application protocol field. Unexpected string fields remain visible to
 * strict excess-property checks. Probe RPC results contain only structured
 * data and no stubs, so their execution context performs automatic disposal.
 */
export function copyCloudflareRpcRecord(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value));
}
