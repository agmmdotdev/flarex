import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import {
  FlarexProvider,
  FlarexReactClient,
  type ReactMutation,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQuery_experimental,
} from "../src/react";
import type { FunctionReference } from "../src/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const listLessons = {
  _path: "lessons:list",
  _kind: "query",
} as FunctionReference<"query", "public", { courseId: string }, Array<{ title: string }>>;

const completeLesson = {
  _path: "lessons:complete",
  _kind: "mutation",
} as FunctionReference<"mutation", "public", { lessonId: string }, { completed: boolean }>;

describe("flarex/react", () => {
  it("subscribes to queries through FlarexProvider", async () => {
    FakeWebSocket.instances = [];
    let rendered: Array<{ title: string }> | undefined;
    let root: ReactTestRenderer | undefined;
    const client = new FlarexReactClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    function Lessons(): null {
      rendered = useQuery(
        listLessons,
        { courseId: "english" },
        { partitionKey: "user-1" },
      );
      return null;
    }

    await act(async () => {
      root = create(
        React.createElement(
          FlarexProvider,
          { client },
          React.createElement(Lessons),
        ),
      );
    });

    const ws = FakeWebSocket.instances[0]!;
    expect(rendered).toBeUndefined();
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({
      type: "ModifyQuerySet",
      modifications: [
        {
          type: "Add",
          udfPath: "lessons:list",
          partitionKey: "user-1",
        },
      ],
    });

    await act(async () => {
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
    });

    expect(rendered).toEqual([{ title: "Intro" }]);

    await act(async () => {
      root!.unmount();
    });
    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({
      type: "ModifyQuerySet",
      modifications: [{ type: "Remove", queryId: 0 }],
    });
  });

  it("executes mutations through FlarexProvider", async () => {
    FakeWebSocket.instances = [];
    let complete: ReactMutation<typeof completeLesson> | undefined;
    const client = new FlarexReactClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    function CompleteButton(): null {
      complete = useMutation(completeLesson);
      return null;
    }

    await act(async () => {
      create(
        React.createElement(
          FlarexProvider,
          { client },
          React.createElement(CompleteButton),
        ),
      );
    });

    const result = complete!({ lessonId: "intro" }, { partitionKey: "user-1" });
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

  it("returns object query states from useQuery_experimental", async () => {
    FakeWebSocket.instances = [];
    let rendered: UseQueryResult<Array<{ title: string }>> | undefined;
    const client = new FlarexReactClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    function Lessons(): null {
      rendered = useQuery_experimental({
        query: listLessons,
        args: { courseId: "english" },
        partitionKey: "user-1",
      });
      return null;
    }

    await act(async () => {
      create(
        React.createElement(
          FlarexProvider,
          { client },
          React.createElement(Lessons),
        ),
      );
    });

    expect(rendered).toEqual({ status: "pending" });
    const ws = FakeWebSocket.instances[0]!;

    await act(async () => {
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
    });

    expect(rendered).toEqual({
      status: "success",
      data: [{ title: "Intro" }],
    });
  });

  it("returns query errors from useQuery_experimental by default", async () => {
    FakeWebSocket.instances = [];
    let rendered: UseQueryResult<Array<{ title: string }>> | undefined;
    const client = new FlarexReactClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    function Lessons(): null {
      rendered = useQuery_experimental({
        query: listLessons,
        args: { courseId: "english" },
        partitionKey: "user-1",
      });
      return null;
    }

    await act(async () => {
      create(
        React.createElement(
          FlarexProvider,
          { client },
          React.createElement(Lessons),
        ),
      );
    });

    await act(async () => {
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
    });

    expect(rendered?.status).toBe("error");
    expect(rendered).toMatchObject({
      status: "error",
      error: expect.any(Error),
    });
  });

  it("throws query errors from useQuery_experimental when requested", async () => {
    FakeWebSocket.instances = [];
    let rendered: UseQueryResult<Array<{ title: string }>, true> | undefined;
    const client = new FlarexReactClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    function Lessons(): null {
      rendered = useQuery_experimental({
        query: listLessons,
        args: { courseId: "english" },
        partitionKey: "user-1",
        throwOnError: true,
      });
      return null;
    }

    await act(async () => {
      create(
        React.createElement(
          FlarexProvider,
          { client },
          React.createElement(Lessons),
        ),
      );
    });
    expect(rendered).toEqual({ status: "pending" });

    await expect(
      act(async () => {
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
      }),
    ).rejects.toThrow("boom");
  });

  it("rejects direct React event objects passed to mutations", async () => {
    FakeWebSocket.instances = [];
    let complete: ReactMutation<typeof completeLesson> | undefined;
    const client = new FlarexReactClient("https://example.test/deployments/app", {
      webSocketConstructor: FakeWebSocket,
    });

    function CompleteButton(): null {
      complete = useMutation(completeLesson);
      return null;
    }

    await act(async () => {
      create(
        React.createElement(
          FlarexProvider,
          { client },
          React.createElement(CompleteButton),
        ),
      );
    });

    expect(() =>
      complete!(
        {
          bubbles: true,
          persist: () => undefined,
          isDefaultPrevented: () => false,
        } as never,
        { partitionKey: "user-1" },
      ),
    ).toThrow("React event object");
  });
});
