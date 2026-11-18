import { Encoding } from "effect";

export const APPLICATION_TASK_DISCOVERY_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 1_000,
  lockTimeoutMilliseconds: 250,
  statementTimeoutMilliseconds: 10_000,
  transactionTimeoutMilliseconds: 20_000,
  settlementReserveMilliseconds: 30_000,
});

export function replaceApplicationDispatchDigestInJson(
  value: unknown,
  digest: Uint8Array,
): unknown {
  if (Array.isArray(value)) {
    return value.map(member => replaceApplicationDispatchDigestInJson(
      member,
      digest,
    ));
  }
  if (value === null || typeof value !== "object") return value;
  const record = Object.fromEntries(Object.entries(value).map(([key, member]) => [
    key,
    replaceApplicationDispatchDigestInJson(member, digest),
  ]));
  return record.kind === "dispatch_attempt"
    ? {
        ...record,
        applicationTaskRuntimeTargetSha256: {
          "$flarex.uint8array.v1": Encoding.encodeBase64Url(digest),
        },
      }
    : record;
}
