import { Effect, Result } from "effect";
import { expect } from "vitest";
import { appDocumentIdV1FromRowIdentity } from "flarex-protocol/app-document-id";
import { sameLocatedAppIndexDefinition, type LocatedAppIndexDefinitionV1 } from "../../../src/storage/indexes/locatedAppIndexDefinition";
import { captureLogicalRelationalCanonicalRow, hasRetainedLogicalCanonicalIndexKey,
  LogicalRelationalMechanicsError, lowerLogicalCanonicalIndexKey,
  type LogicalCanonicalKeyOwner } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { reserveLogicalDocumentRootBytes, type LogicalDocumentRootEvaluator,
  type LogicalDocumentRootPointFailure, type LogicalDocumentRootState } from "../../../src/storage/documents/logicalDocuments/rootEvaluator";
import type { LiveAppRowRevisionV1 } from "../../../src/storage/documents/appRows";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";

type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;
type Failure = LogicalDocumentRootPointFailure | LogicalRelationalMechanicsError;

/** Canonical interpretation/retention owner proof, not a live native borrower
 * or a snapshot-serving claim. The original is borrowed from the real frozen
 * publisher input, preserving the stored decoder's provenance. */
export const pendingCanonicalIndexCacheScenario = Effect.fn("PendingIndex.canonicalCacheScenario")(
  function* (native: Fixture, input: Readonly<{
    root: LogicalDocumentRootEvaluator;
    state: LogicalDocumentRootState;
    definition: LocatedAppIndexDefinitionV1;
    reissued: LocatedAppIndexDefinitionV1;
    original: LiveAppRowRevisionV1;
  }>) {
    const { root, state, definition, reissued, original } = input;
    expect(sameLocatedAppIndexDefinition(definition, reissued)).toBe(true);
    expect(sameLocatedAppIndexDefinition(definition, { ...definition })).toBe(false);
    expect(Object.isFrozen(definition.access)).toBe(true);
    expect(Object.isFrozen(definition.physicalSpec)).toBe(true);
    expect(Object.isFrozen(definition.physicalSpec.orderedFields)).toBe(true);
    expect(definition.physicalSpec.orderedFields.every(field => Object.isFrozen(field))).toBe(true);
    expect(Object.isFrozen(definition.physicalSpec.tieBreaker)).toBe(true);

    let retentionCalls = 0;
    let retentionBytes = 0;
    const owner: LogicalCanonicalKeyOwner<Failure> = {
      identity: state.derivedKeyDocuments,
      error: (reason, cause) => new LogicalRelationalMechanicsError({ reason,
        ...(cause === undefined ? {} : { cause }) }),
      retain: (document, bytes) => reserveLogicalDocumentRootBytes(root, state.pins, bytes).pipe(Result.map(() => {
        retentionCalls++;
        retentionBytes += bytes;
        state.derivedKeyDocuments.add(document);
      })),
    };
    // This existing capture owner grants reuse only after recognizing genuine
    // stored canonical evidence and validating its bytes; no verdict is forged.
    expect(Result.getOrThrow(captureLogicalRelationalCanonicalRow(original.document, 1_048_576, owner.error)).value)
      .toMatchObject({ _id: appDocumentIdV1FromRowIdentity(original), name: "Alpha" });
    const before = state.workingBytes;
    const key = Result.getOrThrow(lowerLogicalCanonicalIndexKey(definition, original.document,
      original.creationTime, owner, "storedCorruption"));
    expect(key).not.toBeNull();
    expect(retentionCalls).toBe(1);
    expect(retentionBytes).toBeGreaterThan(0);
    expect(state.workingBytes - before).toBe(retentionBytes);
    expect(hasRetainedLogicalCanonicalIndexKey(definition, original.document, original.creationTime, owner.identity, key)).toBe(true);
    expect(hasRetainedLogicalCanonicalIndexKey(reissued, original.document, original.creationTime, owner.identity, key)).toBe(true);

    let interpretations = 0;
    const afterFirst = state.workingBytes;
    const retainedBytes = retentionBytes;
    expect(Result.getOrThrow(lowerLogicalCanonicalIndexKey(reissued, original.document,
      original.creationTime, owner, "storedCorruption", fallback => { interpretations++; return fallback(); }))).toBe(key);
    expect(interpretations).toBe(0);
    expect(retentionCalls).toBe(1);
    expect(retentionBytes).toBe(retainedBytes);
    expect(state.workingBytes).toBe(afterFirst);
    expect(hasRetainedLogicalCanonicalIndexKey({ ...definition }, original.document,
      original.creationTime, owner.identity, key)).toBe(false);

    const intrinsic = yield* native.intrinsicCreationTimeIndexes.locate({ deploymentId: native.deploymentId,
      scopeId: state.pins.scopeId, tableId: original.tableId });
    if (intrinsic === null) throw new Error("Missing genuine distinct physical index control");
    expect(intrinsic.indexDefinitionId).not.toBe(definition.indexDefinitionId);
    expect(sameLocatedAppIndexDefinition(definition, intrinsic)).toBe(false);
    expect(hasRetainedLogicalCanonicalIndexKey(intrinsic, original.document,
      original.creationTime, owner.identity, key)).toBe(false);
    expect(retentionCalls).toBe(1);
    expect(state.workingBytes).toBe(afterFirst);
  },
);
