import { describe, expect, it, vi } from "vitest";
import { FlarexClient, resolvePartitionKey } from "../src/client";
import type { FunctionReference } from "../src/api";
import type { UserIdentity } from "../src/auth";

const userPartition = {
  type: "partition" as const,
  table: "users",
  selector: "byId",
  partitionField: "_id",
  argField: "userId",
};

declare const internalListLessons: FunctionReference<
  "query",
  "internal",
  { userId: string },
  string[]
>;
declare const internalCompleteLesson: FunctionReference<
  "mutation",
  "internal",
  { userId: string },
  { completed: boolean }
>;

function assertPublicClientReferences(client: FlarexClient): void {
  // @ts-expect-error Public client queries must not accept internal references.
  void client.query(internalListLessons, { userId: "user-1" });
  // @ts-expect-error Public client live queries must not accept internal references.
  void client.watchQuery(internalListLessons, { userId: "user-1" });
  // @ts-expect-error Public client subscriptions must not accept internal references.
  void client.onUpdate(internalListLessons, { userId: "user-1" }, () => undefined);
  // @ts-expect-error Public client mutations must not accept internal references.
  void client.mutation(internalCompleteLesson, { userId: "user-1" });
}

void assertPublicClientReferences;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event: any) => void>>();
  readyState = 1;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  receive(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("FlarexClient", () => {
  it("invokes a generated reference in an explicit partition", async () => {
    const fetch = vi.fn(async () => Response.json({ value: { completed: true } }));
    const client = new FlarexClient("https://example.test", { fetch });

    await expect(
      client.mutation(
        { _path: "lessons:complete", _kind: "mutation" },
        { lessonId: "intro" },
        { partitionKey: "user-1", transport: "http" },
      ),
    ).resolves.toEqual({ completed: true });

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.test/invoke"),
      expect.objectContaining({
        body: JSON.stringify({
          path: "lessons:complete",
          args: { lessonId: "intro" },
          partitionKey: "user-1",
        }),
      }),
    );
  });

  it("infers invoke partitions from generated partition metadata", async () => {
    const fetch = vi.fn(async () => Response.json({ value: { completed: true } }));
    const client = new FlarexClient("https://example.test", { fetch });

    await expect(
      client.query(
        { _path: "lessons:list", _kind: "query", _partition: userPartition },
        { userId: "user-1" },
      ),
    ).resolves.toEqual({ completed: true });

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.test/invoke"),
      expect.objectContaining({
        body: JSON.stringify({
          path: "lessons:list",
          args: { userId: "user-1" },
          partitionKey: "user-1",
        }),
      }),
    );
  });

  it("requires record args when inferring generated partitions", () => {
    const reference = {
      _path: "lessons:list",
      _kind: "query",
      _partition: userPartition,
    } satisfies FunctionReference;

    for (const args of [null, [], "user-1"]) {
      expect(() => resolvePartitionKey(reference, args)).toThrow(
        "partitionKey for lessons:list must be inferred from object args.userId.",
      );
    }
  });

  it("sends bearer auth from setAuth on one-shot HTTP invokes", async () => {
    const fetch = vi.fn(async () => Response.json({ value: ["Intro"] }));
    const fetchToken = vi.fn(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      expect(forceRefreshToken).toBe(false);
      return "jwt-token";
    });
    const client = new FlarexClient("https://example.test", { fetch });
    client.setAuth(fetchToken);

    await expect(
      client.query(
        { _path: "lessons:list", _kind: "query", _partition: userPartition },
        { userId: "user-1" },
      ),
    ).resolves.toEqual(["Intro"]);

    expect(fetchToken).toHaveBeenCalledWith({ forceRefreshToken: false });
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.test/invoke"),
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          authorization: "Bearer jwt-token",
        },
        body: JSON.stringify({
          path: "lessons:list",
          args: { userId: "user-1" },
          partitionKey: "user-1",
        }),
      }),
    );
  });

  it("clears bearer auth for later one-shot HTTP invokes", async () => {
    const fetch = vi.fn(async () => Response.json({ value: ["Intro"] }));
    const client = new FlarexClient("https://example.test", { fetch });
    client.setAuth(async () => "jwt-token");

    await client.query(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { userId: "user-1" },
    );
    client.clearAuth();
    await client.query(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { userId: "user-1" },
    );

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      new URL("https://example.test/invoke"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer jwt-token",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      new URL("https://example.test/invoke"),
      expect.objectContaining({
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("omits bearer auth when the token fetcher returns no token", async () => {
    const fetch = vi.fn(async () => Response.json({ value: ["Intro"] }));
    const client = new FlarexClient("https://example.test", { fetch });
    client.setAuth(async () => null);

    await client.query(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { userId: "user-1" },
    );

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.test/invoke"),
      expect.objectContaining({
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("sends trusted dev identity through resolver headers without request-body spoofing", async () => {
    const fetch = vi.fn(async () => Response.json({ value: { completed: true } }));
    const identity = {
      tokenIdentifier: "issuer|user-1",
      subject: "user-1",
      issuer: "issuer",
      name: "Ada",
    } satisfies UserIdentity;
    const client = new FlarexClient("https://example.test", { fetch });
    client.setTrustedExecutionIdentity(identity, "trusted-secret");
    identity.subject = "mutated-after-set";

    await expect(
      client.mutation(
        { _path: "lessons:complete", _kind: "mutation" },
        { lessonId: "intro" },
        { partitionKey: "user-1", transport: "http" },
      ),
    ).resolves.toEqual({ completed: true });

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.test/invoke"),
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          "x-flarex-trusted-execution-identity": JSON.stringify({
            kind: "user",
            user: {
              tokenIdentifier: "issuer|user-1",
              subject: "user-1",
              issuer: "issuer",
              name: "Ada",
            },
          }),
          "x-flarex-trusted-execution-identity-token": "trusted-secret",
        },
        body: JSON.stringify({
          path: "lessons:complete",
          args: { lessonId: "intro" },
          partitionKey: "user-1",
        }),
      }),
    );
  });

  it("requires a token for trusted dev identity headers", () => {
    const client = new FlarexClient("https://example.test", {
      fetch: async () => Response.json({ value: null }),
    });
    const identity = {
      tokenIdentifier: "issuer|user-1",
      subject: "user-1",
      issuer: "issuer",
    } satisfies UserIdentity;

    expect(() => client.setTrustedExecutionIdentity(identity, "")).toThrow(
      "Trusted execution identity token must be a non-empty string.",
    );
  });

  it("sends create-root generated mutation references over sync without partition keys", async () => {
    FakeWebSocket.instances = [];
    const fetch = vi.fn(async () => Response.json({ value: "2:user" }));
    const client = new FlarexClient("https://example.test", {
      fetch,
      webSocketConstructor: FakeWebSocket,
    });

    const result = client.mutation(
      {
        _path: "users:create",
        _kind: "mutation",
        _partition: {
          type: "partitionCreateRoot",
          table: "users",
          partitionField: "_id",
        },
      },
      { name: "Ada" },
    );

    const ws = FakeWebSocket.instances[0]!;
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: "Mutation",
      requestId: 0,
      udfPath: "users:create",
      args: [{ name: "Ada" }],
    });

    ws.receive({
      type: "MutationResponse",
      requestId: 0,
      success: true,
      result: "2:user",
      logLines: [],
    });

    await expect(result).resolves.toEqual("2:user");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("omits partition keys for create-root mutations over explicit HTTP invoke", async () => {
    FakeWebSocket.instances = [];
    const fetch = vi.fn(async () => Response.json({ value: "2:user" }));
    const client = new FlarexClient("https://example.test", {
      fetch,
      webSocketConstructor: FakeWebSocket,
    });

    await expect(
      client.mutation(
        {
          _path: "users:create",
          _kind: "mutation",
          _partition: {
            type: "partitionCreateRoot",
            table: "users",
            partitionField: "_id",
          },
        },
        { name: "Ada" },
        { transport: "http" },
      ),
    ).resolves.toEqual("2:user");

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.test/invoke"),
      expect.objectContaining({
        body: JSON.stringify({
          path: "users:create",
          args: { name: "Ada" },
        }),
      }),
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("does not infer invoke partitions without partition metadata", async () => {
    const client = new FlarexClient("https://example.test", {
      fetch: async () => Response.json({ value: null }),
    });

    expect(() =>
      client.query(
        { _path: "lessons:list", _kind: "query" },
        { userId: "user-1" },
      ),
    ).toThrow(
      "partitionKey is required for lessons:list. Add partition: model.table.byX(...) to the function or pass { partitionKey }.",
    );
  });

  it("subscribes to live queries with Convex-style query-set messages", () => {
    FakeWebSocket.instances = [];
    const callback = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    const unsubscribe = client.onUpdate(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { courseId: "english", userId: "user-1" },
      callback,
    );

    const ws = FakeWebSocket.instances[0]!;
    expect(ws.url).toBe("wss://example.test/deployments/app/sync");
    expect(ws.sent.map(message => JSON.parse(message))).toEqual([
      {
        type: "ModifyQuerySet",
        baseVersion: 0,
        newVersion: 1,
        modifications: [
          {
            type: "Add",
            queryId: 0,
            udfPath: "lessons:list",
            args: [{ courseId: "english", userId: "user-1" }],
            partitionKey: "user-1",
          },
        ],
      },
    ]);

    ws.receive({
      type: "Transition",
      startVersion: { querySet: 0, ts: 0, identity: 0 },
      endVersion: { querySet: 1, ts: 1, identity: 0 },
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 0,
          value: [{ title: "Intro" }],
          logLines: [],
          journal: null,
        },
      ],
    });

    expect(callback).toHaveBeenCalledWith([{ title: "Intro" }]);
    expect(unsubscribe.getCurrentValue()).toEqual([{ title: "Intro" }]);

    unsubscribe();
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: "ModifyQuerySet",
      baseVersion: 1,
      newVersion: 2,
      modifications: [{ type: "Remove", queryId: 0 }],
    });
  });

  it("sends sync Authenticate messages from setAuth and clearAuth", async () => {
    FakeWebSocket.instances = [];
    const callback = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    client.onUpdate(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { courseId: "english", userId: "user-1" },
      callback,
    );
    const ws = FakeWebSocket.instances[0]!;

    client.setAuth(async () => "token-1");
    await Promise.resolve();

    expect(ws.sent.map(message => JSON.parse(message)).at(-1)).toEqual({
      type: "Authenticate",
      tokenType: "User",
      value: "token-1",
      baseVersion: 0,
    });

    client.clearAuth();

    expect(ws.sent.map(message => JSON.parse(message)).at(-1)).toEqual({
      type: "Authenticate",
      tokenType: "None",
      baseVersion: 1,
    });
  });

  it("rolls back sync auth version after server AuthError", async () => {
    FakeWebSocket.instances = [];
    const callback = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    client.onUpdate(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { courseId: "english", userId: "user-1" },
      callback,
    );
    const ws = FakeWebSocket.instances[0]!;

    client.setAuth(async () => "invalid-token");
    await Promise.resolve();
    expect(ws.sent.map(message => JSON.parse(message)).at(-1)).toEqual({
      type: "Authenticate",
      tokenType: "User",
      value: "invalid-token",
      baseVersion: 0,
    });

    ws.receive({
      type: "AuthError",
      error: "Authentication failed.",
      baseVersion: 0,
      authUpdateAttempted: true,
    });
    client.clearAuth();

    expect(ws.sent.map(message => JSON.parse(message)).at(-1)).toEqual({
      type: "Authenticate",
      tokenType: "None",
      baseVersion: 0,
    });
  });

  it("applies existing bearer auth when a sync client is created later", async () => {
    FakeWebSocket.instances = [];
    const callback = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    client.setAuth(async () => "token-before-sync");
    await Promise.resolve();
    client.onUpdate(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { courseId: "english", userId: "user-1" },
      callback,
    );
    await Promise.resolve();

    const ws = FakeWebSocket.instances[0]!;
    expect(ws.sent.map(message => JSON.parse(message))).toEqual([
      {
        type: "Authenticate",
        tokenType: "User",
        value: "token-before-sync",
        baseVersion: 0,
      },
      {
        type: "ModifyQuerySet",
        baseVersion: 0,
        newVersion: 1,
        modifications: [
          {
            type: "Add",
            queryId: 0,
            udfPath: "lessons:list",
            args: [{ courseId: "english", userId: "user-1" }],
            partitionKey: "user-1",
          },
        ],
      },
    ]);
  });

  it("queues sync subscriptions until pending auth refresh resolves", async () => {
    FakeWebSocket.instances = [];
    const token = deferred<string>();
    const callback = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    client.setAuth(async () => token.promise);
    client.onUpdate(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { courseId: "english", userId: "user-1" },
      callback,
    );

    const ws = FakeWebSocket.instances[0]!;
    expect(ws.sent).toEqual([]);

    token.resolve("token-after-subscribe");
    await flushMicrotasks();

    expect(ws.sent.map(message => JSON.parse(message))).toEqual([
      {
        type: "Authenticate",
        tokenType: "User",
        value: "token-after-subscribe",
        baseVersion: 0,
      },
      {
        type: "ModifyQuerySet",
        baseVersion: 0,
        newVersion: 1,
        modifications: [
          {
            type: "Add",
            queryId: 0,
            udfPath: "lessons:list",
            args: [{ courseId: "english", userId: "user-1" }],
            partitionKey: "user-1",
          },
        ],
      },
    ]);
  });

  it("ignores stale sync auth refreshes that resolve after a newer token", async () => {
    FakeWebSocket.instances = [];
    const oldToken = deferred<string>();
    const newToken = deferred<string>();
    const callback = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    client.setAuth(async () => oldToken.promise);
    client.onUpdate(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { courseId: "english", userId: "user-1" },
      callback,
    );
    client.setAuth(async () => newToken.promise);

    const ws = FakeWebSocket.instances[0]!;
    newToken.resolve("new-token");
    await flushMicrotasks();
    oldToken.resolve("old-token");
    await flushMicrotasks();

    expect(ws.sent.map(message => JSON.parse(message))).toEqual([
      {
        type: "Authenticate",
        tokenType: "User",
        value: "new-token",
        baseVersion: 0,
      },
      {
        type: "ModifyQuerySet",
        baseVersion: 0,
        newVersion: 1,
        modifications: [
          {
            type: "Add",
            queryId: 0,
            udfPath: "lessons:list",
            args: [{ courseId: "english", userId: "user-1" }],
            partitionKey: "user-1",
          },
        ],
      },
    ]);
  });

  it("watches queries with Convex-style local result reads", () => {
    FakeWebSocket.instances = [];
    const callback = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    const watch = client.watchQuery(
      { _path: "lessons:list", _kind: "query" },
      { courseId: "english" },
      { partitionKey: "user-1" },
    );
    expect(watch.localQueryResult()).toBeUndefined();
    expect(FakeWebSocket.instances).toHaveLength(0);

    const unsubscribe = watch.onUpdate(callback);
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.sent.map(message => JSON.parse(message))).toEqual([
      expect.objectContaining({
        type: "ModifyQuerySet",
        modifications: [
          expect.objectContaining({
            type: "Add",
            queryId: 0,
            udfPath: "lessons:list",
            partitionKey: "user-1",
          }),
        ],
      }),
    ]);

    ws.receive({
      type: "Transition",
      startVersion: { querySet: 0, ts: 0, identity: 0 },
      endVersion: { querySet: 1, ts: 1, identity: 0 },
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 0,
          value: [{ title: "Intro" }],
          logLines: [],
          journal: null,
        },
      ],
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(watch.localQueryResult()).toEqual([{ title: "Intro" }]);

    unsubscribe();
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: "ModifyQuerySet",
      baseVersion: 1,
      newVersion: 2,
      modifications: [{ type: "Remove", queryId: 0 }],
    });
  });

  it("deduplicates identical live query subscriptions", () => {
    FakeWebSocket.instances = [];
    const first = vi.fn();
    const second = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    const firstUnsubscribe = client.onUpdate(
      { _path: "lessons:list", _kind: "query" },
      { courseId: "english" },
      first,
      { partitionKey: "user-1" },
    );
    const secondUnsubscribe = client.onUpdate(
      { _path: "lessons:list", _kind: "query" },
      { courseId: "english" },
      second,
      { partitionKey: "user-1" },
    );

    const ws = FakeWebSocket.instances[0]!;
    expect(ws.sent).toHaveLength(1);
    ws.receive({
      type: "Transition",
      startVersion: { querySet: 0, ts: 0, identity: 0 },
      endVersion: { querySet: 1, ts: 1, identity: 0 },
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 0,
          value: ["Intro"],
          logLines: [],
          journal: null,
        },
      ],
    });
    expect(first).toHaveBeenCalledWith(["Intro"]);
    expect(second).toHaveBeenCalledWith(["Intro"]);

    firstUnsubscribe();
    expect(ws.sent).toHaveLength(1);
    secondUnsubscribe();
    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({
      type: "ModifyQuerySet",
      modifications: [{ type: "Remove", queryId: 0 }],
    });
  });

  it("deduplicates identical watch subscriptions", () => {
    FakeWebSocket.instances = [];
    const first = vi.fn();
    const second = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    const firstWatch = client.watchQuery(
      { _path: "lessons:list", _kind: "query" },
      { courseId: "english" },
      { partitionKey: "user-1" },
    );
    const secondWatch = client.watchQuery(
      { _path: "lessons:list", _kind: "query" },
      { courseId: "english" },
      { partitionKey: "user-1" },
    );

    const firstUnsubscribe = firstWatch.onUpdate(first);
    const secondUnsubscribe = secondWatch.onUpdate(second);
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.sent).toHaveLength(1);

    ws.receive({
      type: "Transition",
      startVersion: { querySet: 0, ts: 0, identity: 0 },
      endVersion: { querySet: 1, ts: 1, identity: 0 },
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 0,
          value: ["Intro"],
          logLines: [],
          journal: null,
        },
      ],
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(firstWatch.localQueryResult()).toEqual(["Intro"]);
    expect(secondWatch.localQueryResult()).toEqual(["Intro"]);

    firstUnsubscribe();
    expect(ws.sent).toHaveLength(1);
    secondUnsubscribe();
    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({
      type: "ModifyQuerySet",
      modifications: [{ type: "Remove", queryId: 0 }],
    });
  });

  it("routes query failures to the live query error callback", async () => {
    FakeWebSocket.instances = [];
    const callback = vi.fn();
    const onError = vi.fn();
    const secondOnError = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    client.onUpdate(
      { _path: "lessons:list", _kind: "query" },
      {},
      callback,
      onError,
      { partitionKey: "user-1" },
    );
    FakeWebSocket.instances[0]!.receive({
      type: "Transition",
      startVersion: { querySet: 0, ts: 0, identity: 0 },
      endVersion: { querySet: 1, ts: 1, identity: 0 },
      modifications: [
        {
          type: "QueryFailed",
          queryId: 0,
          errorMessage: "boom",
          logLines: [],
          errorData: null,
          journal: null,
        },
      ],
    });

    expect(callback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0]![0].message).toBe("boom");

    expect(() =>
      client.onUpdate(
        { _path: "lessons:list", _kind: "query" },
        {},
        callback,
        secondOnError,
        { partitionKey: "user-1" },
      ),
    ).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(secondOnError).toHaveBeenCalledWith(expect.any(Error));
    expect(secondOnError.mock.calls[0]![0].message).toBe("boom");
  });

  it("executes mutations over sync by default", async () => {
    FakeWebSocket.instances = [];
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    const result = client.mutation(
      { _path: "lessons:complete", _kind: "mutation", _partition: userPartition },
      { userId: "user-1", lessonId: "intro" },
    );
    const ws = FakeWebSocket.instances[0]!;
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: "Mutation",
      requestId: 0,
      udfPath: "lessons:complete",
      args: [{ userId: "user-1", lessonId: "intro" }],
      partitionKey: "user-1",
    });

    ws.receive({
      type: "MutationResponse",
      requestId: 0,
      success: true,
      result: { completed: true },
      logLines: [],
    });

    await expect(result).resolves.toEqual({ completed: true });
  });

  it("rejects pending mutations and closes after a malformed server frame", async () => {
    FakeWebSocket.instances = [];
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    const result = client.mutation(
      { _path: "lessons:complete", _kind: "mutation", _partition: userPartition },
      { userId: "user-1", lessonId: "intro" },
    );
    const ws = FakeWebSocket.instances[0]!;

    ws.receive({
      type: "MutationResponse",
      requestId: 0,
      success: true,
    });

    await expect(result).rejects.toThrow(
      "Invalid sync server message payload for MutationResponse.",
    );
    expect(ws.readyState).toBe(3);
  });

  it("does not classify subscriber callback failures as malformed server frames", async () => {
    FakeWebSocket.instances = [];
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });
    const onError = vi.fn();
    client.onUpdate(
      { _path: "lessons:list", _kind: "query", _partition: userPartition },
      { userId: "user-1" },
      () => {
        throw new Error("subscriber boom");
      },
      onError,
    );
    const result = client.mutation(
      { _path: "lessons:complete", _kind: "mutation", _partition: userPartition },
      { userId: "user-1", lessonId: "intro" },
    );
    const ws = FakeWebSocket.instances[0]!;

    ws.receive({
      type: "Transition",
      startVersion: { querySet: 0, ts: 0, identity: 0 },
      endVersion: { querySet: 1, ts: 1, identity: 0 },
      modifications: [{
        type: "QueryUpdated",
        queryId: 0,
        value: [],
        logLines: [],
        journal: null,
      }],
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "subscriber boom",
    }));
    expect(ws.readyState).toBe(1);

    ws.receive({
      type: "MutationResponse",
      requestId: 0,
      success: true,
      result: { completed: true },
      logLines: [],
    });
    await expect(result).resolves.toEqual({ completed: true });
  });
});
