import { copyBytesToArrayBuffer, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  type SourceArtifactV2Attempt,
  type SourceArtifactV2AttemptReader,
  type SourceArtifactV2AttemptReadSql,
  makeSourceArtifactV2AttemptReader,
  SourceArtifactV2AttemptStoreCorruptionError,
  SourceArtifactV2AttemptStoreResourceError,
} from "../src/sourceArtifactV2/AttemptStore";
import {
  makeSourceArtifactV2FinalizedAttemptReadRouteV1,
} from "../src/sourceArtifactV2/FinalizedAttemptReadBoundary";
import {
  makeSourceArtifactV2FinalizedAttemptReadComposerV1,
  makeSourceArtifactV2SameIsolateFinalizedAttemptReadComposerV1,
  SourceArtifactV2FinalizedAttemptReadBudgetV1Error,
  SourceArtifactV2FinalizedAttemptReadCorruptionV1Error,
  SourceArtifactV2FinalizedAttemptReadResourceV1Error,
  SourceArtifactV2FinalizedAttemptReadStoredBytesV1Error,
  SourceArtifactV2SameIsolateFinalizedAttemptReadConfigurationV1Error,
} from "../src/sourceArtifactV2/FinalizedAttemptReadComposer";
import {
  decodeSourceArtifactV2FinalizedAttemptReadResponseV1,
  encodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  encodeSourceArtifactV2FinalizedAttemptReadRequestV1,
  sourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  sourceArtifactV2FinalizedAttemptReadMediaTypeV1,
  sourceArtifactV2FinalizedAttemptReadPathV1,
  type SourceArtifactV2FinalizedAttemptReadBudgetV1,
} from "../src/sourceArtifactV2/FinalizedAttemptReadProtocol";
import { sourceArtifactV2UploadSelectorFrame } from "../src/sourceArtifactV2/Framing";
import { sourceArtifactV2DigestBytesFromLowerHex } from "../src/sourceArtifactV2/Digest";
import { makeSourceArtifactV2Sha256 } from "../src/sourceArtifactV2/Sha256";
import {
  projectSourceArtifactV2CheckpointSnapshot,
  SourceArtifactV2CheckpointReadBudgetError,
  SourceArtifactV2CheckpointReadCorruptionError,
  type SourceArtifactV2CheckpointReader,
} from "../src/sourceArtifactV2/CheckpointReader";
import { makeDeploymentProjectScopeAuthorizerV1 } from "../src/deploymentProjectScopeAuthorization";
import {
  makeSemanticArtifactV1FinalizedSourceProofFactory,
} from "../src/semanticArtifactV1/FinalizedSourceProof";
import type {
  DeploymentProjectScopeLookupClientV1,
  DeploymentProjectScopeLookupInputV1,
} from "../src/deploymentProjectScopeLookup";
import type { Env } from "../src/types";

const budget: SourceArtifactV2FinalizedAttemptReadBudgetV1 = Object.freeze({
  maximumCalls: 20,
  maximumInputBytes: 100_000,
  maximumBodyBytes: 100_000,
  maximumCanonicalBytes: 100_000,
  maximumFrameBytes: 100_000,
  maximumHashBytes: 100_000,
  maximumElapsedMilliseconds: 10_000,
});

