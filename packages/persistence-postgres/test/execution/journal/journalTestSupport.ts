import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  decodeAppDocumentIdV1,
  decodeAppRowIdHexV1,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import type {
  CatalogSchemaVersionId,
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import type { LocatedAppIndexDefinitionV1 } from "../../../src/storage/indexes/appIndexDefinitions";
import type { SharedDatabaseScopePhysicalLocator } from "../../../src/scope/scopeMetadataTypes";
import type {
  TransactionExecutionClaimObservationV1,
} from "../../../src/execution/claims/transactionExecutionClaimModel";
import type {
  PinnedDeveloperIndexV1,
  PinnedPointTableV1,
  RunSessionJournalPointOperationV1Result,
  SessionJournalAttempt,
  SessionJournalStorePersistence,
} from "../../../src/execution/journal/api";
import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptSelectorV1,
} from "../../../src/execution/transactionSessionActivation";

export const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "session-journal-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

export const SEEDED_ROW_ID = decodeAppRowIdHexV1(
  "83000000000000000000000000000001",
);

export const SEEDED_CREATION_TIME = decodeAppCreationTimeV1(1_725_000_000_000.25);

export const SECOND_ROW_ID = decodeAppRowIdHexV1(
  "83000000000040008000000000000002",
);

export interface JournalScenario {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly otherTableId: CatalogTableId;
  readonly anchor: PointMutationSessionAnchorV1;
  readonly executionClaim: TransactionExecutionClaimObservationV1;
  readonly store: SessionJournalStorePersistence;
  readonly attempt: SessionJournalAttempt;
  readonly table: PinnedPointTableV1;
  readonly developerIndex: PinnedDeveloperIndexV1 | null;
  readonly developerIndexDefinition: LocatedAppIndexDefinitionV1 | null;
  readonly seededDocumentId: AppDocumentIdV1 | null;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
}

export function selectorFromAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

export function syscallSequence(value: bigint) {
  return CommitSyscallSequenceV1Schema.make(value);
}

export function documentId(tableId: CatalogTableId, suffix: number): AppDocumentIdV1 {
  return decodeAppDocumentIdV1(
    `${tableId}:88000000-0000-4000-8000-${suffix
      .toString()
      .padStart(12, "0")}`,
  );
}

export function requireSeededDocumentId(scenario: JournalScenario): AppDocumentIdV1 {
  if (scenario.seededDocumentId === null) {
    throw new Error("Scenario has no seeded document.");
  }
  return scenario.seededDocumentId;
}

export function requireInsertedDocumentId(
  result: RunSessionJournalPointOperationV1Result,
): AppDocumentIdV1 {
  if (result.kind !== "completed" || result.outcome.kind !== "inserted") {
    throw new Error("Expected inserted journal outcome.");
  }
  return result.outcome.documentId;
}

export function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error("UUID sequence exhausted.");
    return value;
  };
}

export function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolveSignal: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => {
      if (resolveSignal === undefined) {
        throw new Error("Deferred signal was not initialized.");
      }
      resolveSignal();
    },
  });
}

export async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
