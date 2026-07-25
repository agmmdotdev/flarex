import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Cause, Data, Effect, Exit, Result } from "effect";
import type {
  DeploymentProjectScopeAuthorizerV1,
  DeploymentProjectScopeWitnessV1,
} from "../src/deploymentProjectScopeAuthorization";
import {
  DeploymentProjectScopeWitnessV1Error,
} from "../src/deploymentProjectScopeAuthorization";
import type {
  SourceArtifactV2Attempt,
} from "../src/sourceArtifactV2/AttemptStore";
import type {
  SourceArtifactV2FinalizedAttemptReadComposerV1,
} from "../src/sourceArtifactV2/FinalizedAttemptReadComposer";
import {
  makeSemanticArtifactV1AttemptStore,
  type SemanticArtifactV1Attempt,
  type SemanticArtifactV1AttemptStore,
} from "../src/semanticArtifactV1/AttemptStore";
import {
  makeSemanticArtifactV1FinalizedSourceProofFactory,
} from "../src/semanticArtifactV1/FinalizedSourceProof";
import {
  makeSemanticArtifactV1R2Store,
  semanticArtifactV1R2UncertainCause,
  type SemanticArtifactV1R2Bucket,
} from "../src/semanticArtifactV1/R2Store";
import { makeSemanticArtifactV1Sha256 } from "../src/semanticArtifactV1/Sha256";
import {
  makeSemanticArtifactV1UploadCore,
  type SemanticArtifactV1UploadCore,
} from "../src/semanticArtifactV1/UploadCore";
import type {
  SemanticArtifactV1SourceCorrelationReader,
} from "../src/semanticArtifactV1/SourceCorrelationReader";

const hex = (value: number) => value.toString(16).padStart(2, "0").repeat(32);
const sourceAttempt: SourceArtifactV2Attempt = {
  uploadId: "source-upload",
  generation: 1,
  mutationFence: 2,
  state: "finalized",
  nextModuleOrdinal: 0,
  lastModulePath: null,
  currentModule: null,
  moduleFrontier: [],
  counters: {
    moduleCount: 0,
    functionModuleCount: 0,
    sourceByteLength: 0,
    sourceMapByteLength: 0,
    executionPath: null,
    schemaPath: null,
    authPath: null,
  },
  ceilings: {
    calls: 100,
    blockBytes: 100,
    modules: 100,
    sourceMaps: 100,
    canonicalBytes: 100,
    frameBytes: 100,
    hashBytes: 100,
    timeMilliseconds: 100,
  },
  usage: {
    calls: 1,
    blockBytes: 0,
    modules: 0,
    sourceMaps: 0,
    canonicalBytes: 0,
    frameBytes: 0,
    hashBytes: 0,
    timeMilliseconds: 0,
  },
  pendingCommand: null,
  lastCommandId: "finalize",
  lastCommandDigest: hex(4),
  lastReceipt: {},
  completedRootDigest: hex(1),
  completedSelectorDigest: hex(2),
};

const budgets = {
  calls: 1_000,
  blockBytes: 1_000_000,
  canonicalBytes: 1_000_000,
  frameBytes: 1_000_000,
  hashBytes: 1_000_000,
  timeMilliseconds: 10_000,
};

const ceilings = {
  ...budgets,
  timeMilliseconds: 100_000,
};

class SemanticArtifactV1TestAdmissionError extends Data.TaggedError(
  "SemanticArtifactV1TestAdmissionError",
)<{ readonly reason: "budgetExceeded" }> {}

