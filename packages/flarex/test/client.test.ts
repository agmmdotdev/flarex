import { describe, expect, it, vi } from "vitest";
import { FlarexClient } from "../src/client";

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
        { partitionKey: "user-1" },
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

  it("subscribes to live queries with Convex-style query-set messages", () => {
    FakeWebSocket.instances = [];
    const callback = vi.fn();
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    const unsubscribe = client.onUpdate(
      { _path: "lessons:list", _kind: "query" },
      { courseId: "english" },
      callback,
      { partitionKey: "user-1" },
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
            args: [{ courseId: "english" }],
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

  it("routes query failures to the live query error callback", () => {
    FakeWebSocket.instances = [];
    const callback = vi.fn();
    const onError = vi.fn();
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
  });

  it("can execute mutations over sync when requested", async () => {
    FakeWebSocket.instances = [];
    const client = new FlarexClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    const result = client.mutation(
      { _path: "lessons:complete", _kind: "mutation" },
      { lessonId: "intro" },
      { partitionKey: "user-1", transport: "sync" },
    );
    const ws = FakeWebSocket.instances[0]!;
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: "Mutation",
      requestId: 0,
      udfPath: "lessons:complete",
      args: [{ lessonId: "intro" }],
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
