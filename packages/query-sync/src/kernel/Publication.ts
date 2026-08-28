import { Brand, Result } from "effect";

import {
  captureCanonicalBase64UrlValue,
  compareCanonicalBase64Url,
} from "./CanonicalValue.js";
import type {
  CanonicalQueryIdentity,
  CanonicalQueryKey,
  QueryGeneration,
  QueryResultDigest,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "./CanonicalValue.js";
import type { QuerySyncCanonicalValueError } from "./Errors.js";

export const MAX_INLINE_PUBLICATION_CONTENT_BYTES = 1_024 * 1_024;
export const MAX_PENDING_PUBLICATIONS = 4_096;
export const MAX_PENDING_PUBLICATION_CONTENT_BYTES = 32 * 1_024 * 1_024;

export type CanonicalPublicationContent = Brand.Branded<
  string,
  "FlarexQuerySync/CanonicalPublicationContent"
>;

const brandCanonicalPublicationContent =
  Brand.nominal<CanonicalPublicationContent>();

export interface QueryPublicationArtifact {
  readonly content: CanonicalPublicationContent;
}

export interface QueryPublicationArtifactInput {
  readonly content: unknown;
}

export interface QueryPublicationIdentity {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly queryKey: CanonicalQueryKey;
  readonly generation: QueryGeneration;
}

export type QueryCompletionPublicationDisposition =
  | Readonly<{
    readonly _tag: "unchanged";
  }>
  | Readonly<{
    readonly _tag: "pending";
    readonly identity: QueryPublicationIdentity;
  }>;

export interface PendingQueryPublication {
  readonly identity: QueryPublicationIdentity;
  readonly queryIdentity: CanonicalQueryIdentity;
  readonly completedThroughSequence: SyncSequence;
  readonly resultDigest: QueryResultDigest;
  readonly content: CanonicalPublicationContent;
}

const UNCHANGED_PUBLICATION_DISPOSITION = Object.freeze({
  _tag: "unchanged" as const,
});

export function canonicalPublicationContentDecodedLength(
  content: CanonicalPublicationContent,
): number {
  return Math.floor((content.length * 3) / 4);
}

export function captureQueryPublicationArtifact(
  input: QueryPublicationArtifactInput,
): Result.Result<QueryPublicationArtifact, QuerySyncCanonicalValueError> {
  return captureCanonicalBase64UrlValue(
    input.content,
    "publicationContent",
    MAX_INLINE_PUBLICATION_CONTENT_BYTES,
    null,
    brandCanonicalPublicationContent,
  ).pipe(Result.map((content) => Object.freeze({ content })));
}

export function freezeQueryPublicationIdentity(
  identity: QueryPublicationIdentity,
): QueryPublicationIdentity {
  return Object.freeze({
    namespaceId: identity.namespaceId,
    syncModelId: identity.syncModelId,
    sourceEpoch: identity.sourceEpoch,
    queryKey: identity.queryKey,
    generation: identity.generation,
  });
}

export function makeQueryPublicationIdentity(
  identity: QueryPublicationIdentity,
): QueryPublicationIdentity {
  return freezeQueryPublicationIdentity(identity);
}

export function unchangedPublicationDisposition():
  QueryCompletionPublicationDisposition {
  return UNCHANGED_PUBLICATION_DISPOSITION;
}

export function pendingPublicationDisposition(
  identity: QueryPublicationIdentity,
): QueryCompletionPublicationDisposition {
  return Object.freeze({
    _tag: "pending",
    identity: freezeQueryPublicationIdentity(identity),
  });
}

export function freezePublicationDisposition(
  disposition: QueryCompletionPublicationDisposition,
): QueryCompletionPublicationDisposition {
  return disposition._tag === "unchanged"
    ? unchangedPublicationDisposition()
    : pendingPublicationDisposition(disposition.identity);
}

export function makePendingQueryPublication(
  publication: PendingQueryPublication,
): PendingQueryPublication {
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(publication.identity),
    queryIdentity: publication.queryIdentity,
    completedThroughSequence: publication.completedThroughSequence,
    resultDigest: publication.resultDigest,
    content: publication.content,
  });
}

export function queryPublicationIdentityEquals(
  left: QueryPublicationIdentity,
  right: QueryPublicationIdentity,
): boolean {
  return left.namespaceId === right.namespaceId
    && left.syncModelId === right.syncModelId
    && left.sourceEpoch === right.sourceEpoch
    && left.queryKey === right.queryKey
    && left.generation === right.generation;
}

export function compareQueryPublicationIdentity(
  left: QueryPublicationIdentity,
  right: QueryPublicationIdentity,
): number {
  if (left.namespaceId !== right.namespaceId) {
    return left.namespaceId < right.namespaceId ? -1 : 1;
  }
  if (left.syncModelId !== right.syncModelId) {
    return left.syncModelId < right.syncModelId ? -1 : 1;
  }
  if (left.sourceEpoch !== right.sourceEpoch) {
    return left.sourceEpoch < right.sourceEpoch ? -1 : 1;
  }
  const queryKeyComparison = compareCanonicalBase64Url(
    left.queryKey,
    right.queryKey,
  );
  if (queryKeyComparison !== 0) return queryKeyComparison;
  return left.generation < right.generation
    ? -1
    : left.generation > right.generation ? 1 : 0;
}
