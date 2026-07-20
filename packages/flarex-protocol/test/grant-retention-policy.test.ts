import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as protocolRoot from "../src/index";
import {
  GrantRetentionPolicyConfigurationV1Error,
  makeGrantRetentionPolicyV1Result,
  type GrantRetentionPolicyV1,
  type GrantRetentionPolicyV1Input,
} from "../src/grant-retention-policy";
import {
  MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1,
} from "../src/transaction-grant";

describe("GrantRetentionPolicyV1", () => {
  it("constructs a fresh frozen value-only policy at exact boundaries", () => {
    const input = {
      maximumGrantLifetimeMilliseconds: 1,
      maximumFutureIssuedAtSkewMilliseconds: 0,
      maximumLiveSnapshotRetentionMilliseconds: 1,
    } satisfies GrantRetentionPolicyV1Input;
    const first = Result.getOrThrow(makeGrantRetentionPolicyV1Result(input));
    const second = Result.getOrThrow(makeGrantRetentionPolicyV1Result(input));

    expect(first).toEqual(input);
    expect(Reflect.ownKeys(first)).toEqual([
      "maximumGrantLifetimeMilliseconds",
      "maximumFutureIssuedAtSkewMilliseconds",
      "maximumLiveSnapshotRetentionMilliseconds",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expectTypeOf<GrantRetentionPolicyV1Input>()
      .not.toMatchTypeOf<GrantRetentionPolicyV1>();
  });

  it("rejects invalid grant, skew, and retention fields precisely", () => {
    const invalidGrantValues = [
      0,
      -1,
      1.5,
      MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1 + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    for (const maximumGrantLifetimeMilliseconds of invalidGrantValues) {
      expectFailureIssue({
        maximumGrantLifetimeMilliseconds,
        maximumFutureIssuedAtSkewMilliseconds: 0,
        maximumLiveSnapshotRetentionMilliseconds: 1,
      }, "invalidMaximumGrantLifetime");
    }

    const invalidSkewValues = [
      -1,
      1.5,
      MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1 + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    for (const maximumFutureIssuedAtSkewMilliseconds of invalidSkewValues) {
      expectFailureIssue({
        maximumGrantLifetimeMilliseconds: 1,
        maximumFutureIssuedAtSkewMilliseconds,
        maximumLiveSnapshotRetentionMilliseconds: 1,
      }, "invalidMaximumFutureIssuedAtSkew");
    }

    const invalidRetentionValues = [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    for (
      const maximumLiveSnapshotRetentionMilliseconds of invalidRetentionValues
    ) {
      expectFailureIssue({
        maximumGrantLifetimeMilliseconds: 1,
        maximumFutureIssuedAtSkewMilliseconds: 0,
        maximumLiveSnapshotRetentionMilliseconds,
      }, "invalidMaximumLiveSnapshotRetention");
    }
  });

  it("requires a supported acceptance window covered by live retention", () => {
    expectFailureIssue({
      maximumGrantLifetimeMilliseconds:
        MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1,
      maximumFutureIssuedAtSkewMilliseconds: 1,
      maximumLiveSnapshotRetentionMilliseconds: Number.MAX_SAFE_INTEGER,
    }, "maximumGrantAcceptanceWindowOutOfRange");

    expectFailureIssue({
      maximumGrantLifetimeMilliseconds: 10,
      maximumFutureIssuedAtSkewMilliseconds: 5,
      maximumLiveSnapshotRetentionMilliseconds: 14,
    }, "insufficientLiveSnapshotRetention");

    expect(Result.isSuccess(makeGrantRetentionPolicyV1Result({
      maximumGrantLifetimeMilliseconds: 10,
      maximumFutureIssuedAtSkewMilliseconds: 5,
      maximumLiveSnapshotRetentionMilliseconds: 15,
    }))).toBe(true);
  });

  it("preserves first-failure order without reading later configuration", () => {
    let skewReads = 0;
    let retentionReads = 0;
    const result = makeGrantRetentionPolicyV1Result({
      maximumGrantLifetimeMilliseconds: 0,
      get maximumFutureIssuedAtSkewMilliseconds() {
        skewReads += 1;
        return 0;
      },
      get maximumLiveSnapshotRetentionMilliseconds() {
        retentionReads += 1;
        return 1;
      },
    });

    expect(Result.isFailure(result)).toBe(true);
    expect(skewReads).toBe(0);
    expect(retentionReads).toBe(0);
  });

  it("stays off the protocol package root", () => {
    expect(protocolRoot).not.toHaveProperty("GrantRetentionPolicyV1");
    expect(protocolRoot).not.toHaveProperty(
      "makeGrantRetentionPolicyV1Result",
    );
  });
});

function expectFailureIssue(
  input: GrantRetentionPolicyV1Input,
  issue: GrantRetentionPolicyConfigurationV1Error["issue"],
): void {
  const result = makeGrantRetentionPolicyV1Result(input);
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(
      GrantRetentionPolicyConfigurationV1Error,
    );
    expect(result.failure.issue).toBe(issue);
  }
}