describe("source artifact v2 finalized-attempt private read", () => {
  it("owns one upload-id primary-key read and performs no write", async () => {
    const statements: Array<{ readonly query: string; readonly parameters: readonly unknown[] }> = [];
    const sql: SourceArtifactV2AttemptReadSql = {
      exec: <T extends Record<string, ArrayBuffer | string | number | null>>(
        query: string,
        ...parameters: unknown[]
      ): SqlStorageCursor<T> => {
        statements.push({ query, parameters });
        return {
          next: () => ({ done: true }),
          toArray: () => [],
          one: () => { throw new Error("no row"); },
          raw: function* () {},
          columnNames: [],
          rowsRead: 0,
          rowsWritten: 0,
          [Symbol.iterator]: function* () {},
        };
      },
    };
    const reader = makeSourceArtifactV2AttemptReader(sql);
    await expect(Effect.runPromise(reader.read("upload-primary-key"))).resolves.toBeNull();
    expect(statements).toHaveLength(1);
    expect(statements[0]?.query).toContain("FROM source_artifact_upload_attempts_v2");
    expect(statements[0]?.query).toContain("WHERE upload_id = ?");
    expect(statements[0]?.parameters).toEqual(["upload-primary-key"]);
    expect(statements[0]?.query).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);
  });

  it("reads one exact finalized attempt and verifies its selector", async () => {
    const attempt = await finalizedAttempt();
    const read = vi.fn(() => Effect.succeed(attempt));
    const route = makeRoute({ read });
    const response = await Effect.runPromise(route.route(privateRequest(attempt)));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(attempt.uploadId);
    const decoded = success(decodeSourceArtifactV2FinalizedAttemptReadResponseV1(
      new Uint8Array(await response.arrayBuffer()),
      budget,
    ));
    expect(decoded.value).toMatchObject({
      kind: "finalized",
      deploymentId: "deployment-a",
      uploadId: attempt.uploadId,
      generation: attempt.generation,
      mutationFence: attempt.mutationFence,
      completedSelectorDigest: attempt.completedSelectorDigest,
    });
  });

  it("closes missing, stale, non-finalized, corrupt, and selector-mismatch reads distinctly", async () => {
    const attempt = await finalizedAttempt();
    const cases = [
      [null, 404, "notFound"],
      [{ ...attempt, generation: 2 }, 409, "staleGeneration"],
      [{ ...attempt, mutationFence: 10 }, 409, "staleFence"],
      [{ ...attempt, state: "open", completedRootDigest: null, completedSelectorDigest: null }, 409,
        "lifecycleMismatch"],
      [{ ...attempt, state: "closing", completedRootDigest: null, completedSelectorDigest: null },
        409, "lifecycleMismatch"],
      [{ ...attempt, state: "abandoned", completedRootDigest: null, completedSelectorDigest: null },
        409, "lifecycleMismatch"],
      [{ ...attempt, completedSelectorDigest: "ff".repeat(32) }, 500, "corruption"],
    ] as const;
    for (const [value, status, kind] of cases) {
      const route = makeRoute({ read: () => Effect.succeed(value as SourceArtifactV2Attempt | null) });
      const response = await Effect.runPromise(route.route(privateRequest(attempt)));
      expect(response.status).toBe(status);
      const decoded = success(decodeSourceArtifactV2FinalizedAttemptReadResponseV1(
        new Uint8Array(await response.arrayBuffer()),
        budget,
      ));
      expect(decoded.value.kind).toBe(kind);
    }

    const corruptRoute = makeRoute({
      read: () => Effect.fail(new SourceArtifactV2AttemptStoreCorruptionError({
        uploadId: attempt.uploadId,
        detail: "corrupt",
      })),
    });
    const corrupt = await Effect.runPromise(corruptRoute.route(privateRequest(attempt)));
    expect(corrupt.status).toBe(500);

    const resourceRoute = makeRoute({
      read: () => Effect.fail(new SourceArtifactV2AttemptStoreResourceError({
        operation: "read",
        uploadId: attempt.uploadId,
      })),
    });
    const resource = await Effect.runPromise(resourceRoute.route(privateRequest(attempt)));
    expect(resource.status).toBe(503);
    expect(success(decodeSourceArtifactV2FinalizedAttemptReadResponseV1(
      new Uint8Array(await resource.arrayBuffer()),
      budget,
    )).value.kind).toBe("resourceFailure");

    const hashResourceRoute = makeSourceArtifactV2FinalizedAttemptReadRouteV1({
      durableObjectName: "deployment:deployment-a",
      reader: { read: () => Effect.succeed(attempt) },
      sha256: makeSourceArtifactV2Sha256(() => Promise.reject(
        new DOMException("digest unavailable", "OperationError"),
      )),
    });
    const hashResource = await Effect.runPromise(
      hashResourceRoute.route(privateRequest(attempt)),
    );
    expect(hashResource.status).toBe(503);
    expect(success(decodeSourceArtifactV2FinalizedAttemptReadResponseV1(
      new Uint8Array(await hashResource.arrayBuffer()),
      budget,
    )).value.kind).toBe("resourceFailure");
  });

  it("shares one trusted digest parser with owned output and invariant defects", () => {
    const first = sourceArtifactV2DigestBytesFromLowerHex("12".repeat(32));
    const second = sourceArtifactV2DigestBytesFromLowerHex("12".repeat(32));
    first[0] = 0xff;
    expect(second[0]).toBe(0x12);
    expect(() => sourceArtifactV2DigestBytesFromLowerHex("AA".repeat(32))).toThrow(
      "Stored source-artifact digest is not canonical lowercase hexadecimal.",
    );
  });

  it("fails closed on object-name mismatch and exact plus one-less budgets", async () => {
    const attempt = await finalizedAttempt();
    const wrongObject = makeSourceArtifactV2FinalizedAttemptReadRouteV1({
      durableObjectName: "deployment:other",
      reader: { read: () => Effect.succeed(attempt) },
      sha256: liveSha(),
    });
    expect((await Effect.runPromise(wrongObject.route(privateRequest(attempt)))).status).toBe(500);

    const exactRequest = encodedPrivateRequest(attempt, budget);
    const exactBody = exactRequest.bytes.byteLength;
    const tooSmall = { ...budget, maximumBodyBytes: exactBody - 1 };
    const response = await Effect.runPromise(makeRoute({
      read: () => Effect.succeed(attempt),
    }).route(privateRequest(attempt, tooSmall, exactRequest.bytes)));
    expect(response.status).toBe(422);
    expect(response.headers.get("x-flarex-source-artifact-v2-finalized-read-budget-failure-v1"))
      .toBe("bodyBytes");
  });

  it("claims A0a synchronously before stub acquisition and returns inert owned evidence", async () => {
    const attempt = await finalizedAttempt();
    const authorizer = authorizerFor("deployment-a");
    const originalRequest = pushRequest();
    const witness = await Effect.runPromise(authorizer.authorize(originalRequest, {
      deploymentId: "deployment-a",
      budget: { cumulative: lookupBudget(), command: lookupBudget() },
    }));
    const route = makeRoute({ read: () => Effect.succeed(attempt) });
    const getByName = vi.fn((name: string) => {
      expect(name).toBe("deployment:deployment-a");
      expect(failureReason(authorizer.claim(witness, originalRequest, "deployment-a")))
        .toBe("alreadyClaimed");
      return { fetch: (request: Request) => Effect.runPromise(route.route(request)) };
    });
    const composer = makeSourceArtifactV2FinalizedAttemptReadComposerV1({
      env: { DEPLOYMENTS: { getByName } as unknown as DurableObjectNamespace },
      authorizer,
      makeRequestId: () => "backend-request-a",
    });
    const result = await Effect.runPromise(composer.read(
      originalRequest,
      witness,
      composerInput(attempt),
    ));
    expect(getByName).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      requestId: "backend-request-a",
      projectId: "configured-project",
      completedSelectorDigest: attempt.completedSelectorDigest,
    });
    expect(result.usage.calls).toBe(3);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.usage)).toBe(true);
  });

  it("rejects forged authority before stub access and burns genuine authority on fetch failure", async () => {
    const attempt = await finalizedAttempt();
    const authorizer = authorizerFor("deployment-a");
    const originalRequest = pushRequest();
    const getByName = vi.fn(() => ({
      fetch: () => Promise.reject(new Error("offline")),
    }));
    const composer = makeSourceArtifactV2FinalizedAttemptReadComposerV1({
      env: { DEPLOYMENTS: { getByName } as unknown as DurableObjectNamespace },
      authorizer,
      makeRequestId: () => "backend-request-a",
    });
    const forgedExit = await Effect.runPromiseExit(composer.read(
      originalRequest,
      {} as never,
      composerInput(attempt),
    ));
    expect(failureTag(forgedExit)).toBe("DeploymentProjectScopeWitnessV1Error");
    expect(getByName).not.toHaveBeenCalled();

    const witness = await Effect.runPromise(authorizer.authorize(originalRequest, {
      deploymentId: "deployment-a",
      budget: { cumulative: lookupBudget(), command: lookupBudget() },
    }));
    const exit = await Effect.runPromiseExit(composer.read(
      originalRequest,
      witness,
      composerInput(attempt),
    ));
    expect(failureOf(exit)).toBeInstanceOf(SourceArtifactV2FinalizedAttemptReadResourceV1Error);
    expect(failureReason(authorizer.claim(witness, originalRequest, "deployment-a")))
      .toBe("alreadyClaimed");
  });

  it("rejects cross-factory and wrong-request authority before stub access", async () => {
    const attempt = await finalizedAttempt();
    const issuer = authorizerFor("deployment-a");
    const consumer = authorizerFor("deployment-a");
    const originalRequest = pushRequest();
    const witness = await Effect.runPromise(issuer.authorize(originalRequest, {
      deploymentId: "deployment-a",
      budget: { cumulative: lookupBudget(), command: lookupBudget() },
    }));
    const getByName = vi.fn();
    const composer = makeSourceArtifactV2FinalizedAttemptReadComposerV1({
      env: { DEPLOYMENTS: { getByName } as unknown as DurableObjectNamespace },
      authorizer: consumer,
    });
    const crossFactory = await Effect.runPromiseExit(composer.read(
      originalRequest,
      witness,
      composerInput(attempt),
    ));
    expect(failureTag(crossFactory)).toBe("DeploymentProjectScopeWitnessV1Error");
    expect(getByName).not.toHaveBeenCalled();

    const wrongRequest = new Request(originalRequest);
    const wrongRequestExit = await Effect.runPromiseExit(
      makeSourceArtifactV2FinalizedAttemptReadComposerV1({
        env: { DEPLOYMENTS: { getByName } as unknown as DurableObjectNamespace },
        authorizer: issuer,
      }).read(wrongRequest, witness, composerInput(attempt)),
    );
    expect(failureTag(wrongRequestExit)).toBe("DeploymentProjectScopeWitnessV1Error");
    expect(getByName).not.toHaveBeenCalled();
  });

  it("aggregates the exact three-call distributed budget and rejects one less", async () => {
    const attempt = await finalizedAttempt();
    for (const [maximumCalls, succeeds] of [[3, true], [2, false]] as const) {
      const authorizer = authorizerFor("deployment-a");
      const originalRequest = pushRequest();
      const witness = await Effect.runPromise(authorizer.authorize(originalRequest, {
        deploymentId: "deployment-a",
        budget: { cumulative: lookupBudget(), command: lookupBudget() },
      }));
      const route = makeRoute({ read: () => Effect.succeed(attempt) });
      const composer = makeSourceArtifactV2FinalizedAttemptReadComposerV1({
        env: {
          DEPLOYMENTS: {
            getByName: () => ({
              fetch: (request: Request) => Effect.runPromise(route.route(request)),
            }),
          } as unknown as DurableObjectNamespace,
        },
        authorizer,
        makeRequestId: () => `calls-${maximumCalls}`,
      });
      const exactBudget = Object.freeze({ ...budget, maximumCalls });
      const exit = await Effect.runPromiseExit(composer.read(
        originalRequest,
        witness,
        composerInput(attempt, exactBudget),
      ));
      if (succeeds) {
        expect(Exit.isSuccess(exit)).toBe(true);
        if (Exit.isSuccess(exit)) expect(exit.value.usage.calls).toBe(3);
      } else {
        expect(failureOf(exit)).toBeInstanceOf(
          SourceArtifactV2FinalizedAttemptReadBudgetV1Error,
        );
        expect(failureOf(exit)).toMatchObject({ field: "calls" });
      }
    }
  });

  it("burns the witness before an interrupted transport and mints no evidence", async () => {
    const attempt = await finalizedAttempt();
    const authorizer = authorizerFor("deployment-a");
    const originalRequest = pushRequest();
    const witness = await Effect.runPromise(authorizer.authorize(originalRequest, {
      deploymentId: "deployment-a",
      budget: { cumulative: lookupBudget(), command: lookupBudget() },
    }));
    let enteredFetch: (() => void) | undefined;
    const entered = new Promise<void>(resolve => {
      enteredFetch = resolve;
    });
    const composer = makeSourceArtifactV2FinalizedAttemptReadComposerV1({
      env: {
        DEPLOYMENTS: {
          getByName: () => ({
            fetch: (request: Request) => new Promise<Response>((_resolve, reject) => {
              enteredFetch?.();
              request.signal.addEventListener("abort", () => reject(request.signal.reason), {
                once: true,
              });
            }),
          }),
        } as unknown as DurableObjectNamespace,
      },
      authorizer,
    });
    const fiber = Effect.runFork(composer.read(
      originalRequest,
      witness,
      composerInput(attempt),
    ));
    await entered;
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(failureReason(authorizer.claim(witness, originalRequest, "deployment-a")))
      .toBe("alreadyClaimed");
  });

  it("issues and claims one request-bound semantic proof through the same-isolate reader", async () => {
    const attempt = await finalizedAttempt();
    const authorizer = authorizerFor("deployment-a");
    const request = pushRequest();
    const read = vi.fn(() => Effect.succeed(
      projectSourceArtifactV2CheckpointSnapshot(attempt),
    ));
    const finalizedSourceReader = success(
      makeSourceArtifactV2SameIsolateFinalizedAttemptReadComposerV1({
        authorizer,
        checkpointReader: Object.freeze({ read }),
        sha256: liveSha(),
        maximumStoredBytes: 100_000,
        makeRequestId: () => "same-isolate-request-a",
      }),
    );
    const proofs = makeSemanticArtifactV1FinalizedSourceProofFactory({
      authorizer,
      finalizedSourceReader,
    });
    const proof = await Effect.runPromise(proofs.issue(request, {
      authorization: {
        deploymentId: "deployment-a",
        budget: { cumulative: lookupBudget(), command: lookupBudget() },
      },
      source: composerInput(attempt),
    }));
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(attempt.uploadId, {
      maximumCalls: budget.maximumCalls,
      maximumStoredBytes: 100_000,
    });
    const claimed = success(proofs.claim(proof, request, "deployment-a"));
    expect(claimed).toMatchObject({
      projectId: "configured-project",
      deploymentId: "deployment-a",
      sourceUploadId: attempt.uploadId,
      sourceGeneration: attempt.generation,
      sourceMutationFence: attempt.mutationFence,
    });
    expect(encodeBytesToLowercaseHex(claimed.sourceRootSha256))
      .toBe(attempt.completedRootDigest);
    claimed.sourceRootSha256[0] = 0xff;
    expect(failureReason(proofs.claim(proof, request, "deployment-a")))
      .toBe("alreadyClaimed");
  });

  it("claims same-isolate authority before durable work and rejects foreign authority", async () => {
    const attempt = await finalizedAttempt();
    const issuer = authorizerFor("deployment-a");
    const consumer = authorizerFor("deployment-a");
    const request = pushRequest();
    const read = vi.fn(() => Effect.never);
    const composer = success(
      makeSourceArtifactV2SameIsolateFinalizedAttemptReadComposerV1({
        authorizer: consumer,
        checkpointReader: Object.freeze({ read }),
        sha256: liveSha(),
        maximumStoredBytes: 100_000,
      }),
    );
    const foreignWitness = await Effect.runPromise(issuer.authorize(request, {
      deploymentId: "deployment-a",
      budget: { cumulative: lookupBudget(), command: lookupBudget() },
    }));
    expect(failureTag(await Effect.runPromiseExit(composer.read(
      request,
      foreignWitness,
      composerInput(attempt),
    )))).toBe("DeploymentProjectScopeWitnessV1Error");
    expect(read).not.toHaveBeenCalled();

    const witness = await Effect.runPromise(consumer.authorize(request, {
      deploymentId: "deployment-a",
      budget: { cumulative: lookupBudget(), command: lookupBudget() },
    }));
    const fiber = Effect.runFork(composer.read(request, witness, composerInput(attempt)));
    while (read.mock.calls.length === 0) {
      await Promise.resolve();
    }
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(failureReason(consumer.claim(witness, request, "deployment-a")))
      .toBe("alreadyClaimed");
  });

  it("maps bounded checkpoint outcomes without weakening lifecycle or selector proof", async () => {
    const attempt = await finalizedAttempt();
    const cases = [
      {
        value: null,
        expectedTag: "SourceArtifactV2FinalizedAttemptReadNotFoundV1Error",
      },
      {
        value: projectSourceArtifactV2CheckpointSnapshot({
          ...attempt,
          generation: attempt.generation + 1,
        }),
        expectedTag: "SourceArtifactV2FinalizedAttemptReadStaleV1Error",
      },
      {
        value: projectSourceArtifactV2CheckpointSnapshot({
          ...attempt,
          state: "open",
          completedRootDigest: null,
          completedSelectorDigest: null,
        }),
        expectedTag: "SourceArtifactV2FinalizedAttemptReadLifecycleV1Error",
      },
      {
        value: {
          ...projectSourceArtifactV2CheckpointSnapshot(attempt),
          uploadId: "different-upload",
        },
        expectedTag: "SourceArtifactV2FinalizedAttemptReadCorruptionV1Error",
      },
      {
        value: {
          ...projectSourceArtifactV2CheckpointSnapshot(attempt),
          completedSelectorDigest: "ff".repeat(32),
        },
        expectedTag: "SourceArtifactV2FinalizedAttemptReadCorruptionV1Error",
      },
    ] as const;
    for (const entry of cases) {
      const { composer, request, witness } = await sameIsolateFixture(
        attempt,
        () => Effect.succeed(entry.value),
      );
      const failure = failureOf(await Effect.runPromiseExit(
        composer.read(request, witness, composerInput(attempt)),
      ));
      expect(failure).toMatchObject({ _tag: entry.expectedTag });
    }

    const corruption = await sameIsolateFixture(
      attempt,
      () => Effect.fail(new SourceArtifactV2CheckpointReadCorruptionError({
        uploadId: attempt.uploadId,
      })),
    );
    expect(failureOf(await Effect.runPromiseExit(corruption.composer.read(
      corruption.request,
      corruption.witness,
      composerInput(attempt),
    )))).toBeInstanceOf(SourceArtifactV2FinalizedAttemptReadCorruptionV1Error);
  });

  it("keeps stored-row admission distinct and accounts exactly two reads plus one hash", async () => {
    const attempt = await finalizedAttempt();
    const storedBudget = await sameIsolateFixture(
      attempt,
      () => Effect.fail(new SourceArtifactV2CheckpointReadBudgetError({
        uploadId: attempt.uploadId,
        dimension: "storedBytes",
        observed: 101,
        maximum: 100,
      })),
      100,
    );
    expect(failureOf(await Effect.runPromiseExit(storedBudget.composer.read(
      storedBudget.request,
      storedBudget.witness,
      composerInput(attempt),
    )))).toEqual(new SourceArtifactV2FinalizedAttemptReadStoredBytesV1Error({
      uploadId: attempt.uploadId,
      observed: 101,
      maximum: 100,
    }));

    for (const [maximumCalls, succeeds] of [[3, true], [2, false]] as const) {
      const fixture = await sameIsolateFixture(
        attempt,
        () => Effect.succeed(projectSourceArtifactV2CheckpointSnapshot(attempt)),
      );
      const operationBudget = Object.freeze({ ...budget, maximumCalls });
      const exit = await Effect.runPromiseExit(fixture.composer.read(
        fixture.request,
        fixture.witness,
        composerInput(attempt, operationBudget),
      ));
      if (succeeds) {
        expect(Exit.isSuccess(exit)).toBe(true);
        if (Exit.isSuccess(exit)) expect(exit.value.usage.calls).toBe(3);
      } else {
        expect(failureOf(exit)).toEqual(
          new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
            field: "calls",
          }),
        );
      }
    }
  });

  it("admits selector canonicalization at the exact ceiling and rejects one byte less", async () => {
    const attempt = await finalizedAttempt();
    const baseline = await sameIsolateFixture(
      attempt,
      () => Effect.succeed(projectSourceArtifactV2CheckpointSnapshot(attempt)),
    );
    const baselineExit = await Effect.runPromiseExit(baseline.composer.read(
      baseline.request,
      baseline.witness,
      composerInput(attempt),
    ));
    expect(Exit.isSuccess(baselineExit)).toBe(true);
    if (Exit.isFailure(baselineExit)) return;
    const exactCanonicalBytes = baselineExit.value.usage.canonicalBytes;

    for (
      const [maximumCanonicalBytes, succeeds] of [
        [exactCanonicalBytes, true],
        [exactCanonicalBytes - 1, false],
      ] as const
    ) {
      const fixture = await sameIsolateFixture(
        attempt,
        () => Effect.succeed(projectSourceArtifactV2CheckpointSnapshot(attempt)),
      );
      const operationBudget = Object.freeze({
        ...budget,
        maximumCanonicalBytes,
      });
      const exit = await Effect.runPromiseExit(fixture.composer.read(
        fixture.request,
        fixture.witness,
        composerInput(attempt, operationBudget),
      ));
      if (succeeds) {
        expect(Exit.isSuccess(exit)).toBe(true);
      } else {
        expect(failureOf(exit)).toEqual(
          new SourceArtifactV2FinalizedAttemptReadBudgetV1Error({
            field: "canonicalBytes",
          }),
        );
      }
    }
  });

  it("rejects an invalid same-isolate stored-row ceiling at construction", () => {
    const result = makeSourceArtifactV2SameIsolateFinalizedAttemptReadComposerV1({
      authorizer: authorizerFor("deployment-a"),
      checkpointReader: Object.freeze({
        read: () => Effect.die("must not read"),
      }),
      sha256: liveSha(),
      maximumStoredBytes: 0,
    });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toEqual(
        new SourceArtifactV2SameIsolateFinalizedAttemptReadConfigurationV1Error({
          reason: "invalidMaximumStoredBytes",
        }),
      );
    }
  });

  it("classifies gateway responses with bodies as transport resource failures", async () => {
    const attempt = await finalizedAttempt();
    for (const status of [502, 503, 504]) {
      const authorizer = authorizerFor("deployment-a");
      const originalRequest = pushRequest();
      const witness = await Effect.runPromise(authorizer.authorize(originalRequest, {
        deploymentId: "deployment-a",
        budget: { cumulative: lookupBudget(), command: lookupBudget() },
      }));
      const composer = makeSourceArtifactV2FinalizedAttemptReadComposerV1({
        env: {
          DEPLOYMENTS: {
            getByName: () => ({
              fetch: () => Promise.resolve(new Response("gateway unavailable", {
                status,
                headers: { "content-type": "text/plain" },
              })),
            }),
          } as unknown as DurableObjectNamespace,
        },
        authorizer,
      });
      const exit = await Effect.runPromiseExit(composer.read(
        originalRequest,
        witness,
        composerInput(attempt),
      ));
      expect(failureOf(exit)).toMatchObject({
        _tag: "SourceArtifactV2FinalizedAttemptReadResourceV1Error",
        operation: "durableObject",
      });
    }
  });
});

