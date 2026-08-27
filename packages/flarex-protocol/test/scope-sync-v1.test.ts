import { describe, expect, it } from "vitest";
import { Result, Schema } from "effect";

import {
  AppRowIdHexV1Schema,
  decodeAppDocumentIdV1,
} from "../src/app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogTableIdSchema,
} from "../src/catalog";
import {
  CommitSeqSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
} from "../src/storage-authority";
import {
  SCOPE_SYNC_CURSOR_FORMAT_V1,
  SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  SCOPE_SYNC_WAKE_FORMAT_V1,
  ScopeSyncCursorV1Schema,
  ScopeSyncDependencyKeyV1Schema,
  ScopeSyncWakeV1Schema,
  captureScopeSyncCursorV1,
  captureScopeSyncWakeV1,
  decodeScopeSyncCursorV1Result,
  decodeScopeSyncDependencyKeyV1Result,
  decodeScopeSyncWakeV1Result,
} from "../src/scope-sync-v1";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000001",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000002",
);
const tableId = CatalogTableIdSchema.make(3);
const edgeDefinitionId = CatalogEdgeDefinitionIdSchema.make(7);
const documentId = decodeAppDocumentIdV1(
  "3:00000000-0000-4000-8000-000000000003",
);
const targetRowId = AppRowIdHexV1Schema.make(
  "00000000000040008000000000000004",
);

describe("scope sync v1 protocol", () => {
  it("strictly decodes and owns a persisted cursor", () => {
    const decoded = Result.getOrThrow(decodeScopeSyncCursorV1Result({
      format: SCOPE_SYNC_CURSOR_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      appliedThroughCommitSeq: "12",
    }));

    expect(decoded).toEqual({
      format: SCOPE_SYNC_CURSOR_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      appliedThroughCommitSeq: 12n,
    });
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("strictly decodes and owns a wake hint", () => {
    const decoded = Result.getOrThrow(decodeScopeSyncWakeV1Result({
      format: SCOPE_SYNC_WAKE_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      observedCommitSeq: "13",
    }));

    expect(decoded).toEqual({
      format: SCOPE_SYNC_WAKE_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      observedCommitSeq: 13n,
    });
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("strictly decodes, owns, and round-trips every dependency key", () => {
    const inputs: ReadonlyArray<unknown> = [
      {
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appRowPoint",
        documentId,
      },
      {
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appTable",
        tableId,
      },
      {
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appRelationIncoming",
        edgeDefinitionId,
        targetRowId,
      },
    ];

    const decoded = inputs.map(input =>
      Result.getOrThrow(decodeScopeSyncDependencyKeyV1Result(input))
    );
    const encode = Schema.encodeSync(ScopeSyncDependencyKeyV1Schema);

    expect(decoded).toEqual(inputs);
    expect(decoded.every(Object.isFrozen)).toBe(true);
    expect(decoded.map(value => encode(value))).toEqual(inputs);
  });

  it.each([
    "9007199254740993",
    MAX_PERSISTED_SIGNED_INT64_V1.toString(),
  ])("round-trips precision-safe sequence %s for cursor and wake", (
    sequenceText,
  ) => {
    const sequence = CommitSeqSchema.make(BigInt(sequenceText));
    const cursor = captureScopeSyncCursorV1({
      format: SCOPE_SYNC_CURSOR_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      appliedThroughCommitSeq: sequence,
    });
    const wake = captureScopeSyncWakeV1({
      format: SCOPE_SYNC_WAKE_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      observedCommitSeq: sequence,
    });

    const encodedCursor = Schema.encodeSync(ScopeSyncCursorV1Schema)(cursor);
    const encodedWake = Schema.encodeSync(ScopeSyncWakeV1Schema)(wake);

    expect(encodedCursor.appliedThroughCommitSeq).toBe(sequenceText);
    expect(encodedWake.observedCommitSeq).toBe(sequenceText);
    expect(Result.getOrThrow(decodeScopeSyncCursorV1Result(encodedCursor)))
      .toEqual(cursor);
    expect(Result.getOrThrow(decodeScopeSyncWakeV1Result(encodedWake)))
      .toEqual(wake);
  });

  it.each([
    ["cursor unknown field", () => Result.isFailure(decodeScopeSyncCursorV1Result({
      format: SCOPE_SYNC_CURSOR_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      appliedThroughCommitSeq: "12",
      unexpected: true,
    }))],
    ["cursor negative sequence", () => Result.isFailure(decodeScopeSyncCursorV1Result({
      format: SCOPE_SYNC_CURSOR_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      appliedThroughCommitSeq: "-1",
    }))],
    ["cursor wrong version", () => Result.isFailure(decodeScopeSyncCursorV1Result({
      format: SCOPE_SYNC_CURSOR_FORMAT_V1,
      version: 2,
      scopeUuid,
      epochUuid,
      appliedThroughCommitSeq: "12",
    }))],
    ["wake unknown field", () => Result.isFailure(decodeScopeSyncWakeV1Result({
      format: SCOPE_SYNC_WAKE_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      observedCommitSeq: "13",
      unexpected: true,
    }))],
    ["wake malformed scope", () => Result.isFailure(decodeScopeSyncWakeV1Result({
      format: SCOPE_SYNC_WAKE_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid: "not-a-uuid",
      epochUuid,
      observedCommitSeq: "13",
    }))],
    ["dependency unknown field", () => Result.isFailure(
      decodeScopeSyncDependencyKeyV1Result({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appTable",
        tableId,
        unexpected: true,
      }),
    )],
    ["dependency wrong version", () => Result.isFailure(
      decodeScopeSyncDependencyKeyV1Result({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: 2,
        kind: "appRowPoint",
        documentId,
      }),
    )],
    ["dependency malformed relation row", () => Result.isFailure(
      decodeScopeSyncDependencyKeyV1Result({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appRelationIncoming",
        edgeDefinitionId,
        targetRowId: "not-a-row-id",
      }),
    )],
  ])("rejects %s", (_name, isFailure) => {
    expect(isFailure()).toBe(true);
  });
});
