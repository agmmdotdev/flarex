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

const queryKey = Encoding.encodeBase64Url(new Uint8Array(32).fill(1));
const resultDigest = Encoding.encodeBase64Url(new Uint8Array(32).fill(2));
const queryIdentity = Encoding.encodeBase64Url("codec-query");

const IN_FLIGHT_ROW = Object.freeze({
  singleton: 1,
  query_key: queryKey,
  generation: "1",
  query_identity: queryIdentity,
  completed_through_sequence: "0",
  result_digest: resultDigest,
  content: Encoding.encodeBase64Url("codec-publication"),
});

const IN_FLIGHT_STATE_ROW = Object.freeze({
  ...EMPTY_PUBLICATION_STATE_ROW,
  attempt_ordinal: 1,
  first_attempt_at: "100",
  last_attempt_at: "100",
  attempt_disposition: "ready" as const,
});

const LATEST_DELIVERED_STATE_ROW = Object.freeze({
  ...EMPTY_PUBLICATION_STATE_ROW,
  latest_delivered_query_key: queryKey,
  latest_delivered_generation: "1",
  latest_delivered_result_digest: resultDigest,
});

const PRECEDING_RECORDED_STATE_ROW = Object.freeze({
  ...EMPTY_PUBLICATION_STATE_ROW,
  preceding_query_key: queryKey,
  preceding_generation: "1",
  preceding_result_digest: resultDigest,
  preceding_attempt_ordinal: 1,
  preceding_outcome: "knownNotAppended" as const,
  preceding_receipt_tag: "recorded" as const,
  preceding_next_attempt_ordinal: 2,
  preceding_next_disposition: "ready" as const,
});

const PRECEDING_BLOCKED_STATE_ROW = Object.freeze({
  ...EMPTY_PUBLICATION_STATE_ROW,
  preceding_query_key: queryKey,
  preceding_generation: "1",
  preceding_result_digest: resultDigest,
  preceding_attempt_ordinal: 1,
  preceding_outcome: "terminalRefusal" as const,
  preceding_receipt_tag: "blocked" as const,
  preceding_block_reason: "terminalPublisherRefusal" as const,
});

function scope() {
  return makeEmptyQuerySyncScopeFacts(makeBinding().bootstrapCursor);
}