function makeRoute(reader: SourceArtifactV2AttemptReader) {
  return makeSourceArtifactV2FinalizedAttemptReadRouteV1({
    durableObjectName: "deployment:deployment-a",
    reader,
    sha256: liveSha(),
  });
}

async function sameIsolateFixture(
  attempt: SourceArtifactV2Attempt,
  read: SourceArtifactV2CheckpointReader["read"],
  maximumStoredBytes = 100_000,
) {
  const authorizer = authorizerFor("deployment-a");
  const request = pushRequest();
  const witness = await Effect.runPromise(authorizer.authorize(request, {
    deploymentId: "deployment-a",
    budget: { cumulative: lookupBudget(), command: lookupBudget() },
  }));
  const composer = success(
    makeSourceArtifactV2SameIsolateFinalizedAttemptReadComposerV1({
      authorizer,
      checkpointReader: Object.freeze({ read }),
      sha256: liveSha(),
      maximumStoredBytes,
      makeRequestId: () => `same-isolate-${attempt.uploadId}`,
    }),
  );
  return Object.freeze({ composer, request, witness });
}

function liveSha() {
  return makeSourceArtifactV2Sha256(input => crypto.subtle.digest("SHA-256", input));
}

async function finalizedAttempt(): Promise<SourceArtifactV2Attempt> {
  const rootDigest = "11".repeat(32);
  const frame = success(sourceArtifactV2UploadSelectorFrame({
    deploymentId: "deployment-a",
    uploadId: "upload-a",
    generation: 1n,
    rootDigest: new Uint8Array(32).fill(0x11),
  }, { maximumFrameBytesMaterialized: 10_000 }));
  const selectorDigest = encodeBytesToLowercaseHex(new Uint8Array(
    await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(frame.bytes)),
  ));
  const resourceBudget = Object.freeze({
    calls: 10,
    blockBytes: 10,
    modules: 10,
    sourceMaps: 10,
    canonicalBytes: 10_000,
    frameBytes: 10_000,
    hashBytes: 10_000,
    timeMilliseconds: 10_000,
  });
  return Object.freeze({
    uploadId: "upload-a",
    generation: 1,
    mutationFence: 9,
    state: "finalized",
    nextModuleOrdinal: 1,
    lastModulePath: "functions/main.js",
    currentModule: null,
    moduleFrontier: Object.freeze([Object.freeze({
      firstOrdinal: 0,
      count: 1,
      digest: "22".repeat(32),
    })]),
    counters: Object.freeze({
      moduleCount: 1,
      functionModuleCount: 1,
      sourceByteLength: 10,
      sourceMapByteLength: 0,
      executionPath: "functions/main.js",
      schemaPath: null,
      authPath: null,
    }),
    ceilings: resourceBudget,
    usage: Object.freeze({ ...resourceBudget, calls: 5 }),
    pendingCommand: null,
    lastCommandId: "finalize-a",
    lastCommandDigest: "33".repeat(32),
    lastReceipt: Object.freeze({ kind: "finalize" }),
    completedRootDigest: rootDigest,
    completedSelectorDigest: selectorDigest,
  });
}

