import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  ScopeSyncActiveHeadObservationV1Schema,
  decodeScopeSyncActiveHeadObservationV1Result,
} from "../src/scope-sync-v1";

describe("scope sync active-head observation v1 protocol", () => {
  it("strictly decodes, owns, and canonically encodes the observation", () => {
    const decoded = Result.getOrThrow(
      decodeScopeSyncActiveHeadObservationV1Result(rawObservation()),
    );

    expect(decoded).toEqual({
      ...rawObservation(),
      storageGenerationFence: 9n,
      observedAtCommitSeq: 12n,
      activationSequence: 3n,
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Schema.encodeSync(ScopeSyncActiveHeadObservationV1Schema)(decoded))
      .toEqual(rawObservation());
  });

  it.each([
    ["unknown field", { ...rawObservation(), unexpected: true }],
    ["legacy generation", {
      ...rawObservation(),
      storageGeneration: "legacy_v1",
    }],
    ["zero generation fence", {
      ...rawObservation(),
      storageGenerationFence: "0",
    }],
    ["negative observed commit", {
      ...rawObservation(),
      observedAtCommitSeq: "-1",
    }],
    ["zero activation sequence", {
      ...rawObservation(),
      activationSequence: "0",
    }],
    ["malformed active-head digest", {
      ...rawObservation(),
      activeHeadSha256Hex: "AA".repeat(32),
    }],
  ] as const)("rejects %s", (_name, input) => {
    expect(Result.isFailure(
      decodeScopeSyncActiveHeadObservationV1Result(input),
    )).toBe(true);
  });
});

function rawObservation() {
  return {
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: "00000000-0000-4000-8000-000000000001",
    epochUuid: "00000000-0000-4000-8000-000000000002",
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: "9",
    observedAtCommitSeq: "12",
    activationSequence: "3",
    activeHeadSha256Hex: "11".repeat(32),
  } as const;
}
