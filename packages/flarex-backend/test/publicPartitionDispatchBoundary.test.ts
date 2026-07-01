import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  beginPublicPartitionEffect,
  cachePublicPartitionSchemaEffect,
  commitPublicPartitionEffect,
  type PublicPartitionDispatchTarget,
  readPublicPartitionDocumentEffect,
  readPublicPartitionIndexEffect,
} from "../src/partition/PublicDispatchBoundary";
import type {
  PartitionCommitRequest,
  PartitionSchemaCacheRequest,
} from "../src/partition/RouteBoundary";

describe("public partition dispatch boundary", () => {
  it("dispatches begin requests through the typed worker error channel", async () => {
    const requests: DispatchedRequest[] = [];
    const forwarded = Response.json({ beginTs: 1 });

    const response = await Effect.runPromise(beginPublicPartitionEffect(
      partitionTarget(requests, async () => forwarded),
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{
      input: "https://flarex.internal/begin",
      method: "POST",
      contentType: null,
      body: undefined,
    }]);

    const failure = await Effect.runPromise(Effect.flip(beginPublicPartitionEffect(
      failingPartitionTarget("begin unavailable"),
    )));
    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "partition-begin",
      status: 500,
      message: "begin unavailable",
    });
  });

  it("dispatches commit requests through the typed worker error channel", async () => {
    const requests: DispatchedRequest[] = [];
    const commit = partitionCommitRequest();
    const forwarded = Response.json({ committedTs: 2, writes: [] });

    const response = await Effect.runPromise(commitPublicPartitionEffect(
      partitionTarget(requests, async () => forwarded),
      commit,
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{
      input: "https://flarex.internal/commit",
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(commit),
    }]);

    const failure = await Effect.runPromise(Effect.flip(commitPublicPartitionEffect(
      failingPartitionTarget("commit unavailable"),
      commit,
    )));
    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "partition-commit",
      status: 500,
      message: "commit unavailable",
    });
  });

  it("dispatches schema-cache requests through the typed worker error channel", async () => {
    const requests: DispatchedRequest[] = [];
    const schemaCache = partitionSchemaCacheRequest();
    const forwarded = Response.json({ cached: true });

    const response = await Effect.runPromise(cachePublicPartitionSchemaEffect(
      partitionTarget(requests, async () => forwarded),
      schemaCache,
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{
      input: "https://flarex.internal/schema-cache",
      method: "PUT",
      contentType: "application/json",
      body: JSON.stringify(schemaCache),
    }]);

    const failure = await Effect.runPromise(Effect.flip(cachePublicPartitionSchemaEffect(
      failingPartitionTarget("schema cache unavailable"),
      schemaCache,
    )));
    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "partition-schema-cache",
      status: 500,
      message: "schema cache unavailable",
    });
  });

  it("dispatches document and index reads through typed worker error channels", async () => {
    const requests: DispatchedRequest[] = [];
    const partition = partitionTarget(requests, async () => Response.json({ ok: true }));

    await expect(Effect.runPromise(readPublicPartitionDocumentEffect(
      partition,
      { tableId: 1, id: "1:ada", at: 2 },
    ))).resolves.toBeInstanceOf(Response);
    await expect(Effect.runPromise(readPublicPartitionIndexEffect(
      partition,
      { indexId: 3, lower: "a", upper: "z" },
    ))).resolves.toBeInstanceOf(Response);

    expect(requests).toEqual([
      {
        input: "https://flarex.internal/document?tableId=1&id=1%3Aada&at=2",
        method: undefined,
        contentType: null,
        body: undefined,
      },
      {
        input: "https://flarex.internal/index?indexId=3&lower=a&upper=z",
        method: undefined,
        contentType: null,
        body: undefined,
      },
    ]);

    const documentFailure = await Effect.runPromise(Effect.flip(readPublicPartitionDocumentEffect(
      failingPartitionTarget("document unavailable"),
      { tableId: 1, id: "1:ada" },
    )));
    expect(documentFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "partition-document-read",
      status: 500,
      message: "document unavailable",
    });

    const indexFailure = await Effect.runPromise(Effect.flip(readPublicPartitionIndexEffect(
      failingPartitionTarget("index unavailable"),
      { indexId: 3 },
    )));
    expect(indexFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "partition-index-read",
      status: 500,
      message: "index unavailable",
    });
  });
});

type DispatchedRequest = {
  readonly input: string;
  readonly method: string | undefined;
  readonly contentType: string | null;
  readonly body: BodyInit | null | undefined;
};

function partitionTarget(
  requests: DispatchedRequest[],
  respond: () => Promise<Response>,
): PublicPartitionDispatchTarget {
  return {
    fetch: async (input, init) => {
      requests.push({
        input,
        method: init?.method,
        contentType: new Headers(init?.headers).get("content-type"),
        body: init?.body,
      });
      return respond();
    },
  };
}

function failingPartitionTarget(message: string): PublicPartitionDispatchTarget {
  return {
    fetch: async () => {
      throw new Error(message);
    },
  };
}

function partitionCommitRequest(): PartitionCommitRequest {
  return {
    beginTs: 1,
    writes: [
      {
        tableId: 1,
        id: "1:ada",
        value: { name: "Ada" },
      },
    ],
  };
}

function partitionSchemaCacheRequest(): PartitionSchemaCacheRequest {
  return {
    partitionKey: "user:ada",
    schema: {
      version: 1,
      tables: [],
      indexes: [],
    },
  };
}
