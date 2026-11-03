import { Result } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import type { CoreNativeWorkflowSnapshot } from "./core-native-workflow-fixture";

/** Snapshot history is grouped by real Core table, rather than append order. */
export function newStoreRevisions(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot) {
  const identity = (row: CoreNativeWorkflowSnapshot["revisions"][number]) =>
    `${row.table}:${row.id}:${row.timestamp}`;
  const prior = new Set(before.revisions.map(identity));
  return after.revisions.filter(row => !prior.has(identity(row)));
}

export const storeRevisionIdentity = (row: CoreNativeWorkflowSnapshot["revisions"][number]) => `${row.table}:${row.id}`;
export const storeRowIdentity = (row: CoreNativeWorkflowSnapshot["rows"][number]) =>
  `${row.table}:${encodeBytesToLowercaseHex(Result.getOrThrow(decodeDocumentId(row.value._id)).internalId)}`;
