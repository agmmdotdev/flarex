import { Encoding, Result } from "effect";

import {
  captureAdmittedInvalidationBatch,
  captureNamespaceCursor,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  captureQueryOperationTarget,
} from "@flarex/query-sync/internal/kernel";
import type {
  AdmittedInvalidationBatch,
  NamespaceCursor,
  QueryDescriptor,
  QueryEvaluationEvidence,
  QueryGeneration,
  QueryOperationTarget,
  QueryResultDigest,
  QueryAuthorityWitness,
  QueryState,
} from "@flarex/query-sync/internal/kernel";
import type {
  QuerySyncReferenceModel,
} from "@flarex/query-sync/testing/reference-model";

import { buildQuerySyncState } from "../src/kernel/Model.js";

export function getSuccess<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

export function buildTestReferenceModel(
  initialCursor: NamespaceCursor,
  queries: readonly QueryState[],
): QuerySyncReferenceModel {
  return Object.freeze({
    state: getSuccess(buildQuerySyncState(initialCursor, queries)),
  });
}

export function buildTestQuerySyncState(
  initialCursor: NamespaceCursor,
  queries: readonly QueryState[],
): ReturnType<typeof buildQuerySyncState> {
  return buildQuerySyncState(initialCursor, queries);
}

export function canonicalBytes(
  byteLength: number,
  seed = 0,
): string {
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = index % 256;
  }
  const seedBytes = Math.min(byteLength, 4);
  for (let index = 0; index < seedBytes; index += 1) {
    bytes[index] = (seed >>> (index * 8)) & 0xff;
  }
  return Encoding.encodeBase64Url(bytes);
}

export function canonicalText(value: string): string {
  return Encoding.encodeBase64Url(value);
}

export function canonicalKey(seed: number): string {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, seed);
  return Encoding.encodeBase64Url(bytes);
}

export function cursor(input: {
  readonly namespaceId?: string;
  readonly syncModelId?: string;
  readonly sourceEpoch?: string;
  readonly sequence?: bigint;
} = {}): NamespaceCursor {
  return getSuccess(captureNamespaceCursor({
    namespaceId: input.namespaceId ?? "tenant-a",
    syncModelId: input.syncModelId ?? "key-value",
    sourceEpoch: input.sourceEpoch ?? "epoch-a",
    appliedThroughSequence: input.sequence ?? 0n,
  }));
}

export function descriptor(input: {
  readonly keySeed?: number;
  readonly identity?: string;
} = {}): QueryDescriptor {
  return getSuccess(captureQueryDescriptor({
    queryKey: canonicalKey(input.keySeed ?? 1),
    queryIdentity: canonicalText(input.identity ?? "query-a"),
  }));
}

export function target(input: {
  readonly namespaceId?: string;
  readonly syncModelId?: string;
  readonly sourceEpoch?: string;
  readonly descriptor?: QueryDescriptor;
} = {}): QueryOperationTarget {
  const selectedDescriptor = input.descriptor ?? descriptor();
  return getSuccess(captureQueryOperationTarget({
    namespaceId: input.namespaceId ?? "tenant-a",
    syncModelId: input.syncModelId ?? "key-value",
    sourceEpoch: input.sourceEpoch ?? "epoch-a",
    descriptor: selectedDescriptor,
  }));
}

export function batch(input: {
  readonly namespaceId?: string;
  readonly syncModelId?: string;
  readonly sourceEpoch?: string;
  readonly sequence: bigint;
  readonly dependencies?: readonly string[];
}): AdmittedInvalidationBatch {
  return getSuccess(captureAdmittedInvalidationBatch({
    namespaceId: input.namespaceId ?? "tenant-a",
    syncModelId: input.syncModelId ?? "key-value",
    sourceEpoch: input.sourceEpoch ?? "epoch-a",
    sourceSequence: input.sequence,
    dependencyKeys: input.dependencies ?? [],
  }));
}

export function evaluation(input: {
  readonly namespaceId?: string;
  readonly syncModelId?: string;
  readonly sourceEpoch?: string;
  readonly descriptor?: QueryDescriptor;
  readonly generation: QueryGeneration | bigint;
  readonly snapshot: bigint;
  readonly resultSeed?: number;
  readonly witnessSeed?: number;
  readonly dependencies?: readonly string[];
}): QueryEvaluationEvidence {
  return getSuccess(captureQueryEvaluationEvidence({
    namespaceId: input.namespaceId ?? "tenant-a",
    syncModelId: input.syncModelId ?? "key-value",
    sourceEpoch: input.sourceEpoch ?? "epoch-a",
    descriptor: input.descriptor ?? descriptor(),
    generation: input.generation,
    snapshotSequence: input.snapshot,
    resultDigest: canonicalKey(input.resultSeed ?? 80),
    authorityWitness: canonicalKey(input.witnessSeed ?? 90),
    dependencyKeys: input.dependencies ?? [],
  }));
}

export function digest(seed: number): QueryResultDigest {
  return getSuccess(captureQueryEvaluationEvidence({
    namespaceId: "tenant-a",
    syncModelId: "key-value",
    sourceEpoch: "epoch-a",
    descriptor: descriptor(),
    generation: 1n,
    snapshotSequence: 0n,
    resultDigest: canonicalKey(seed),
    authorityWitness: canonicalKey(90),
    dependencyKeys: [],
  })).resultDigest;
}

export function witness(seed: number): QueryAuthorityWitness {
  return getSuccess(captureQueryEvaluationEvidence({
    namespaceId: "tenant-a",
    syncModelId: "key-value",
    sourceEpoch: "epoch-a",
    descriptor: descriptor(),
    generation: 1n,
    snapshotSequence: 0n,
    resultDigest: canonicalKey(80),
    authorityWitness: canonicalKey(seed),
    dependencyKeys: [],
  })).authorityWitness;
}
