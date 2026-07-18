export type H05EvidenceWindow<Timestamp extends string> = {
  readonly finishedAt: Timestamp;
  readonly startedAt: Timestamp;
};

export type H05EvidenceWindowFieldOrder =
  | "finishedAtFirst"
  | "startedAtFirst";

type H05EvidenceRecordDecoder = (
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
) => Readonly<Record<string, unknown>>;

/**
 * Decodes the common two-timestamp H05 evidence window while retaining the
 * caller's record policy, timestamp brand, diagnostics, and field order.
 */
export function decodeH05EvidenceWindow<Timestamp extends string>(
  value: unknown,
  path: string,
  decodeRecord: H05EvidenceRecordDecoder,
  decodeTimestamp: (value: unknown, path: string) => Timestamp,
  fieldOrder: H05EvidenceWindowFieldOrder,
): H05EvidenceWindow<Timestamp> {
  const record = decodeRecord(value, path, ["finishedAt", "startedAt"]);
  if (fieldOrder === "startedAtFirst") {
    const startedAt = decodeTimestamp(record.startedAt, `${path}.startedAt`);
    const finishedAt = decodeTimestamp(record.finishedAt, `${path}.finishedAt`);
    return { startedAt, finishedAt };
  }
  const finishedAt = decodeTimestamp(record.finishedAt, `${path}.finishedAt`);
  const startedAt = decodeTimestamp(record.startedAt, `${path}.startedAt`);
  return { finishedAt, startedAt };
}
