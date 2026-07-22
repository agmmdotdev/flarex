import {
  decodeDeploymentProjectScopeLookupResponseV1,
  deploymentProjectScopeLookupBudgetFailureHeaderV1,
  deploymentProjectScopeLookupBudgetHeaderV1,
  deploymentProjectScopeLookupMediaTypeV1,
  encodeDeploymentProjectScopeLookupBudgetHeaderV1,
  encodeDeploymentProjectScopeLookupRequestV1,
  type DeploymentProjectScopeLookupBudgetV1,
} from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeDeploymentProjectScopeLookupHostV1 } from "../src/deploymentProjectScopeLookup";

const budget = Object.freeze({
  maximumLookupCalls: 1,
  maximumInputBytes: 4_096,
  maximumBodyBytes: 4_096,
  maximumCanonicalBytes: 4_096,
  maximumFrameBytes: 4_096,
  maximumElapsedMilliseconds: 1_000,
}) satisfies DeploymentProjectScopeLookupBudgetV1;

describe("executor deployment project-scope lookup host", () => {
  it("performs only the exact primary-key read and returns matched evidence", async () => {
    const createdAt = new Date("2026-07-22T00:00:00.000Z");
    const getDeploymentMetadata = vi.fn(async (deploymentId: string) => ({
      deploymentId,
      projectId: "project-a",
      activePackageId: null,
      activeSchemaVersion: 0,
      createdAt,
    }));
    const host = makeDeploymentProjectScopeLookupHostV1({ getDeploymentMetadata });

    const response = await host(lookupRequest("deployment-a", "project-a"));
    expect(response.status).toBe(200);
    const decoded = unwrap(decodeDeploymentProjectScopeLookupResponseV1(
      new Uint8Array(await response.arrayBuffer()),
      budget,
    ));
    expect(decoded.value).toEqual({
      codecVersion: 1,
      kind: "matched",
      deploymentId: "deployment-a",
      projectId: "project-a",
      deploymentCreatedAt: createdAt.toISOString(),
    });
    expect(getDeploymentMetadata).toHaveBeenCalledTimes(1);
    expect(getDeploymentMetadata).toHaveBeenCalledWith("deployment-a");
  });

  it("closes missing and mismatched relationships without leaking persisted project data", async () => {
    const missing = makeDeploymentProjectScopeLookupHostV1({
      getDeploymentMetadata: async () => null,
    });
    const missingResponse = await missing(lookupRequest("missing", "project-a"));
    expect(missingResponse.status).toBe(404);
    expect(unwrap(decodeDeploymentProjectScopeLookupResponseV1(
      new Uint8Array(await missingResponse.arrayBuffer()),
      budget,
    )).value).toEqual({ codecVersion: 1, kind: "notFound", deploymentId: "missing" });

    const mismatch = makeDeploymentProjectScopeLookupHostV1({
      getDeploymentMetadata: async (deploymentId) => ({
        deploymentId,
        projectId: "persisted-secret-project",
        activePackageId: null,
        activeSchemaVersion: 0,
        createdAt: new Date("2026-07-22T00:00:00.000Z"),
      }),
    });
    const mismatchResponse = await mismatch(lookupRequest("deployment-a", "caller-project"));
    expect(mismatchResponse.status).toBe(409);
    const mismatchText = await mismatchResponse.text();
    expect(mismatchText).not.toContain("persisted-secret-project");
    expect(mismatchText).not.toContain("caller-project");
  });

  it("rejects method, media type, body, and budget before lookup", async () => {
    const getDeploymentMetadata = vi.fn(async () => null);
    const host = makeDeploymentProjectScopeLookupHostV1({ getDeploymentMetadata });
    const valid = lookupRequest("deployment-a", "project-a");
    const invalidRequests = [
      new Request(valid.url, { method: "GET" }),
      new Request(valid.url, { method: "POST", body: "{}" }),
      new Request(valid.url, {
        method: "POST",
        headers: {
          "content-type": deploymentProjectScopeLookupMediaTypeV1,
          [deploymentProjectScopeLookupBudgetHeaderV1]: "bad",
        },
        body: "{}",
      }),
    ];
    for (const request of invalidRequests) {
      expect((await host(request)).status).toBeGreaterThanOrEqual(400);
    }
    expect(getDeploymentMetadata).not.toHaveBeenCalled();
  });

  it("maps the foreign read rejection once to a redacted unavailable response", async () => {
    const resourceFailures: unknown[] = [];
    const cause = new Error("secret database detail");
    const host = makeDeploymentProjectScopeLookupHostV1({
      getDeploymentMetadata: async () => {
        throw cause;
      },
    }, {
      reportResourceFailure: (failure) => Effect.sync(() => {
        resourceFailures.push(failure);
      }),
    });
    const response = await host(lookupRequest("deployment-a", "project-a"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret database detail");
    expect(resourceFailures).toEqual([{ operation: "lookup", cause }]);
  });

  it("bounds a stalled lookup and excessive zero-length stream chunks", async () => {
    const stalled = makeDeploymentProjectScopeLookupHostV1({
      getDeploymentMetadata: () => new Promise(() => undefined),
    });
    const shortBudget = { ...budget, maximumElapsedMilliseconds: 5 };
    const timedOut = await stalled(lookupRequest(
      "deployment-a",
      "project-a",
      shortBudget,
    ));
    expect(timedOut.status).toBe(422);
    expect(timedOut.headers.get(
      deploymentProjectScopeLookupBudgetFailureHeaderV1,
    )).toBe("elapsedMilliseconds");

    let emitted = 0;
    const zeroChunks = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted < 3) {
          emitted += 1;
          controller.enqueue(new Uint8Array());
        } else {
          controller.close();
        }
      },
    });
    const tinyBudget = { ...budget, maximumBodyBytes: 1 };
    const bounded = await makeDeploymentProjectScopeLookupHostV1({
      getDeploymentMetadata: async () => null,
    })(new Request("https://executor.test/internal/v1/deployment-project-scope/lookup", {
      method: "POST",
      headers: {
        "content-type": deploymentProjectScopeLookupMediaTypeV1,
        [deploymentProjectScopeLookupBudgetHeaderV1]: unwrap(
          encodeDeploymentProjectScopeLookupBudgetHeaderV1(tinyBudget),
        ),
      },
      body: zeroChunks,
      duplex: "half",
    } as RequestInit));
    expect(bounded.status).toBe(400);
  });
});

function lookupRequest(
  deploymentId: string,
  projectId: string,
  commandBudget: DeploymentProjectScopeLookupBudgetV1 = budget,
): Request {
  const encoded = unwrap(encodeDeploymentProjectScopeLookupRequestV1({
    codecVersion: 1,
    deploymentId,
    projectId,
  }, commandBudget));
  return new Request("https://executor.test/internal/v1/deployment-project-scope/lookup", {
    method: "POST",
    headers: {
      "content-type": deploymentProjectScopeLookupMediaTypeV1,
      [deploymentProjectScopeLookupBudgetHeaderV1]: unwrap(
        encodeDeploymentProjectScopeLookupBudgetHeaderV1(commandBudget),
      ),
    },
    body: copyBytesToArrayBuffer(encoded.bytes),
  });
}

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