function encodedPrivateRequest(
  attempt: SourceArtifactV2Attempt,
  requestBudget = budget,
) {
  return success(encodeSourceArtifactV2FinalizedAttemptReadRequestV1({
    codecVersion: 1,
    sourceArtifactCodecVersion: 1,
    requestId: "request-a",
    deploymentId: "deployment-a",
    uploadId: attempt.uploadId,
    expectedGeneration: attempt.generation,
    expectedMutationFence: attempt.mutationFence,
  }, requestBudget));
}

function privateRequest(
  attempt: SourceArtifactV2Attempt,
  requestBudget = budget,
  encodedOverride?: Uint8Array,
): Request {
  const encoded = encodedOverride ?? encodedPrivateRequest(attempt, requestBudget).bytes;
  return new Request(`https://flarex.internal${sourceArtifactV2FinalizedAttemptReadPathV1}`, {
    method: "POST",
    headers: {
      "content-type": sourceArtifactV2FinalizedAttemptReadMediaTypeV1,
      [sourceArtifactV2FinalizedAttemptReadBudgetHeaderV1]: success(
        encodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1(requestBudget),
      ),
    },
    body: copyBytesToArrayBuffer(encoded),
  });
}

function composerInput(
  attempt: SourceArtifactV2Attempt,
  operationBudget: SourceArtifactV2FinalizedAttemptReadBudgetV1 = budget,
) {
  return Object.freeze({
    deploymentId: "deployment-a",
    uploadId: attempt.uploadId,
    expectedGeneration: attempt.generation,
    expectedMutationFence: attempt.mutationFence,
    budget: Object.freeze({ cumulative: operationBudget, command: operationBudget }),
  });
}

