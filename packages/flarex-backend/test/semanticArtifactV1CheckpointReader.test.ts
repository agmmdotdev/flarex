import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  SemanticArtifactV1AttemptStoreBudgetError,
  SemanticArtifactV1AttemptStoreCorruptionError,
  SemanticArtifactV1AttemptStoreResourceError,
  type SemanticArtifactV1Attempt,
  type SemanticArtifactV1AttemptStore,
} from "../src/semanticArtifactV1/AttemptStore";
import {
  makeSemanticArtifactV1CheckpointReader,
  projectSemanticArtifactV1CheckpointSnapshot,
  semanticArtifactV1CheckpointReadResourceCause,
  SemanticArtifactV1CheckpointReadBudgetError,
  SemanticArtifactV1CheckpointReadCorruptionError,
  SemanticArtifactV1CheckpointReadResourceError,
} from "../src/semanticArtifactV1/CheckpointReader";

const UPLOAD_ID = "118f22e2-58cc-7b2a-91d8-f3f3401a0874";
const COMMAND_ID = "318f22e2-58cc-7b2a-91d8-f3f3401a0874";
const PENDING_COMMAND_ID = "418f22e2-58cc-7b2a-91d8-f3f3401a0874";

describe("semantic artifact v1 checkpoint reader", () => {
  it("projects only owned resume and finalized correlation evidence", () => {
    const stored = attempt({
      state: "finalized",
      pendingCommand: null,
      completedRootDigest: "33".repeat(32),
      completedSelectorDigest: "44".repeat(32),
    });
    const checkpoint = projectSemanticArtifactV1CheckpointSnapshot(stored);

    expect(checkpoint).toEqual({
      uploadId: UPLOAD_ID,
      generation: 1,
      mutationFence: 3,
      state: "finalized",
      acceptedCommandId: COMMAND_ID,
      nextBlockOrdinal: 1,
      usage: budget(),
      completed: {
        rootDigest: "33".repeat(32),
        selectorDigest: "44".repeat(32),
        sourceUploadId: "018f22e2-58cc-7b2a-91d8-f3f3401a0874",
        sourceGeneration: 2,
        sourceMutationFence: 5,
        sourceRootDigest: "11".repeat(32),
        sourceSelectorDigest: "22".repeat(32),
      },
    });
    expect(checkpoint).not.toHaveProperty("projectId");
    expect(checkpoint).not.toHaveProperty("deploymentCreatedAt");
    expect(checkpoint).not.toHaveProperty("pendingCommand");
    expect(checkpoint.usage).not.toBe(stored.usage);
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.usage)).toBe(true);
    expect(Object.isFrozen(checkpoint.completed)).toBe(true);
  });

  it("reports the unsuffixed pending command without finalized evidence", () => {
    const checkpoint = projectSemanticArtifactV1CheckpointSnapshot(attempt({
      pendingCommand: Object.freeze({
        kind: "append",
        commandId: PENDING_COMMAND_ID,
        commandDigest: "55".repeat(32),
        admission: budget(),
      }),
    }));

    expect(checkpoint.acceptedCommandId).toBe(PENDING_COMMAND_ID);
    expect(checkpoint.completed).toBeNull();
  });

  it("forwards the exact observation budget and preserves missing", async () => {
    const observedBudgets: unknown[] = [];
    const attempts: Pick<SemanticArtifactV1AttemptStore, "read"> = {
      read: (_uploadId, budgetInput) => {
        observedBudgets.push(budgetInput);
        return Effect.succeed(null);
      },
    };
    const reader = makeSemanticArtifactV1CheckpointReader(attempts);
    const readBudget = Object.freeze({
      maximumCalls: 2,
      maximumStoredBytes: 10_000,
    });

    await expect(
      Effect.runPromise(reader.read(UPLOAD_ID, readBudget)),
    ).resolves.toBeNull();
    expect(observedBudgets).toEqual([readBudget]);
    expect(Object.isFrozen(reader)).toBe(true);
  });

  it("projects store budget, corruption, and resource failures", async () => {
    const budgetFailure = await readFailure(
      new SemanticArtifactV1AttemptStoreBudgetError({
        operation: "read",
        semanticUploadId: UPLOAD_ID,
        observed: 2,
        maximum: 1,
      }),
    );
    expect(budgetFailure).toEqual(
      new SemanticArtifactV1CheckpointReadBudgetError({
        uploadId: UPLOAD_ID,
        observed: 2,
        maximum: 1,
      }),
    );

    const corruptionFailure = await readFailure(
      new SemanticArtifactV1AttemptStoreCorruptionError({
        semanticUploadId: UPLOAD_ID,
        detail: "invalid stored row",
      }),
    );
    expect(corruptionFailure).toEqual(
      new SemanticArtifactV1CheckpointReadCorruptionError({
        uploadId: UPLOAD_ID,
      }),
    );

    const storeResource = new SemanticArtifactV1AttemptStoreResourceError({
      operation: "read",
      semanticUploadId: UPLOAD_ID,
    });
    const resourceFailure = await readFailure(storeResource);
    expect(resourceFailure).toEqual(
      new SemanticArtifactV1CheckpointReadResourceError({
        uploadId: UPLOAD_ID,
      }),
    );
    if (
      resourceFailure instanceof SemanticArtifactV1CheckpointReadResourceError
    ) {
      expect(
        semanticArtifactV1CheckpointReadResourceCause(resourceFailure),
      ).toBeUndefined();
    }
  });
});

async function readFailure(
  failure:
    | SemanticArtifactV1AttemptStoreBudgetError
    | SemanticArtifactV1AttemptStoreCorruptionError
    | SemanticArtifactV1AttemptStoreResourceError,
) {
  const attempts: Pick<SemanticArtifactV1AttemptStore, "read"> = {
    read: () => Effect.fail(failure),
  };
  return await Effect.runPromise(
    makeSemanticArtifactV1CheckpointReader(attempts).read(UPLOAD_ID, {
      maximumCalls: 2,
      maximumStoredBytes: 10_000,
    }).pipe(Effect.flip),
  );
}

function attempt(
  patch: Partial<SemanticArtifactV1Attempt> = {},
): SemanticArtifactV1Attempt {
  return Object.freeze({
    semanticUploadId: UPLOAD_ID,
    generation: 1,
    mutationFence: 3,
    state: "open",
    attemptFrameBytes: Uint8Array.of(1),
    attemptCanonicalByteLength: 1,
    attemptSha256: "66".repeat(32),
    projectId: "project-a",
    deploymentId: "deployment-a",
    deploymentCreatedAt: "2026-07-27T00:00:00.000Z",
    sourceUploadId: "018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    sourceGeneration: 2,
    sourceMutationFence: 5,
    sourceRootSha256: "11".repeat(32),
    sourceSelectorSha256: "22".repeat(32),
    nextBlockOrdinal: 1,
    streamByteLength: 4,
    lineFeedCount: 1,
    lastBlockDigest: "77".repeat(32),
    lastBlockFrameByteLength: 4,
    frontier: Object.freeze([]),
    ceilings: budget(),
    usage: budget(),
    pendingCommand: null,
    lastCommandId: COMMAND_ID,
    lastCommandDigest: "88".repeat(32),
    lastReceipt: Object.freeze({ operation: "append" }),
    completedRootDigest: null,
    completedSelectorDigest: null,
    ...patch,
  });
}

function budget() {
  return Object.freeze({
    calls: 4,
    blockBytes: 4,
    canonicalBytes: 8,
    frameBytes: 16,
    hashBytes: 16,
    timeMilliseconds: 1,
  });
}
