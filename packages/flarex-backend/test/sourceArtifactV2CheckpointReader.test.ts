import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { DeploymentSqlStorage } from "../src/deployment/Store";
import type {
  SourceArtifactV2Attempt,
} from "../src/sourceArtifactV2/AttemptStore";
import {
  makeSourceArtifactV2CheckpointReader,
  projectSourceArtifactV2CheckpointSnapshot,
  SourceArtifactV2CheckpointReadBudgetError,
  SourceArtifactV2CheckpointReadCorruptionError,
} from "../src/sourceArtifactV2/CheckpointReader";

const UPLOAD_ID = "018f22e2-58cc-7b2a-91d8-f3f3401a0874";
const COMMAND_ID = "018f22e2-58cc-7b2a-91d8-f3f3401a0875";

describe("source artifact v2 checkpoint reader", () => {
  it("returns a missing observation after only the metadata call", async () => {
    const fixture = metadataSql(undefined);
    const reader = makeSourceArtifactV2CheckpointReader(fixture.sql);

    await expect(Effect.runPromise(reader.read(UPLOAD_ID, {
      maximumCalls: 1,
      maximumStoredBytes: 0,
    }))).resolves.toBeNull();
    expect(fixture.callCount()).toBe(1);
  });

  it("rejects call and stored-byte exhaustion before reading the full row", async () => {
    const callFixture = metadataSql(101);
    const callReader = makeSourceArtifactV2CheckpointReader(callFixture.sql);

    const callFailure = await Effect.runPromise(callReader.read(UPLOAD_ID, {
      maximumCalls: 1,
      maximumStoredBytes: 101,
    }).pipe(Effect.flip));
    expect(callFailure).toEqual(new SourceArtifactV2CheckpointReadBudgetError({
      uploadId: UPLOAD_ID,
      dimension: "calls",
      observed: 2,
      maximum: 1,
    }));

    const byteFixture = metadataSql(101);
    const byteReader = makeSourceArtifactV2CheckpointReader(byteFixture.sql);
    const byteFailure = await Effect.runPromise(byteReader.read(UPLOAD_ID, {
      maximumCalls: 2,
      maximumStoredBytes: 100,
    }).pipe(Effect.flip));
    expect(byteFailure).toEqual(new SourceArtifactV2CheckpointReadBudgetError({
      uploadId: UPLOAD_ID,
      dimension: "storedBytes",
      observed: 101,
      maximum: 100,
    }));
    expect(callFixture.callCount()).toBe(1);
    expect(byteFixture.callCount()).toBe(1);
  });

  it("projects only resume state and reports the unsuffixed pending command", async () => {
    const stored = attempt({
      pendingCommand: Object.freeze({
        kind: "appendBlock",
        commandId: COMMAND_ID,
        commandDigest: null,
        admission: budget(),
      }),
      lastCommandId: `${COMMAND_ID}:reserved`,
    });
    const checkpoint = projectSourceArtifactV2CheckpointSnapshot(stored);

    expect(checkpoint).toEqual({
      uploadId: UPLOAD_ID,
      generation: 1,
      mutationFence: 2,
      state: "open",
      acceptedCommandId: COMMAND_ID,
      nextModuleOrdinal: 0,
      currentModule: {
        path: "orders.ts",
        nextSourceBlockIndex: 1,
        nextSourceMapBlockIndex: 0,
        sourceMapStarted: false,
      },
      usage: budget(),
      completedRootDigest: null,
      completedSelectorDigest: null,
    });
    expect(checkpoint).not.toHaveProperty("pendingCommand");
    expect(checkpoint).not.toHaveProperty("moduleFrontier");
    expect(checkpoint.usage).not.toBe(stored.usage);
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.currentModule)).toBe(true);
    expect(Object.isFrozen(checkpoint.usage)).toBe(true);
  });

  it("treats a row disappearing after metadata admission as corruption", async () => {
    const fixture = metadataSql(1);
    const reader = makeSourceArtifactV2CheckpointReader(fixture.sql);

    await expect(Effect.runPromise(reader.read(UPLOAD_ID, {
      maximumCalls: 2,
      maximumStoredBytes: 1,
    }).pipe(Effect.flip))).resolves.toEqual(
      new SourceArtifactV2CheckpointReadCorruptionError({
        uploadId: UPLOAD_ID,
      }),
    );
    expect(fixture.callCount()).toBe(2);
  });

  it("classifies malformed decoded rows as corruption rather than SQL resource failure", async () => {
    const fixture = metadataSql(1, { upload_id: UPLOAD_ID });
    const reader = makeSourceArtifactV2CheckpointReader(fixture.sql);

    await expect(Effect.runPromise(reader.read(UPLOAD_ID, {
      maximumCalls: 2,
      maximumStoredBytes: 1,
    }).pipe(Effect.flip))).resolves.toEqual(
      new SourceArtifactV2CheckpointReadCorruptionError({
        uploadId: UPLOAD_ID,
      }),
    );
  });
});

function metadataSql(
  storedByteLength: number | undefined,
  rowAfterMetadata?: Record<string, SqlStorageValue>,
): {
  readonly sql: Pick<DeploymentSqlStorage, "exec">;
  readonly callCount: () => number;
} {
  let callCount = 0;
  const exec: DeploymentSqlStorage["exec"] = <
    T extends Record<string, SqlStorageValue>,
  >() => ({
    toArray: () => {
      callCount += 1;
      if (callCount === 1 && storedByteLength !== undefined) {
        return [{ stored_byte_length: storedByteLength } as unknown as T];
      }
      return callCount === 2 && rowAfterMetadata !== undefined
        ? [rowAfterMetadata as unknown as T]
        : [];
    },
  }) as SqlStorageCursor<T>;
  return {
    sql: { exec },
    callCount: () => callCount,
  };
}

function attempt(
  patch: Partial<SourceArtifactV2Attempt> = {},
): SourceArtifactV2Attempt {
  return Object.freeze({
    uploadId: UPLOAD_ID,
    generation: 1,
    mutationFence: 2,
    state: "open",
    nextModuleOrdinal: 0,
    lastModulePath: null,
    currentModule: Object.freeze({
      path: "orders.ts",
      roles: 1,
      source: Object.freeze({
        blockCount: 1,
        byteLength: 4,
        frontier: Object.freeze([]),
      }),
      sourceMap: Object.freeze({
        blockCount: 0,
        byteLength: 0,
        frontier: Object.freeze([]),
      }),
      sourceMapStarted: false,
    }),
    moduleFrontier: Object.freeze([]),
    counters: Object.freeze({
      moduleCount: 0,
      functionModuleCount: 0,
      sourceByteLength: 0,
      sourceMapByteLength: 0,
      executionPath: null,
      schemaPath: null,
      authPath: null,
    }),
    ceilings: budget(),
    usage: budget(),
    pendingCommand: null,
    lastCommandId: COMMAND_ID,
    lastCommandDigest: "11".repeat(32),
    lastReceipt: Object.freeze({ kind: "appendBlock" }),
    completedRootDigest: null,
    completedSelectorDigest: null,
    ...patch,
  });
}

function budget() {
  return Object.freeze({
    calls: 1,
    blockBytes: 4,
    modules: 1,
    sourceMaps: 0,
    canonicalBytes: 10,
    frameBytes: 20,
    hashBytes: 20,
    timeMilliseconds: 1,
  });
}
