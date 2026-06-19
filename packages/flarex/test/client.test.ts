import { describe, expect, it, vi } from "vitest";
import { FlarexClient } from "../src/client";

const userPartition = {
  type: "partition" as const,
  table: "users",
  selector: "byId",
  partitionField: "_id",
  argField: "userId",
};

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

  it("does not infer invoke partitions from route-only metadata", async () => {
    const client = new FlarexClient("https://example.test", {
      fetch: async () => Response.json({ value: null }),
    });

    expect(() =>
      client.query(
        { _path: "lessons:list", _kind: "query", _route: { type: "args", field: "userId" } },
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
});
