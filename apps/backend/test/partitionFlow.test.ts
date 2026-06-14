import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommitRequest, CommitResponse, DocumentReadResponse } from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;

beforeAll(async () => {
  harness = await createBackendHarness();
});

afterAll(async () => {
  await harness.dispose();
});

describe("partition flow", () => {
  it("rejects a stale commit when a document read changed", async () => {
    const deploymentId = "test-deployment";
    const partitionKey = "user:u1";
    const base = `/deployments/${deploymentId}/partitions/${encodeURIComponent(partitionKey)}`;

    const seedBegin = await postJson<{ beginTs: number }>(`${base}/begin`);
    const seedCommit = await commit(`${base}/commit`, {
      beginTs: seedBegin.beginTs,
      writes: [{ tableId: 1, id: "1:lesson", value: { title: "Intro", progress: 0 } }],
    });

    const staleBegin = await postJson<{ beginTs: number }>(`${base}/begin`);
    expect(staleBegin.beginTs).toBe(seedCommit.committedTs);

    const staleRead = await getJson<DocumentReadResponse>(
      `${base}/document?tableId=1&id=${encodeURIComponent("1:lesson")}&at=${staleBegin.beginTs}`,
    );
    expect(staleRead.document?.value).toEqual({ title: "Intro", progress: 0 });
    expect(staleRead.readSet).toEqual({ documents: [{ tableId: 1, id: "1:lesson" }] });

    const concurrentCommit = await commit(`${base}/commit`, {
      beginTs: staleBegin.beginTs,
      readSet: {},
      writes: [{ tableId: 1, id: "1:lesson", value: { title: "Intro", progress: 1 } }],
    });
    expect(concurrentCommit.committedTs).toBe(seedCommit.committedTs + 1);

    const staleCommit = await postJsonRaw(`${base}/commit`, {
      beginTs: staleBegin.beginTs,
      readSet: staleRead.readSet,
      writes: [{ tableId: 1, id: "1:other", value: { title: "Other" } }],
    });

    expect(staleCommit.status).toBe(409);
    await expect(staleCommit.json()).resolves.toMatchObject({
      code: "OCC_CONFLICT",
      conflictingTs: concurrentCommit.committedTs,
    });
  });
});

async function commit(path: string, request: CommitRequest): Promise<CommitResponse> {
  const response = await postJsonRaw(path, request);
  expect(response.status).toBe(201);
  return response.json() as Promise<CommitResponse>;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await postJsonRaw(path, body);
  expect(response.ok).toBe(true);
  return response.json() as Promise<T>;
}

async function postJsonRaw(path: string, body?: unknown) {
  return harness.mf.dispatchFetch(`http://flarex.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function getJson<T>(path: string): Promise<T> {
  const response = await harness.mf.dispatchFetch(`http://flarex.test${path}`);
  expect(response.ok).toBe(true);
  return response.json() as Promise<T>;
}