function authorizerFor(deploymentId: string) {
  const lookup: DeploymentProjectScopeLookupClientV1 = Object.freeze({
    lookup: (input: DeploymentProjectScopeLookupInputV1) => Effect.succeed(Object.freeze({
      deploymentId,
      projectId: input.projectId,
      deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
      usage: Object.freeze({
        lookupCalls: 1,
        inputBytes: 1,
        bodyBytes: 1,
        canonicalBytes: 1,
        frameBytes: 1,
        elapsedMilliseconds: 0,
      }),
    })),
  });
  return success(makeDeploymentProjectScopeAuthorizerV1({
    FLAREX_ANALYZED_START_TOKEN: "push-secret",
    FLAREX_PROJECT_ID: "configured-project",
    FLAREX_EXECUTOR_TOKEN: "executor-secret",
    FLAREX_EXECUTOR: { fetch: async () => new Response() } as unknown as Fetcher,
  } as Env, lookup));
}

function lookupBudget() {
  return Object.freeze({
    maximumLookupCalls: 1,
    maximumInputBytes: 10_000,
    maximumBodyBytes: 10_000,
    maximumCanonicalBytes: 10_000,
    maximumFrameBytes: 10_000,
    maximumElapsedMilliseconds: 10_000,
  });
}

function pushRequest(): Request {
  return new Request("https://backend.test/api/deployments/deployment-a/push", {
    method: "POST",
    headers: { authorization: "Bearer push-secret" },
  });
}

function failureReason(result: Result.Result<unknown, { readonly reason: string }>): string | undefined {
  return Result.isFailure(result) ? result.failure.reason : undefined;
}

function failureTag(exit: Exit.Exit<unknown, unknown>): string | undefined {
  const failure = failureOf(exit);
  return typeof failure === "object" && failure !== null && "_tag" in failure
    ? String(failure._tag)
    : undefined;
}

function failureOf(exit: Exit.Exit<unknown, unknown>): unknown {
  if (Exit.isSuccess(exit)) throw new Error("expected failure");
  const failure = Cause.findErrorOption(exit.cause);
  return failure._tag === "Some" ? failure.value : undefined;
}

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
