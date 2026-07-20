import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Brand, Data, Result } from "effect";

import {
  isNonNegativeTransactionGrantDurationMillisecondsV1,
  isPositiveTransactionGrantDurationMillisecondsV1,
} from "./transaction-grant";

export interface GrantRetentionPolicyV1Input {
  readonly maximumGrantLifetimeMilliseconds: number;
  readonly maximumFutureIssuedAtSkewMilliseconds: number;
  readonly maximumLiveSnapshotRetentionMilliseconds: number;
}

/**
 * Deployment configuration shared by grant issuance, grant verification, and
 * the later live-snapshot retention owner. It is neither wire evidence nor an
 * execution capability; separately constructed value-equal policies are
 * equivalent.
 */
export type GrantRetentionPolicyV1 = Brand.Branded<
  GrantRetentionPolicyV1Input,
  "FlarexDB/GrantRetentionPolicyV1"
>;

const brandGrantRetentionPolicyV1 =
  Brand.nominal<GrantRetentionPolicyV1>();

export type GrantRetentionPolicyConfigurationV1Issue =
  | "invalidMaximumGrantLifetime"
  | "invalidMaximumFutureIssuedAtSkew"
  | "invalidMaximumLiveSnapshotRetention"
  | "maximumGrantAcceptanceWindowOutOfRange"
  | "insufficientLiveSnapshotRetention";

export class GrantRetentionPolicyConfigurationV1Error extends Data.TaggedError(
  "GrantRetentionPolicyConfigurationV1Error",
)<{
  readonly issue: GrantRetentionPolicyConfigurationV1Issue;
}> {}

export function makeGrantRetentionPolicyV1Result(
  input: GrantRetentionPolicyV1Input,
): Result.Result<
  GrantRetentionPolicyV1,
  GrantRetentionPolicyConfigurationV1Error
> {
  const maximumGrantLifetimeMilliseconds =
    input.maximumGrantLifetimeMilliseconds;
  if (!isPositiveTransactionGrantDurationMillisecondsV1(
    maximumGrantLifetimeMilliseconds,
  )) {
    return Result.fail(new GrantRetentionPolicyConfigurationV1Error({
      issue: "invalidMaximumGrantLifetime",
    }));
  }

  const maximumFutureIssuedAtSkewMilliseconds =
    input.maximumFutureIssuedAtSkewMilliseconds;
  if (!isNonNegativeTransactionGrantDurationMillisecondsV1(
    maximumFutureIssuedAtSkewMilliseconds,
  )) {
    return Result.fail(new GrantRetentionPolicyConfigurationV1Error({
      issue: "invalidMaximumFutureIssuedAtSkew",
    }));
  }

  const maximumLiveSnapshotRetentionMilliseconds =
    input.maximumLiveSnapshotRetentionMilliseconds;
  if (!isPositiveSafeInteger(maximumLiveSnapshotRetentionMilliseconds)) {
    return Result.fail(new GrantRetentionPolicyConfigurationV1Error({
      issue: "invalidMaximumLiveSnapshotRetention",
    }));
  }

  if (
    maximumGrantLifetimeMilliseconds >
      Number.MAX_SAFE_INTEGER - maximumFutureIssuedAtSkewMilliseconds
  ) {
    return Result.fail(new GrantRetentionPolicyConfigurationV1Error({
      issue: "maximumGrantAcceptanceWindowOutOfRange",
    }));
  }
  const maximumGrantLifetimeWithFutureSkewMilliseconds =
    maximumGrantLifetimeMilliseconds +
    maximumFutureIssuedAtSkewMilliseconds;
  if (!isPositiveTransactionGrantDurationMillisecondsV1(
    maximumGrantLifetimeWithFutureSkewMilliseconds,
  )) {
    return Result.fail(new GrantRetentionPolicyConfigurationV1Error({
      issue: "maximumGrantAcceptanceWindowOutOfRange",
    }));
  }
  if (
    maximumGrantLifetimeWithFutureSkewMilliseconds >
      maximumLiveSnapshotRetentionMilliseconds
  ) {
    return Result.fail(new GrantRetentionPolicyConfigurationV1Error({
      issue: "insufficientLiveSnapshotRetention",
    }));
  }

  return Result.succeed(brandGrantRetentionPolicyV1(Object.freeze({
    maximumGrantLifetimeMilliseconds,
    maximumFutureIssuedAtSkewMilliseconds,
    maximumLiveSnapshotRetentionMilliseconds,
  })));
}
