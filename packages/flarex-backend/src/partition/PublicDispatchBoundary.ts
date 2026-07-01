import { Effect } from "effect";
import type {
  PartitionCommitRequest,
  PartitionDocumentReadRequest,
  PartitionIndexReadRequest,
  PartitionSchemaCacheRequest,
} from "./RouteBoundary";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export interface PublicPartitionDispatchTarget {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export const beginPublicPartitionEffect = Effect.fn(
  "Worker.beginPublicPartition",
)(function* (
  partition: PublicPartitionDispatchTarget,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => partition.fetch("https://flarex.internal/begin", { method: "POST" }),
    catch: error => publicWorkerDispatchError("partition-begin", error),
  });
});

export const commitPublicPartitionEffect = Effect.fn(
  "Worker.commitPublicPartition",
)(function* (
  partition: PublicPartitionDispatchTarget,
  commit: PartitionCommitRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => partition.fetch("https://flarex.internal/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(commit),
    }),
    catch: error => publicWorkerDispatchError("partition-commit", error),
  });
});

export const cachePublicPartitionSchemaEffect = Effect.fn(
  "Worker.cachePublicPartitionSchema",
)(function* (
  partition: PublicPartitionDispatchTarget,
  schemaCache: PartitionSchemaCacheRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => partition.fetch("https://flarex.internal/schema-cache", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(schemaCache),
    }),
    catch: error => publicWorkerDispatchError("partition-schema-cache", error),
  });
});

export const readPublicPartitionDocumentEffect = Effect.fn(
  "Worker.readPublicPartitionDocument",
)(function* (
  partition: PublicPartitionDispatchTarget,
  read: PartitionDocumentReadRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  const searchParams = partitionDocumentReadSearchParams(read);
  return yield* Effect.tryPromise({
    try: () => partition.fetch(`https://flarex.internal/document?${searchParams}`),
    catch: error => publicWorkerDispatchError("partition-document-read", error),
  });
});

export const readPublicPartitionIndexEffect = Effect.fn(
  "Worker.readPublicPartitionIndex",
)(function* (
  partition: PublicPartitionDispatchTarget,
  read: PartitionIndexReadRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  const searchParams = partitionIndexReadSearchParams(read);
  return yield* Effect.tryPromise({
    try: () => partition.fetch(`https://flarex.internal/index?${searchParams}`),
    catch: error => publicWorkerDispatchError("partition-index-read", error),
  });
});

function partitionDocumentReadSearchParams(read: PartitionDocumentReadRequest): URLSearchParams {
  return new URLSearchParams({
    tableId: String(read.tableId),
    id: read.id,
    ...(read.at === undefined ? {} : { at: String(read.at) }),
  });
}

function partitionIndexReadSearchParams(read: PartitionIndexReadRequest): URLSearchParams {
  return new URLSearchParams({
    indexId: String(read.indexId),
    ...(read.at === undefined ? {} : { at: String(read.at) }),
    ...(read.lower === undefined ? {} : { lower: read.lower }),
    ...(read.upper === undefined ? {} : { upper: read.upper }),
    ...(read.limit === undefined ? {} : { limit: String(read.limit) }),
    ...(read.cursor === undefined ? {} : { cursor: read.cursor }),
    ...(read.order === undefined ? {} : { order: read.order }),
  });
}
