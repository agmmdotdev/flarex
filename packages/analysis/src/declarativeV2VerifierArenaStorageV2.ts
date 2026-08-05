import type {
  DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  DECLARATIVE_V2_VERIFIER_ARENA_STORAGE_REGIONS_V2,
  DECLARATIVE_V2_VERIFIER_FACTORED_ARENA_POLICY_V2,
} from "./declarativeV2VerifierV1.contract";

export {
  DECLARATIVE_V2_VERIFIER_ARENA_STORAGE_REGIONS_V2,
  DECLARATIVE_V2_VERIFIER_FACTORED_ARENA_POLICY_V2,
};

export type DeclarativeV2VerifierArenaStorageRegionV2 =
  typeof DECLARATIVE_V2_VERIFIER_ARENA_STORAGE_REGIONS_V2[number]["name"];

export type DeclarativeV2VerifierArenaStorageV2 = Readonly<Record<
  DeclarativeV2VerifierArenaStorageRegionV2,
  bigint
>>;

const maximumEvidenceFrameBytes = (
  domainByteLength: bigint,
): bigint =>
  BigInt(
    DECLARATIVE_V2_VERIFIER_FACTORED_ARENA_POLICY_V2
      .maximumEvidenceFixedBytes,
  ) +
  domainByteLength *
    BigInt(
      DECLARATIVE_V2_VERIFIER_FACTORED_ARENA_POLICY_V2
        .maximumEvidenceTextFields *
        DECLARATIVE_V2_VERIFIER_FACTORED_ARENA_POLICY_V2
          .maximumJsonEscapeBytesPerInputByte,
    );

/**
 * Derives retained parse storage independently from cumulative verifier work.
 * The frame region contains one reusable canonical frame plus its fixed-width
 * value-flow/diagnostic order index. Canonical, hash, diagnostic-text, and
 * semantic-output totals remain exclusively in the terminal usage budget.
 */
export const deriveDeclarativeV2VerifierParseArenaStorageV2 = (
  required: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierArenaStorageV2 => {
  const frameScratch = maximumEvidenceFrameBytes(required.stringBytes) <
      required.frameBytes
    ? maximumEvidenceFrameBytes(required.stringBytes)
    : required.frameBytes;
  return Object.freeze({
    tokenBytesStorage: required.tokenBytes,
    stringBytesStorage: required.stringBytes,
    frameBytesStorage:
      frameScratch +
      (required.importEdges + required.graphNodes) *
        BigInt(
          DECLARATIVE_V2_VERIFIER_FACTORED_ARENA_POLICY_V2
            .evidenceIndexRecordBytes,
        ),
    diagnosticBytesStorage:
      required.graphNodes *
        BigInt(
          DECLARATIVE_V2_VERIFIER_FACTORED_ARENA_POLICY_V2
            .diagnosticRecordBytes,
        ),
    outputBytesStorage: required.stringBytes,
  });
};

/** Link retains copied module text and fixed-width diagnostic records only. */
export const deriveDeclarativeV2VerifierLinkArenaStorageV2 = (
  required: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierArenaStorageV2 => Object.freeze({
  tokenBytesStorage: 0n,
  stringBytesStorage: 0n,
  frameBytesStorage: 0n,
  diagnosticBytesStorage:
    required.graphNodes *
      BigInt(
        DECLARATIVE_V2_VERIFIER_FACTORED_ARENA_POLICY_V2
          .diagnosticRecordBytes,
      ),
  outputBytesStorage: required.outputBytes,
});