function inFlightPublication() {
  return success(decodeDeploymentQuerySyncInFlightPublicationRowResult(
    IN_FLIGHT_ROW,
    scope(),
  ));
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
    const inFlight = inFlightPublication();
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

  it.each([
    "attempt_ordinal",
    "first_attempt_at",
    "last_attempt_at",
    "attempt_disposition",
  ] as const)(
    "rejects an in-flight metadata group missing %s",
    field => {
      const result = decodeDeploymentQuerySyncPublicationStateRowResult(
        { ...IN_FLIGHT_STATE_ROW, [field]: null },
        scope(),
        inFlightPublication(),
      );

      expect(Result.isFailure(result)).toBe(true);
    },
  );

  it("rejects either half of the physical in-flight and metadata link", () => {
    expect(Result.isFailure(
      decodeDeploymentQuerySyncPublicationStateRowResult(
        IN_FLIGHT_STATE_ROW,
        scope(),
        null,
      ),
    )).toBe(true);
    expect(Result.isFailure(
      decodeDeploymentQuerySyncPublicationStateRowResult(
        EMPTY_PUBLICATION_STATE_ROW,
        scope(),
        inFlightPublication(),
      ),
    )).toBe(true);
  });

  it.each([
    { disposition: "ready", reason: "ageLimitReached" },
    { disposition: "uncertain", reason: "attemptLimitReached" },
    { disposition: "blocked", reason: null },
    { disposition: "blocked", reason: "not-a-block-reason" },
  ] as const)(
    "rejects disposition $disposition with block reason $reason",
    ({ disposition, reason }) => {
      const result = decodeDeploymentQuerySyncPublicationStateRowResult(
        {
          ...IN_FLIGHT_STATE_ROW,
          attempt_disposition: disposition,
          attempt_block_reason: reason,
        },
        scope(),
        inFlightPublication(),
      );

      expect(Result.isFailure(result)).toBe(true);
    },
  );

  it.each([
    "latest_delivered_query_key",
    "latest_delivered_generation",
    "latest_delivered_result_digest",
  ] as const)(
    "rejects a latest-delivered group missing %s",
    field => {
      const result = decodeDeploymentQuerySyncPublicationStateRowResult(
        { ...LATEST_DELIVERED_STATE_ROW, [field]: null },
        scope(),
        null,
      );

      expect(Result.isFailure(result)).toBe(true);
    },
  );

  it.each([
    "preceding_query_key",
    "preceding_generation",
    "preceding_result_digest",
    "preceding_attempt_ordinal",
    "preceding_outcome",
    "preceding_receipt_tag",
  ] as const)(
    "rejects a preceding-outcome group missing %s",
    field => {
      const result = decodeDeploymentQuerySyncPublicationStateRowResult(
        { ...PRECEDING_RECORDED_STATE_ROW, [field]: null },
        scope(),
        null,
      );

      expect(Result.isFailure(result)).toBe(true);
    },
  );

  it.each([
    {
      name: "recorded next ordinal",
      row: { ...PRECEDING_RECORDED_STATE_ROW,
        preceding_next_attempt_ordinal: null },
    },
    {
      name: "recorded next disposition",
      row: { ...PRECEDING_RECORDED_STATE_ROW,
        preceding_next_disposition: null },
    },
    {
      name: "recorded unexpected block reason",
      row: { ...PRECEDING_RECORDED_STATE_ROW,
        preceding_block_reason: "ageLimitReached" },
    },
    {
      name: "blocked reason",
      row: { ...PRECEDING_BLOCKED_STATE_ROW,
        preceding_block_reason: null },
    },
    {
      name: "blocked unexpected next ordinal",
      row: { ...PRECEDING_BLOCKED_STATE_ROW,
        preceding_next_attempt_ordinal: 2 },
    },
    {
      name: "blocked unexpected next disposition",
      row: { ...PRECEDING_BLOCKED_STATE_ROW,
        preceding_next_disposition: "ready" },
    },
  ] as const)("rejects an invalid $name receipt group", ({ row }) => {
    expect(Result.isFailure(
      decodeDeploymentQuerySyncPublicationStateRowResult(
        row,
        scope(),
        null,
      ),
    )).toBe(true);
  });

  it.each([
    { name: "leading-zero first instant", base: IN_FLIGHT_STATE_ROW,
      field: "first_attempt_at", value: "0100", physical: true },
    { name: "signed last instant", base: IN_FLIGHT_STATE_ROW,
      field: "last_attempt_at", value: "+100", physical: true },
    { name: "negative first instant", base: IN_FLIGHT_STATE_ROW,
      field: "first_attempt_at", value: "-1", physical: true },
    { name: "fractional last instant", base: IN_FLIGHT_STATE_ROW,
      field: "last_attempt_at", value: "100.0", physical: true },
    { name: "exponent last instant", base: IN_FLIGHT_STATE_ROW,
      field: "last_attempt_at", value: "1e2", physical: true },
    { name: "unsafe last instant", base: IN_FLIGHT_STATE_ROW,
      field: "last_attempt_at", value: "9007199254740992", physical: true },
    { name: "latest key", base: LATEST_DELIVERED_STATE_ROW,
      field: "latest_delivered_query_key", value: "=", physical: false },
    { name: "latest generation", base: LATEST_DELIVERED_STATE_ROW,
      field: "latest_delivered_generation", value: "01", physical: false },
    { name: "latest digest", base: LATEST_DELIVERED_STATE_ROW,
      field: "latest_delivered_result_digest", value: "=", physical: false },
    { name: "preceding key", base: PRECEDING_RECORDED_STATE_ROW,
      field: "preceding_query_key", value: "=", physical: false },
    { name: "preceding generation", base: PRECEDING_RECORDED_STATE_ROW,
      field: "preceding_generation", value: "01", physical: false },
    { name: "preceding digest", base: PRECEDING_RECORDED_STATE_ROW,
      field: "preceding_result_digest", value: "=", physical: false },
  ] as const)("rejects noncanonical $name text", ({ base, field, value,
    physical }) => {
    const result = decodeDeploymentQuerySyncPublicationStateRowResult(
      { ...base, [field]: value },
      scope(),
      physical ? inFlightPublication() : null,
    );

    expect(Result.isFailure(result)).toBe(true);
  });

  it.each([
    { name: "singleton", field: "singleton", value: 2 },
    { name: "query key", field: "query_key", value: "=" },
    { name: "generation", field: "generation", value: "01" },
    { name: "query identity", field: "query_identity", value: "=" },
    { name: "completed sequence", field: "completed_through_sequence",
      value: "00" },
    { name: "result digest", field: "result_digest", value: "=" },
    { name: "content", field: "content", value: "=" },
  ] as const)("rejects noncanonical in-flight $name", ({ field, value }) => {
    expect(Result.isFailure(
      decodeDeploymentQuerySyncInFlightPublicationRowResult(
        { ...IN_FLIGHT_ROW, [field]: value },
        scope(),
      ),
    )).toBe(true);
  });

  it("rejects excess lifecycle and in-flight columns", () => {
    expect(Result.isFailure(
      decodeDeploymentQuerySyncPublicationStateRowResult(
        { ...EMPTY_PUBLICATION_STATE_ROW, unexpected: 1 },
        scope(),
        null,
      ),
    )).toBe(true);
    expect(Result.isFailure(
      decodeDeploymentQuerySyncInFlightPublicationRowResult(
        { ...IN_FLIGHT_ROW, unexpected: 1 },
        scope(),
      ),
    )).toBe(true);
  });
});