describe("Semantic Artifact V1 private inert core", () => {
  it("requires an opaque single-use finalized-source proof", async () => {
    const fixture = makeFixture();
    const request = new Request("https://private.test");
    const proof = await Effect.runPromise(fixture.proofs.issue(request, fixture.proofInput));
    const wrongRequest = fixture.proofs.claim(
      proof,
      new Request("https://private.test/other"),
      "deployment",
    );
    expect(Result.isFailure(wrongRequest) && wrongRequest.failure.reason).toBe("wrongRequest");
    const otherFactory = makeFixture().proofs;
    const crossFactory = otherFactory.claim(proof, request, "deployment");
    expect(Result.isFailure(crossFactory) && crossFactory.failure.reason).toBe("invalidProof");
    const first = fixture.proofs.claim(proof, request, "deployment");
    expect(Result.isSuccess(first)).toBe(true);
    const reused = fixture.proofs.claim(proof, request, "deployment");
    expect(Result.isFailure(reused) && reused.failure.reason).toBe("alreadyClaimed");
    const copied = fixture.proofs.claim({ ...proof }, request, "deployment");
    expect(Result.isFailure(copied) && copied.failure.reason).toBe("invalidProof");
  });

  it("settles immutable R2 creates with exact non-resetting call and byte receipts", async () => {
    const sha256 = makeSemanticArtifactV1Sha256(input =>
      webcrypto.subtle.digest("SHA-256", input)
    );
    const bytes = new TextEncoder().encode("semantic\n");
    const digest = await Effect.runPromise(sha256(bytes, {
      maximumInputBytes: bytes.byteLength,
    }));
    const immediateObjects = new Map<string, Uint8Array>();
    let immediatePuts = 0;
    const immediate = makeSemanticArtifactV1R2Store({
      put: (key, body) => {
        immediatePuts += 1;
        immediateObjects.set(key, new Uint8Array(body));
        return Promise.resolve({});
      },
      get: key => Promise.resolve(streamObject(immediateObjects.get(key))),
    }, sha256);
    const exact = await Effect.runPromise(immediate.putImmutable(
      "block",
      digest,
      bytes,
      {
        maximumCalls: 6,
        maximumBodyBytes: bytes.byteLength * 5,
        maximumHashBytes: bytes.byteLength * 2,
      },
    ));
    expect(exact.usage).toEqual({
      calls: 4,
      bodyBytes: bytes.byteLength * 4,
      hashBytes: bytes.byteLength * 2,
    });
    expect(immediatePuts).toBe(1);

    let rejectedPuts = 0;
    const rejected = makeSemanticArtifactV1R2Store({
      put: () => {
        rejectedPuts += 1;
        return Promise.resolve({});
      },
      get: () => Promise.resolve(null),
    }, sha256);
    expect((await Effect.runPromiseExit(rejected.putImmutable(
      "block",
      digest,
      bytes,
      {
        maximumCalls: 5,
        maximumBodyBytes: bytes.byteLength * 5,
        maximumHashBytes: bytes.byteLength * 2,
      },
    )))._tag).toBe("Failure");
    expect(rejectedPuts).toBe(0);

    let delayedPuts = 0;
    let delayedBytes: Uint8Array | undefined;
    const delayed = makeSemanticArtifactV1R2Store({
      put: (_key, body) => {
        delayedPuts += 1;
        if (delayedPuts === 2) delayedBytes = new Uint8Array(body);
        return Promise.resolve({});
      },
      get: () => Promise.resolve(streamObject(delayedBytes)),
    }, sha256);
    const repeated = await Effect.runPromise(delayed.putImmutable(
      "block",
      digest,
      bytes,
      {
        maximumCalls: 6,
        maximumBodyBytes: bytes.byteLength * 5,
        maximumHashBytes: bytes.byteLength * 2,
      },
    ));
    expect(repeated.usage).toEqual({
      calls: 6,
      bodyBytes: bytes.byteLength * 5,
      hashBytes: bytes.byteLength * 2,
    });
    expect(delayedPuts).toBe(2);

    let oversizedHashes = 0;
    let oversizedCancelled = 0;
    const oversized = makeSemanticArtifactV1R2Store({
      put: () => Promise.resolve({}),
      get: () => Promise.resolve({
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(5));
          },
          cancel() {
            oversizedCancelled += 1;
          },
        }),
      }),
    }, makeSemanticArtifactV1Sha256(input => {
      oversizedHashes += 1;
      return webcrypto.subtle.digest("SHA-256", input);
    }));
    const oversizedFailure = await Effect.runPromise(Effect.flip(oversized.readImmutable(
      "block",
      digest,
      {
        maximumCalls: 2,
        maximumBodyBytes: 8,
        maximumHashBytes: bytes.byteLength,
      },
    )));
    expect(oversizedFailure).toMatchObject({
      _tag: "SemanticArtifactV1R2InputError",
      reason: "budgetExceeded",
    });
    expect(oversizedHashes).toBe(0);
    expect(oversizedCancelled).toBe(1);

    const reconciliationFailure = new Error("get failed after conditional create");
    const ambiguous = makeSemanticArtifactV1R2Store({
      put: () => Promise.resolve({}),
      get: () => Promise.reject(reconciliationFailure),
    }, sha256);
    const ambiguousFailure = await Effect.runPromise(Effect.flip(ambiguous.putImmutable(
      "block",
      digest,
      bytes,
      {
        maximumCalls: 6,
        maximumBodyBytes: bytes.byteLength * 5,
        maximumHashBytes: bytes.byteLength * 2,
      },
    )));
    expect(ambiguousFailure._tag).toBe("SemanticArtifactV1R2SettlementUncertainError");
    if (ambiguousFailure._tag === "SemanticArtifactV1R2SettlementUncertainError") {
      expect(semanticArtifactV1R2UncertainCause(ambiguousFailure)).toEqual(
        expect.objectContaining({ read: expect.anything() }),
      );
    }
  });

  it("admits semantic R2 size metadata before body work without remapping failures", async () => {
    const bytes = new TextEncoder().encode("semantic\n");
    const sha256 = makeSemanticArtifactV1Sha256(input =>
      webcrypto.subtle.digest("SHA-256", input)
    );
    const digest = await Effect.runPromise(sha256(bytes, {
      maximumInputBytes: bytes.byteLength,
    }));
    const events: string[] = [];
    let bodyAccesses = 0;
    let hashes = 0;
    const exact = makeSemanticArtifactV1R2Store({
      put: async () => ({}),
      get: async () => Object.defineProperties({}, {
        size: {
          enumerable: true,
          get: () => {
            events.push("size");
            return bytes.byteLength;
          },
        },
        body: {
          enumerable: true,
          get: () => {
            bodyAccesses += 1;
            events.push("body");
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(bytes));
                controller.close();
              },
            });
          },
        },
      }),
    }, makeSemanticArtifactV1Sha256(input => {
      hashes += 1;
      events.push("hash");
      return webcrypto.subtle.digest("SHA-256", input);
    }));
    const value = await Effect.runPromise(exact.readImmutableAdmitted(
      "block",
      digest,
      receipt => Effect.sync(() => {
        events.push("admit");
        expect(Object.isFrozen(receipt)).toBe(true);
        receipt.digest.fill(0);
      }),
    ));
    expect(value.bytes).toEqual(bytes);
    expect(events).toEqual(["size", "admit", "body", "hash"]);
    expect({ bodyAccesses, hashes }).toEqual({ bodyAccesses: 1, hashes: 1 });

    let rejectedBodyAccesses = 0;
    const rejected = makeSemanticArtifactV1R2Store({
      put: async () => ({}),
      get: async () => Object.defineProperties({}, {
        size: { enumerable: true, value: bytes.byteLength },
        body: {
          enumerable: true,
          get: () => {
            rejectedBodyAccesses += 1;
            return null;
          },
        },
      }),
    }, sha256);
    const typed = new SemanticArtifactV1TestAdmissionError({
      reason: "budgetExceeded",
    });
    expect(await Effect.runPromise(Effect.flip(
      rejected.readImmutableAdmitted(
        "block",
        digest,
        receipt => receipt.byteLength > bytes.byteLength - 1
          ? Effect.fail(typed)
          : Effect.void,
      ),
    ))).toBe(typed);
    expect(rejectedBodyAccesses).toBe(0);

    const defect = new Error("semantic admission defect");
    expect(defectOfSemantic(await Effect.runPromiseExit(
      rejected.readImmutableAdmitted(
        "block",
        digest,
        () => Effect.die(defect),
      ),
    ))).toBe(defect);
    expect(rejectedBodyAccesses).toBe(0);

    const interruptedAdmission = await Effect.runPromiseExit(
      rejected.readImmutableAdmitted(
        "block",
        digest,
        () => Effect.interrupt,
      ),
    );
    expect(Exit.isFailure(interruptedAdmission)).toBe(true);
    if (Exit.isSuccess(interruptedAdmission)) {
      throw new Error("Expected interrupted admission.");
    }
    expect(Cause.hasInterruptsOnly(interruptedAdmission.cause)).toBe(true);
    expect(rejectedBodyAccesses).toBe(0);

    const invalid = makeSemanticArtifactV1R2Store({
      put: async () => ({}),
      get: async () => ({ size: Number.NaN }),
    }, sha256);
    expect(await Effect.runPromise(Effect.flip(
      invalid.readImmutableAdmitted("block", digest, () => Effect.void),
    ))).toMatchObject({
      _tag: "SemanticArtifactV1R2CorruptionError",
      reason: "invalidMetadata",
    });

    const metadataDefect = new Error("semantic metadata getter defect");
    const hostileMetadata = makeSemanticArtifactV1R2Store({
      put: async () => ({}),
      get: async () => Object.defineProperty({}, "size", {
        enumerable: true,
        get: () => {
          throw metadataDefect;
        },
      }),
    }, sha256);
    expect(defectOfSemantic(await Effect.runPromiseExit(
      hostileMetadata.readImmutableAdmitted(
        "block",
        digest,
        () => Effect.void,
      ),
    ))).toBe(metadataDefect);

    const bodyDefect = new Error("semantic body getter defect");
    const hostileBody = makeSemanticArtifactV1R2Store({
      put: async () => ({}),
      get: async () => Object.defineProperties({}, {
        size: { enumerable: true, value: bytes.byteLength },
        body: {
          enumerable: true,
          get: () => {
            throw bodyDefect;
          },
        },
      }),
    }, sha256);
    expect(defectOfSemantic(await Effect.runPromiseExit(
      hostileBody.readImmutableAdmitted(
        "block",
        digest,
        () => Effect.void,
      ),
    ))).toBe(bodyDefect);

    const sizeMismatch = makeSemanticArtifactV1R2Store({
      put: async () => ({}),
      get: async () => ({
        size: bytes.byteLength + 1,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          },
        }),
      }),
    }, sha256);
    expect(await Effect.runPromise(Effect.flip(
      sizeMismatch.readImmutableAdmitted("block", digest, () => Effect.void),
    ))).toMatchObject({
      _tag: "SemanticArtifactV1R2CorruptionError",
      reason: "sizeMismatch",
    });
  });

  it("publishes block/tree/root last and returns only tuple-bound inert evidence", async () => {
    const fixture = makeFixture();
    const request = new Request("https://private.test/upload");
    const proof = await Effect.runPromise(fixture.proofs.issue(request, fixture.proofInput));
    const begin = await Effect.runPromise(fixture.core.begin({
      request,
      proof,
      deploymentId: "deployment",
      commandId: "begin-1",
      ceilings,
      admission: budgets,
    }));
    expect(begin.semanticUploadId).toBe("semantic-upload");
    expect(begin.mutationFence).toBe(0);

    const append = await Effect.runPromise(fixture.core.append({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "append-1",
      admission: budgets,
      blockOrdinal: 0,
      bytes: new TextEncoder().encode("{\"kind\":\"function\"}\n"),
    }));
    expect(append.mutationFence).toBe(2);
    expect([...fixture.objectWriteOrder].some(key => key.includes("/block/"))).toBe(true);
    const replay = await Effect.runPromise(fixture.core.append({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "append-1",
      admission: budgets,
      blockOrdinal: 0,
      bytes: new TextEncoder().encode("{\"kind\":\"function\"}\n"),
    }));
    expect(replay).toEqual(append);
    const conflict = await Effect.runPromiseExit(fixture.core.append({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "append-1",
      admission: budgets,
      blockOrdinal: 0,
      bytes: new TextEncoder().encode("{\"kind\":\"schema\"}\n"),
    }));
    expect(conflict._tag).toBe("Failure");

    const finalized = await Effect.runPromise(fixture.core.finalize({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: append.mutationFence,
      commandId: "finalize-1",
      admission: budgets,
    }));
    expect(finalized.state).toBe("finalized");
    expect(finalized.completedRootSha256).toHaveLength(32);
    expect(fixture.objectWriteOrder.at(-1)).toContain("/root/");

    const readRequest = new Request("https://private.test/read");
    const readProof = await Effect.runPromise(
      fixture.proofs.issue(readRequest, fixture.proofInput),
    );
    const evidence = await Effect.runPromise(fixture.core.readFinalized(
      readRequest,
      readProof,
      {
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: finalized.mutationFence,
        commandId: "read-1",
        admission: budgets,
      },
    ));
    expect(evidence.projectId).toBe("project");
    expect(evidence.deploymentCreatedAt).toBe("2026-07-24T00:00:00.000Z");
    expect(evidence.sourceRootSha256).toEqual(new Uint8Array(32).fill(1));
    expect(evidence.semanticAttemptIdentitySha256).toHaveLength(32);
    expect(evidence.usage).toEqual({
      calls: 6,
      blockBytes: 0,
      canonicalBytes: 362,
      frameBytes: 1_247,
      hashBytes: 902,
      timeMilliseconds: 10_000,
    });
    const exactRequest = new Request("https://private.test/read-exact");
    const exactProof = await Effect.runPromise(
      fixture.proofs.issue(exactRequest, fixture.proofInput),
    );
    const exact = await Effect.runPromise(fixture.core.readFinalized(
      exactRequest,
      exactProof,
      {
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: finalized.mutationFence,
        commandId: "read-exact",
        admission: evidence.usage,
      },
    ));
    expect(exact.usage).toEqual(evidence.usage);
    const originalAttemptIdentity = Buffer.from(
      exact.semanticAttemptIdentitySha256,
    ).toString("hex");
    exact.semanticAttemptIdentitySha256[0] ^= 0xff;
    const aliasRequest = new Request("https://private.test/read-alias");
    const aliasProof = await Effect.runPromise(
      fixture.proofs.issue(aliasRequest, fixture.proofInput),
    );
    const aliasIsolated = await Effect.runPromise(fixture.core.readFinalized(
      aliasRequest,
      aliasProof,
      {
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: finalized.mutationFence,
        commandId: "read-alias",
        admission: evidence.usage,
      },
    ));
    expect(Buffer.from(
      aliasIsolated.semanticAttemptIdentitySha256,
    ).toString("hex")).toBe(originalAttemptIdentity);
    const reopenRequest = new Request(
      "https://private.test/read-finalized-reopen",
    );
    const reopenProof = await Effect.runPromise(
      fixture.proofs.issue(reopenRequest, fixture.proofInput),
    );
    const reopened = await Effect.runPromise(fixture.core.reopen(
      reopenRequest,
      reopenProof,
      {
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: finalized.mutationFence,
        commandId: "read-finalized-reopen",
        admission: budgets,
      },
    ));
    expect(reopened.state).toBe("finalized");
    expect(reopened.mutationFence).toBe(finalized.mutationFence);
    const oneLessRequest = new Request("https://private.test/read-one-less");
    const oneLessProof = await Effect.runPromise(
      fixture.proofs.issue(oneLessRequest, fixture.proofInput),
    );
    const oneLess = await Effect.runPromiseExit(fixture.core.readFinalized(
      oneLessRequest,
      oneLessProof,
      {
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: finalized.mutationFence,
        commandId: "read-one-less",
        admission: { ...evidence.usage, frameBytes: evidence.usage.frameBytes - 1 },
      },
    ));
    expect(oneLess._tag).toBe("Failure");
    const canonicalRequest = new Request("https://private.test/read-canonical-one-less");
    const canonicalProof = await Effect.runPromise(
      fixture.proofs.issue(canonicalRequest, fixture.proofInput),
    );
    const canonicalOneLess = await Effect.runPromiseExit(fixture.core.readFinalized(
      canonicalRequest,
      canonicalProof,
      {
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: finalized.mutationFence,
        commandId: "read-canonical-one-less",
        admission: {
          ...evidence.usage,
          canonicalBytes: evidence.usage.canonicalBytes - 1,
        },
      },
    ));
    expect(canonicalOneLess._tag).toBe("Failure");
  });

  it("rejects missing final LF, gaps, stale fences, source drift, and exact one-less budgets", async () => {
    const fixture = makeFixture();
    const request = new Request("https://private.test/upload");
    const proof = await Effect.runPromise(fixture.proofs.issue(request, fixture.proofInput));
    const begin = await Effect.runPromise(fixture.core.begin({
      request,
      proof,
      deploymentId: "deployment",
      commandId: "begin-2",
      ceilings,
      admission: budgets,
    }));
    const gap = await Effect.runPromiseExit(fixture.core.append({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "gap",
      admission: budgets,
      blockOrdinal: 1,
      bytes: new TextEncoder().encode("{}\n"),
    }));
    expect(gap._tag).toBe("Failure");
    const wrongDeployment = await Effect.runPromiseExit(fixture.core.append({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "other-deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "wrong-deployment",
      admission: budgets,
      blockOrdinal: 0,
      bytes: new TextEncoder().encode("{}\n"),
    }));
    expect(wrongDeployment._tag).toBe("Failure");
    const wrongFinalizeDeployment = await Effect.runPromiseExit(fixture.core.finalize({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "other-deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "wrong-finalize-deployment",
      admission: budgets,
    }));
    expect(wrongFinalizeDeployment._tag).toBe("Failure");
    const wrongAbandonDeployment = await Effect.runPromiseExit(fixture.core.abandon({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "other-deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "wrong-abandon-deployment",
      admission: budgets,
    }));
    expect(wrongAbandonDeployment._tag).toBe("Failure");
    const budgetFailure = await Effect.runPromiseExit(fixture.core.append({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "budget",
      admission: { ...budgets, blockBytes: 1 },
      blockOrdinal: 0,
      bytes: new TextEncoder().encode("{}\n"),
    }));
    expect(budgetFailure._tag).toBe("Failure");
    const append = await Effect.runPromise(fixture.core.append({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "no-lf",
      admission: budgets,
      blockOrdinal: 0,
      bytes: new TextEncoder().encode("{}"),
    }));
    const noLf = await Effect.runPromiseExit(fixture.core.finalize({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: append.mutationFence,
      commandId: "finalize-no-lf",
      admission: budgets,
    }));
    expect(noLf._tag).toBe("Failure");
    const reopenRequest = new Request("https://private.test/reopen");
    const reopenProof = await Effect.runPromise(
      fixture.proofs.issue(reopenRequest, fixture.proofInput),
    );
    const reopened = await Effect.runPromise(fixture.core.reopen(
      reopenRequest,
      reopenProof,
      {
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: append.mutationFence,
        commandId: "reopen-after-finalize-rejection",
        admission: budgets,
      },
    ));
    expect(reopened.state).toBe("open");
    const corrected = await Effect.runPromise(fixture.core.append({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: reopened.mutationFence,
      commandId: "append-final-lf",
      admission: budgets,
      blockOrdinal: 1,
      bytes: new TextEncoder().encode("\n"),
    }));
    const finalized = await Effect.runPromise(fixture.core.finalize({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: corrected.mutationFence,
      commandId: "finalize-corrected",
      admission: budgets,
    }));
    expect(finalized.state).toBe("finalized");
  });

  it("keeps arbitrary UTF-8/record block splits deterministic across cold factories", async () => {
    const first = makeFixture();
    const second = makeFixture();
    const bytes = new TextEncoder().encode("{\"value\":\"😀\"}\n");
    const split = bytes.indexOf(0xf0) + 2;
    const roots: string[] = [];
    for (const [index, fixture] of [first, second].entries()) {
      const request = new Request(`https://private.test/cold-${index}`);
      const proof = await Effect.runPromise(fixture.proofs.issue(request, fixture.proofInput));
      const begin = await Effect.runPromise(fixture.core.begin({
        request,
        proof,
        deploymentId: "deployment",
        commandId: "begin-cold",
        ceilings,
        admission: budgets,
      }));
      const firstBlock = await Effect.runPromise(fixture.core.append({
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: 0,
        commandId: "split-0",
        admission: { ...budgets, blockBytes: split },
        blockOrdinal: 0,
        bytes: bytes.slice(0, split),
      }));
      const secondBlock = await Effect.runPromise(fixture.core.append({
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: firstBlock.mutationFence,
        commandId: "split-1",
        admission: { ...budgets, blockBytes: bytes.byteLength - split },
        blockOrdinal: 1,
        bytes: bytes.slice(split),
      }));
      const finalized = await Effect.runPromise(fixture.core.finalize({
        semanticUploadId: begin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: secondBlock.mutationFence,
        commandId: "finalize-cold",
        admission: budgets,
      }));
      roots.push(Buffer.from(finalized.completedRootSha256!).toString("hex"));
    }
    expect(roots[0]).toBe(roots[1]);
  });

  it("finalizes the empty semantic stream without inventing a caller EOF", async () => {
    const fixture = makeFixture();
    const request = new Request("https://private.test/empty");
    const proof = await Effect.runPromise(fixture.proofs.issue(request, fixture.proofInput));
    const begin = await Effect.runPromise(fixture.core.begin({
      request,
      proof,
      deploymentId: "deployment",
      commandId: "begin-empty",
      ceilings,
      admission: budgets,
    }));
    const finalized = await Effect.runPromise(fixture.core.finalize({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: 0,
      commandId: "finalize-empty",
      admission: budgets,
    }));
    expect(finalized.state).toBe("finalized");
    expect(finalized.completedRootSha256).toHaveLength(32);
  });

  it("rejects a freshly reread finalized-source rollover before attempt creation", async () => {
    const fixture = makeFixture({ sourceCorrelationGeneration: 2 });
    const request = new Request("https://private.test/source-rollover");
    const proof = await Effect.runPromise(fixture.proofs.issue(request, fixture.proofInput));
    const exit = await Effect.runPromiseExit(fixture.core.begin({
      request,
      proof,
      deploymentId: "deployment",
      commandId: "begin-source-rollover",
      ceilings,
      admission: budgets,
    }));
    expect(exit._tag).toBe("Failure");
    expect(fixture.objectWriteOrder).toEqual([]);
  });

  it("keeps abandonment terminal except for byte-identical command replay", async () => {
    const fixture = makeFixture();
    const request = new Request("https://private.test/abandon");
    const proof = await Effect.runPromise(fixture.proofs.issue(request, fixture.proofInput));
    const begin = await Effect.runPromise(fixture.core.begin({
      request,
      proof,
      deploymentId: "deployment",
      commandId: "begin-abandon",
      ceilings,
      admission: budgets,
    }));
    const abandoned = await Effect.runPromise(fixture.core.abandon({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: begin.generation,
      expectedMutationFence: begin.mutationFence,
      commandId: "abandon-1",
      admission: budgets,
    }));
    const replay = await Effect.runPromise(fixture.core.abandon({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: begin.generation,
      expectedMutationFence: begin.mutationFence,
      commandId: "abandon-1",
      admission: budgets,
    }));
    expect(replay).toEqual(abandoned);
    const different = await Effect.runPromiseExit(fixture.core.abandon({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: begin.generation,
      expectedMutationFence: abandoned.mutationFence,
      commandId: "abandon-2",
      admission: budgets,
    }));
    expect(different._tag).toBe("Failure");
  });

  it("durably reserves append usage before R2 work and resumes without recharging", async () => {
    const body = new TextEncoder().encode("{}\n");
    const baseline = makeFixture();
    const baselineBegin = await beginUpload(baseline, "append-reserve-baseline");
    const baselineAppend = await Effect.runPromise(baseline.core.append({
      semanticUploadId: baselineBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: baselineBegin.mutationFence,
      commandId: "append-reserve",
      admission: budgets,
      blockOrdinal: 0,
      bytes: body,
    }));

    const failureSwitch = { enabled: true };
    const interrupted = makeFixture({ r2PutFailureSwitch: failureSwitch });
    const interruptedBegin = await beginUpload(interrupted, "append-reserve-interrupted");
    const failed = await Effect.runPromiseExit(interrupted.core.append({
      semanticUploadId: interruptedBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: interruptedBegin.mutationFence,
      commandId: "append-reserve",
      admission: budgets,
      blockOrdinal: 0,
      bytes: body,
    }));
    expect(failed._tag).toBe("Failure");
    const finalizePending = await Effect.runPromiseExit(interrupted.core.finalize({
      semanticUploadId: interruptedBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: 1,
      commandId: "finalize-pending-append",
      admission: budgets,
    }));
    expect(finalizePending._tag).toBe("Failure");
    const reopenRequest = new Request("https://private.test/reopen-pending-append");
    const reopenProof = await Effect.runPromise(
      interrupted.proofs.issue(reopenRequest, interrupted.proofInput),
    );
    const reopenPending = await Effect.runPromiseExit(interrupted.core.reopen(
      reopenRequest,
      reopenProof,
      {
        semanticUploadId: interruptedBegin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: 1,
        commandId: "reopen-pending-append",
        admission: budgets,
      },
    ));
    expect(reopenPending._tag).toBe("Failure");
    const admissionConflict = await Effect.runPromiseExit(interrupted.core.append({
      semanticUploadId: interruptedBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: interruptedBegin.mutationFence,
      commandId: "append-reserve",
      admission: {
        ...budgets,
        timeMilliseconds: budgets.timeMilliseconds - 1,
      },
      blockOrdinal: 0,
      bytes: body,
    }));
    expect(admissionConflict._tag).toBe("Failure");
    const conflict = await Effect.runPromiseExit(interrupted.core.append({
      semanticUploadId: interruptedBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: interruptedBegin.mutationFence,
      commandId: "append-reserve",
      admission: budgets,
      blockOrdinal: 0,
      bytes: new TextEncoder().encode("[]\n"),
    }));
    expect(conflict._tag).toBe("Failure");
    failureSwitch.enabled = false;
    const resumed = await Effect.runPromise(interrupted.core.append({
      semanticUploadId: interruptedBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: interruptedBegin.mutationFence,
      commandId: "append-reserve",
      admission: budgets,
      blockOrdinal: 0,
      bytes: body,
    }));
    expect(resumed.usage).toEqual(baselineAppend.usage);
    expect(resumed.mutationFence).toBe(2);
  });

  it("allows only one differing-admission append reservation to settle", async () => {
    const fixture = makeFixture();
    const begin = await beginUpload(fixture, "append-reservation-race");
    const body = new TextEncoder().encode("{}\n");
    const append = (timeMilliseconds: number) => fixture.core.append({
      semanticUploadId: begin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: begin.mutationFence,
      commandId: "append-reservation-race",
      admission: { ...budgets, timeMilliseconds },
      blockOrdinal: 0,
      bytes: body,
    }).pipe(Effect.exit);
    const exits = await Effect.runPromise(Effect.all(
      [append(10_000), append(9_999)],
      { concurrency: "unbounded" },
    ));
    expect(exits.filter(exit => exit._tag === "Success")).toHaveLength(1);
    expect(exits.filter(exit => exit._tag === "Failure")).toHaveLength(1);
  });

  it("pins exact and one-less nested call reservations for begin, append, merge, and finalize", async () => {
    const measured = makeFixture();
    const measuredBegin = await beginUpload(measured, "measure");
    const beginAdmission = measuredBegin.usage;
    const exactBeginFixture = makeFixture();
    await expect(beginUpload(
      exactBeginFixture,
      "exact",
      beginAdmission,
    )).resolves.toMatchObject({ state: "open" });
    const oneLessBeginFixture = makeFixture();
    await expect(beginUpload(
      oneLessBeginFixture,
      "one-less",
      { ...beginAdmission, calls: beginAdmission.calls - 1 },
    )).rejects.toBeDefined();

    const firstBlock = new TextEncoder().encode("{}\n");
    const measuredAppend = await Effect.runPromise(measured.core.append({
      semanticUploadId: measuredBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: measuredBegin.mutationFence,
      commandId: "append-measure-0",
      admission: budgets,
      blockOrdinal: 0,
      bytes: firstBlock,
    }));
    const appendAdmission = budgetDifference(measuredAppend.usage, measuredBegin.usage);
    const replayHashStart = measured.hashInputByteLengths.length;
    await expect(Effect.runPromise(measured.core.append({
      semanticUploadId: measuredBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: measuredBegin.mutationFence,
      commandId: "append-measure-0",
      admission: budgets,
      blockOrdinal: 0,
      bytes: firstBlock,
    }))).resolves.toEqual(measuredAppend);
    const replayHashBytes = measured.hashInputByteLengths
      .slice(replayHashStart)
      .reduce((sum, value) => sum + value, 0);
    expect(measured.hashInputByteLengths.length - replayHashStart).toBe(2);
    const exactReplayAdmission = {
      ...budgets,
      calls: 4,
      hashBytes: replayHashBytes,
    };
    await expect(Effect.runPromise(measured.core.append({
      semanticUploadId: measuredBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: measuredBegin.mutationFence,
      commandId: "append-measure-0",
      admission: exactReplayAdmission,
      blockOrdinal: 0,
      bytes: firstBlock,
    }))).resolves.toEqual(measuredAppend);
    await expect(Effect.runPromiseExit(measured.core.append({
      semanticUploadId: measuredBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: measuredBegin.mutationFence,
      commandId: "append-measure-0",
      admission: { ...exactReplayAdmission, calls: 3 },
      blockOrdinal: 0,
      bytes: firstBlock,
    }))).resolves.toMatchObject({ _tag: "Failure" });
    await expect(Effect.runPromiseExit(measured.core.append({
      semanticUploadId: measuredBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: measuredBegin.mutationFence,
      commandId: "append-measure-0",
      admission: { ...exactReplayAdmission, hashBytes: replayHashBytes - 1 },
      blockOrdinal: 0,
      bytes: firstBlock,
    }))).resolves.toMatchObject({ _tag: "Failure" });
    const exactAppendFixture = makeFixture();
    const exactAppendBegin = await beginUpload(exactAppendFixture, "append-exact");
    await expect(Effect.runPromise(exactAppendFixture.core.append({
      semanticUploadId: exactAppendBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: exactAppendBegin.mutationFence,
      commandId: "append-exact-0",
      admission: appendAdmission,
      blockOrdinal: 0,
      bytes: firstBlock,
    }))).resolves.toMatchObject({ state: "open" });
    const oneLessAppendFixture = makeFixture();
    const oneLessAppendBegin = await beginUpload(oneLessAppendFixture, "append-one-less");
    await expect(Effect.runPromiseExit(oneLessAppendFixture.core.append({
      semanticUploadId: oneLessAppendBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: oneLessAppendBegin.mutationFence,
      commandId: "append-one-less-0",
      admission: { ...appendAdmission, calls: appendAdmission.calls - 1 },
      blockOrdinal: 0,
      bytes: firstBlock,
    }))).resolves.toMatchObject({ _tag: "Failure" });

    const measuredMerge = await Effect.runPromise(measured.core.append({
      semanticUploadId: measuredBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: measuredAppend.mutationFence,
      commandId: "append-measure-1",
      admission: budgets,
      blockOrdinal: 1,
      bytes: firstBlock,
    }));
    const mergeAdmission = budgetDifference(measuredMerge.usage, measuredAppend.usage);
    const exactMergeFixture = makeFixture();
    const exactMergeBegin = await beginUpload(exactMergeFixture, "merge-exact");
    const exactMergeFirst = await Effect.runPromise(exactMergeFixture.core.append({
      semanticUploadId: exactMergeBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: exactMergeBegin.mutationFence,
      commandId: "merge-exact-0",
      admission: budgets,
      blockOrdinal: 0,
      bytes: firstBlock,
    }));
    await expect(Effect.runPromise(exactMergeFixture.core.append({
      semanticUploadId: exactMergeBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: exactMergeFirst.mutationFence,
      commandId: "merge-exact-1",
      admission: mergeAdmission,
      blockOrdinal: 1,
      bytes: firstBlock,
    }))).resolves.toMatchObject({ state: "open" });
    const oneLessMergeFixture = makeFixture();
    const oneLessMergeBegin = await beginUpload(oneLessMergeFixture, "merge-one-less");
    const oneLessMergeFirst = await Effect.runPromise(oneLessMergeFixture.core.append({
      semanticUploadId: oneLessMergeBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: oneLessMergeBegin.mutationFence,
      commandId: "merge-one-less-0",
      admission: budgets,
      blockOrdinal: 0,
      bytes: firstBlock,
    }));
    await expect(Effect.runPromiseExit(oneLessMergeFixture.core.append({
      semanticUploadId: oneLessMergeBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: oneLessMergeFirst.mutationFence,
      commandId: "merge-one-less-1",
      admission: { ...mergeAdmission, calls: mergeAdmission.calls - 1 },
      blockOrdinal: 1,
      bytes: firstBlock,
    }))).resolves.toMatchObject({ _tag: "Failure" });

    const measuredFinalize = await Effect.runPromise(measured.core.finalize({
      semanticUploadId: measuredBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: measuredMerge.mutationFence,
      commandId: "finalize-measure",
      admission: budgets,
    }));
    const finalizeAdmission = budgetDifference(measuredFinalize.usage, measuredMerge.usage);
    expect(finalizeAdmission).toEqual({
      calls: 29,
      blockBytes: 0,
      canonicalBytes: 860,
      frameBytes: 3_833,
      hashBytes: 2_538,
      timeMilliseconds: 10_000,
    });
    const exactFinalizeFixture = makeFixture();
    const exactFinalizeBegin = await beginUpload(exactFinalizeFixture, "finalize-exact");
    const exactFinalizeAppend = await Effect.runPromise(exactFinalizeFixture.core.append({
      semanticUploadId: exactFinalizeBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: exactFinalizeBegin.mutationFence,
      commandId: "finalize-exact-0",
      admission: budgets,
      blockOrdinal: 0,
      bytes: firstBlock,
    }));
    await expect(Effect.runPromise(exactFinalizeFixture.core.finalize({
      semanticUploadId: exactFinalizeBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: exactFinalizeAppend.mutationFence,
      commandId: "finalize-exact",
      admission: finalizeAdmission,
    }))).resolves.toMatchObject({ state: "finalized" });
    const oneLessFinalizeFixture = makeFixture();
    const oneLessFinalizeBegin = await beginUpload(
      oneLessFinalizeFixture,
      "finalize-one-less",
    );
    const oneLessFinalizeAppend = await Effect.runPromise(
      oneLessFinalizeFixture.core.append({
        semanticUploadId: oneLessFinalizeBegin.semanticUploadId,
        deploymentId: "deployment",
        expectedGeneration: 1,
        expectedMutationFence: oneLessFinalizeBegin.mutationFence,
        commandId: "finalize-one-less-0",
        admission: budgets,
        blockOrdinal: 0,
        bytes: firstBlock,
      }),
    );
    await expect(Effect.runPromiseExit(oneLessFinalizeFixture.core.finalize({
      semanticUploadId: oneLessFinalizeBegin.semanticUploadId,
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: oneLessFinalizeAppend.mutationFence,
      commandId: "finalize-one-less",
      admission: {
        ...finalizeAdmission,
        frameBytes: finalizeAdmission.frameBytes - 1,
      },
    }))).resolves.toMatchObject({ _tag: "Failure" });
  });
});

