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
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
    return yield* decodePartitionSchemaCachePayloadEffect(value).pipe(
      Effect.map(request => request as PartitionSchemaCacheRequest),
    );
  },
);

export const decodePublicPartitionSchemaCachePayload = Effect.fn(
  "PartitionRequests.decodePublicSchemaCachePayload",
)(
  function* (
    value: unknown,
    partitionKey: string,
  ): Effect.fn.Return<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
    return yield* decodePublicPartitionSchemaCachePayloadEffect(value, partitionKey).pipe(
      Effect.map(request => request as PartitionSchemaCacheRequest),
    );
  },
);

export const decodePartitionCommitPayload = Effect.fn(
  "PartitionRequests.decodeCommitPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionCommitRequest, PartitionRoutePayloadError> {
    return yield* decodePartitionCommitPayloadEffect(value).pipe(
      Effect.map(request => request as ProtocolPartitionCommitRequest as PartitionCommitRequest),
    );
  },
);

export const decodePartitionSubscriptionRegistrationPayload = Effect.fn(
  "PartitionRequests.decodeSubscriptionRegistrationPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionSubscriptionRegistrationRequest, PartitionRoutePayloadError> {
    return yield* decodePartitionSubscriptionRegistrationPayloadEffect(value).pipe(
      Effect.map(request => request as PartitionSubscriptionRegistrationRequest),
    );
  },
);

export const decodePartitionSubscriptionTargetPayload = Effect.fn(
  "PartitionRequests.decodeSubscriptionTargetPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionSubscriptionTargetRequest, PartitionRoutePayloadError> {
    return yield* decodePartitionSubscriptionTargetPayloadEffect(value);
  },
);

export const decodePartitionConnectionUnregisterPayload = Effect.fn(
  "PartitionRequests.decodeConnectionUnregisterPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionConnectionUnregisterRequest, PartitionRoutePayloadError> {
    return yield* decodePartitionConnectionUnregisterPayloadEffect(value);
  },
);
