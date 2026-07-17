import {
  decodePartitionCommitPayloadEffect,
  decodePartitionConnectionUnregisterPayloadEffect,
  decodePartitionSchemaCachePayloadEffect,
  decodePartitionSubscriptionRegistrationPayloadEffect,
  decodePartitionSubscriptionTargetPayloadEffect,
  decodePublicPartitionSchemaCachePayloadEffect,
  PartitionRoutePayloadError,
  type PartitionCommitRequest as ProtocolPartitionCommitRequest,
  type PartitionConnectionUnregisterRequest,
  type PartitionSchemaCacheRequest as ProtocolPartitionSchemaCacheRequest,
  type PartitionSubscriptionRegistrationRequest as ProtocolPartitionSubscriptionRegistrationRequest,
  type PartitionSubscriptionTargetRequest,
} from "flarex-protocol/partition";
import { Effect } from "effect";
import type { CommitRequest, DeploymentSchema, ReadSet } from "../types";

export {
  PartitionRoutePayloadError,
  type PartitionConnectionUnregisterRequest,
  type PartitionSubscriptionTargetRequest,
} from "flarex-protocol/partition";

export type PartitionSchemaCacheRequest = ProtocolPartitionSchemaCacheRequest & {
  schema?: Partial<DeploymentSchema>;
};
export type PartitionSubscriptionRegistrationRequest =
  Omit<ProtocolPartitionSubscriptionRegistrationRequest, "readSet"> & {
    readSet: ReadSet;
  };
export type PartitionCommitRequest = CommitRequest;

export const decodePartitionSchemaCachePayload = Effect.fn(
  "PartitionRequests.decodeSchemaCachePayload",
)(
  (value: unknown): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> =>
    decodePartitionSchemaCachePayloadEffect(value).pipe(
      Effect.map(request => request as PartitionSchemaCacheRequest),
    ),
);

export const decodePublicPartitionSchemaCachePayload = Effect.fn(
  "PartitionRequests.decodePublicSchemaCachePayload",
)(
  (
    value: unknown,
    partitionKey: string,
  ): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> =>
    decodePublicPartitionSchemaCachePayloadEffect(value, partitionKey).pipe(
      Effect.map(request => request as PartitionSchemaCacheRequest),
    ),
);

export const decodePartitionCommitPayload = Effect.fn(
  "PartitionRequests.decodeCommitPayload",
)(
  (value: unknown): Effect.Effect<PartitionCommitRequest, PartitionRoutePayloadError> =>
    decodePartitionCommitPayloadEffect(value).pipe(
      Effect.map(request => request as ProtocolPartitionCommitRequest as PartitionCommitRequest),
    ),
);

export const decodePartitionSubscriptionRegistrationPayload = Effect.fn(
  "PartitionRequests.decodeSubscriptionRegistrationPayload",
)(
  (
    value: unknown,
  ): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRoutePayloadError> =>
    decodePartitionSubscriptionRegistrationPayloadEffect(value).pipe(
      Effect.map(request => request as PartitionSubscriptionRegistrationRequest),
    ),
);

export const decodePartitionSubscriptionTargetPayload = Effect.fn(
  "PartitionRequests.decodeSubscriptionTargetPayload",
)(
  (value: unknown): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRoutePayloadError> =>
    decodePartitionSubscriptionTargetPayloadEffect(value),
);

export const decodePartitionConnectionUnregisterPayload = Effect.fn(
  "PartitionRequests.decodeConnectionUnregisterPayload",
)(
  (
    value: unknown,
  ): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRoutePayloadError> =>
    decodePartitionConnectionUnregisterPayloadEffect(value),
);