function defectOfSemantic<A, E>(exit: Exit.Exit<A, E>): unknown {
  if (Exit.isSuccess(exit)) throw new Error("Expected failed Effect.");
  const defect = Cause.findDefect(exit.cause);
  if (Result.isFailure(defect)) throw new Error("Expected defect Cause.");
  return defect.success;
}

function makeFixture(options: {
  readonly sourceCorrelationGeneration?: number;
  readonly r2PutFailureSwitch?: { enabled: boolean };
} = {}): {
  readonly proofs: ReturnType<typeof makeSemanticArtifactV1FinalizedSourceProofFactory>;
  readonly proofInput: Parameters<
    ReturnType<typeof makeSemanticArtifactV1FinalizedSourceProofFactory>["issue"]
  >[1];
  readonly core: SemanticArtifactV1UploadCore;
  readonly objectWriteOrder: string[];
  readonly hashInputByteLengths: number[];
} {
  const witness = Object.freeze({}) as DeploymentProjectScopeWitnessV1;
  const authorizer: DeploymentProjectScopeAuthorizerV1 = {
    authorize: () => Effect.succeed(witness),
    claim: () => Result.fail(new DeploymentProjectScopeWitnessV1Error({
      reason: "invalidWitness",
    })),
  };
  const finalizedSourceReader: SourceArtifactV2FinalizedAttemptReadComposerV1 = {
    read: () => Effect.succeed({
      requestId: "r0a-request",
      deploymentId: "deployment",
      projectId: "project",
      deploymentCreatedAt: "2026-07-24T00:00:00.000Z",
      uploadId: "source-upload",
      generation: 1,
      mutationFence: 2,
      completedRootDigest: hex(1),
      completedSelectorDigest: hex(2),
      usage: {
        calls: 1,
        inputBytes: 1,
        bodyBytes: 1,
        canonicalBytes: 1,
        frameBytes: 1,
        hashBytes: 1,
        elapsedMilliseconds: 1,
      },
    }),
  };
  const proofs = makeSemanticArtifactV1FinalizedSourceProofFactory({
    authorizer,
    finalizedSourceReader,
  });
  const rows = new Map<string, SemanticArtifactV1Attempt>();
  const attemptStore: SemanticArtifactV1AttemptStore = {
    read: id => Effect.succeed(rows.get(id) ?? null),
    write: mutation => {
      const current = rows.get(mutation.semanticUploadId);
      if (
        current !== undefined &&
        current.lastCommandId === mutation.commandId &&
        current.lastCommandDigest === mutation.commandDigest
      ) return Effect.succeed(current);
      rows.set(mutation.semanticUploadId, mutation.next);
      return Effect.succeed(mutation.next);
    },
  };
  const objectBytes = new Map<string, Uint8Array>();
  const objectWriteOrder: string[] = [];
  const bucket: SemanticArtifactV1R2Bucket = {
    put: (key, body) => {
      if (options.r2PutFailureSwitch?.enabled === true) {
        return Promise.reject(new DOMException("injected put failure", "OperationError"));
      }
      if (!objectBytes.has(key)) {
        objectBytes.set(key, new Uint8Array(body));
        objectWriteOrder.push(key);
      }
      return Promise.resolve({});
    },
    get: key => {
      const bytes = objectBytes.get(key);
      return Promise.resolve(bytes === undefined
        ? null
        : {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(bytes));
              controller.close();
            },
          }),
        });
    },
  };
  const hashInputByteLengths: number[] = [];
  const sha256 = makeSemanticArtifactV1Sha256(input => {
    hashInputByteLengths.push(input.byteLength);
    return webcrypto.subtle.digest("SHA-256", input);
  });
  const r2 = makeSemanticArtifactV1R2Store(bucket, sha256);
  const sourceAttemptReader: SemanticArtifactV1SourceCorrelationReader = {
    read: () => Effect.succeed({
      uploadId: sourceAttempt.uploadId,
      generation: options.sourceCorrelationGeneration ?? sourceAttempt.generation,
      mutationFence: sourceAttempt.mutationFence,
      state: "finalized",
      completedRootDigest: sourceAttempt.completedRootDigest!,
      completedSelectorDigest: sourceAttempt.completedSelectorDigest!,
    }),
  };
  const coreResult = makeSemanticArtifactV1UploadCore({
    proofFactory: proofs,
    sourceAttemptReader,
    attemptStore,
    r2,
    sha256,
    rootConfiguration: {
      semanticModelIdentity: "semantic-model-v1",
      semanticCodecIdentity: "semantic-codec-v1",
      semanticPolicyIdentity: "semantic-policy-v1",
      coreLanguageIdentity: "FlarexDeclarativeExecutableCoreV1",
      abiIdentity: "abi-v1",
      grammarIdentity: "grammar-v1",
      unicodeIdentity: "unicode-14",
      parserTableIdentity: "parser-table-v1",
      trustedToolingIdentity: "tooling-v1",
      ingressProtocolIdentity: "semantic-ingress-v1",
      ingressConfigurationIdentity: "semantic-ingress-config-v1",
    },
    makeUploadId: () => "semantic-upload",
  });
  if (Result.isFailure(coreResult)) throw coreResult.failure;
  return {
    proofs,
    proofInput: {
      authorization: {
        deploymentId: "deployment",
        budget: {
          cumulative: {
            maximumLookupCalls: 10,
            maximumInputBytes: 10_000,
            maximumBodyBytes: 10_000,
            maximumCanonicalBytes: 10_000,
            maximumFrameBytes: 10_000,
            maximumElapsedMilliseconds: 10_000,
          },
          command: {
            maximumLookupCalls: 10,
            maximumInputBytes: 10_000,
            maximumBodyBytes: 10_000,
            maximumCanonicalBytes: 10_000,
            maximumFrameBytes: 10_000,
            maximumElapsedMilliseconds: 10_000,
          },
        },
      },
      source: {
        deploymentId: "deployment",
        uploadId: "source-upload",
        expectedGeneration: 1,
        expectedMutationFence: 2,
        budget: {
          cumulative: {
            maximumCalls: 10,
            maximumInputBytes: 10_000,
            maximumBodyBytes: 10_000,
            maximumCanonicalBytes: 10_000,
            maximumFrameBytes: 10_000,
            maximumHashBytes: 10_000,
            maximumElapsedMilliseconds: 10_000,
          },
          command: {
            maximumCalls: 10,
            maximumInputBytes: 10_000,
            maximumBodyBytes: 10_000,
            maximumCanonicalBytes: 10_000,
            maximumFrameBytes: 10_000,
            maximumHashBytes: 10_000,
            maximumElapsedMilliseconds: 10_000,
          },
        },
      },
    },
    core: coreResult.success,
    objectWriteOrder,
    hashInputByteLengths,
  };
}

function streamObject(bytes: Uint8Array | undefined): unknown {
  return bytes === undefined
    ? null
    : {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(bytes));
          controller.close();
        },
      }),
    };
}

async function beginUpload(
  fixture: ReturnType<typeof makeFixture>,
  suffix: string,
  admission = budgets,
) {
  const request = new Request(`https://private.test/${suffix}`);
  const proof = await Effect.runPromise(fixture.proofs.issue(request, fixture.proofInput));
  return await Effect.runPromise(fixture.core.begin({
    request,
    proof,
    deploymentId: "deployment",
    commandId: `begin-${suffix}`,
    ceilings,
    admission,
  }));
}

function budgetDifference(
  after: typeof budgets,
  before: typeof budgets,
): typeof budgets {
  return {
    calls: after.calls - before.calls,
    blockBytes: after.blockBytes - before.blockBytes,
    canonicalBytes: after.canonicalBytes - before.canonicalBytes,
    frameBytes: after.frameBytes - before.frameBytes,
    hashBytes: after.hashBytes - before.hashBytes,
    timeMilliseconds: after.timeMilliseconds - before.timeMilliseconds,
  };
}
