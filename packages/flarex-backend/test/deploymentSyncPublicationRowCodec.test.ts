import {
  makeEmptyQuerySyncScopeFacts,
} from "@flarex/query-sync/internal/transition-plan";
import { Encoding, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeDeploymentQuerySyncInFlightPublicationRowResult,
  decodeDeploymentQuerySyncPublicationStateRowResult,
  type EncodedDeploymentQuerySyncPublicationStateRow,
} from "../src/deploymentSync/PublicationRowCodec";
import {
  makeBinding,
  success,
} from "./deploymentSyncStorageContractGeneration3TestSupport";

const EMPTY_PUBLICATION_STATE_ROW = Object.freeze({
  singleton: 1,
  attempt_ordinal: null,
  first_attempt_at: null,
  last_attempt_at: null,
  attempt_disposition: null,
  attempt_block_reason: null,
  latest_delivered_query_key: null,
  latest_delivered_generation: null,
  latest_delivered_result_digest: null,
  preceding_query_key: null,
  preceding_generation: null,
  preceding_result_digest: null,
  preceding_attempt_ordinal: null,
  preceding_outcome: null,
  preceding_receipt_tag: null,
  preceding_next_attempt_ordinal: null,
  preceding_next_disposition: null,
  preceding_block_reason: null,
} satisfies EncodedDeploymentQuerySyncPublicationStateRow);

function scope() {
  return makeEmptyQuerySyncScopeFacts(makeBinding().bootstrapCursor);
}

describe("deployment query-sync publication row codecs", () => {
  it("decodes the exact empty lifecycle singleton", () => {
    expect(success(decodeDeploymentQuerySyncPublicationStateRowResult(
      EMPTY_PUBLICATION_STATE_ROW,
      scope(),
      null,
    ))).toEqual({
      inFlight: null,
      latestDelivered: null,
      precedingAttemptOutcome: null,
    });
  });

  it("rejects noncanonical instants and partial preceding-outcome groups", () => {
    const inFlight = success(
      decodeDeploymentQuerySyncInFlightPublicationRowResult({
        singleton: 1,
        query_key: Encoding.encodeBase64Url(new Uint8Array(32).fill(1)),
        generation: "1",
        query_identity: Encoding.encodeBase64Url("codec-query"),
        completed_through_sequence: "0",
        result_digest: Encoding.encodeBase64Url(new Uint8Array(32).fill(2)),
        content: Encoding.encodeBase64Url("codec-publication"),
      }, scope()),
    );
    const noncanonicalInstant = decodeDeploymentQuerySyncPublicationStateRowResult(
      {
        ...EMPTY_PUBLICATION_STATE_ROW,
        attempt_ordinal: 1,
        first_attempt_at: "01",
        last_attempt_at: "1",
        attempt_disposition: "ready",
      },
      scope(),
      inFlight,
    );
    const partialPreceding = decodeDeploymentQuerySyncPublicationStateRowResult(
      {
        ...EMPTY_PUBLICATION_STATE_ROW,
        preceding_generation: "1",
      },
      scope(),
      null,
    );

    expect(Result.isFailure(noncanonicalInstant)).toBe(true);
    expect(Result.isFailure(partialPreceding)).toBe(true);
  });
});
