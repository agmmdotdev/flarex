import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Result } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deploymentObjectName } from "../src/routing";
import {
  decodeSourceArtifactV2FinalizedAttemptReadResponseV1,
  encodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  encodeSourceArtifactV2FinalizedAttemptReadRequestV1,
  sourceArtifactV2FinalizedAttemptReadBudgetHeaderV1,
  sourceArtifactV2FinalizedAttemptReadMediaTypeV1,
  sourceArtifactV2FinalizedAttemptReadPathV1,
} from "../src/sourceArtifactV2/FinalizedAttemptReadProtocol";
import type { Env } from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

const budget = Object.freeze({
  maximumCalls: 20,
  maximumInputBytes: 100_000,
  maximumBodyBytes: 100_000,
  maximumCanonicalBytes: 100_000,
  maximumFrameBytes: 100_000,
  maximumHashBytes: 100_000,
  maximumElapsedMilliseconds: 10_000,
});

describe("production DeploymentDO finalized-attempt private route", () => {
  let harness: BackendHarness;
  let env: Env;

  beforeAll(async () => {
    harness = await createBackendHarness();
    env = await harness.mf.getBindings<Env>();
  }, 60_000);

  afterAll(async () => {
    await harness.dispose();
  });

  it("constructs the production reader and replays an exact missing-row observation", async () => {
    const deploymentId = "private-reader-production";
    const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId));
    const firstRequest = privateRequest(deploymentId);
    const secondRequest = privateRequest(deploymentId);
    const first = await deployment.fetch(firstRequest.url, firstRequest.init);
    const second = await deployment.fetch(secondRequest.url, secondRequest.init);
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    const firstValue = success(decodeSourceArtifactV2FinalizedAttemptReadResponseV1(
      new Uint8Array(await first.arrayBuffer()),
      budget,
    )).value;
    const secondValue = success(decodeSourceArtifactV2FinalizedAttemptReadResponseV1(
      new Uint8Array(await second.arrayBuffer()),
      budget,
    )).value;
    expect(firstValue).toEqual(secondValue);
    expect(firstValue).toMatchObject({
      kind: "notFound",
      deploymentId,
      uploadId: "missing-upload",
    });
  });

  it("does not expose the private Durable Object path through public Worker routing", async () => {
    const response = await harness.mf.dispatchFetch(
      `https://backend.test${sourceArtifactV2FinalizedAttemptReadPathV1}`,
      {
        method: "POST",
        headers: { "content-type": sourceArtifactV2FinalizedAttemptReadMediaTypeV1 },
        body: "{}",
      },
    );
    expect(response.status).toBe(404);
  });

  it("fails closed when the request deployment does not match the named object", async () => {
    const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName("other-deployment"));
    const request = privateRequest("claimed-deployment");
    const response = await deployment.fetch(request.url, request.init);
    expect(response.status).toBe(500);
    expect(success(decodeSourceArtifactV2FinalizedAttemptReadResponseV1(
      new Uint8Array(await response.arrayBuffer()),
      budget,
    )).value.kind).toBe("corruption");
  });
});

function privateRequest(deploymentId: string): Readonly<{
  readonly url: string;
  readonly init: RequestInit;
}> {
  const encoded = success(encodeSourceArtifactV2FinalizedAttemptReadRequestV1({
    codecVersion: 1,
    sourceArtifactCodecVersion: 1,
    requestId: "production-private-read",
    deploymentId,
    uploadId: "missing-upload",
    expectedGeneration: 1,
    expectedMutationFence: 1,
  }, budget));
  return Object.freeze({
    url: `https://flarex.internal${sourceArtifactV2FinalizedAttemptReadPathV1}`,
    init: Object.freeze({
      method: "POST",
      headers: Object.freeze({
        "content-type": sourceArtifactV2FinalizedAttemptReadMediaTypeV1,
        [sourceArtifactV2FinalizedAttemptReadBudgetHeaderV1]: success(
          encodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1(budget),
        ),
      }),
      body: copyBytesToArrayBuffer(encoded.bytes),
    }),
  });
}

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
