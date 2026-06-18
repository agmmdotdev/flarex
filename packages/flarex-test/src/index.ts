import { createFlarexDevRuntime, type FlarexDevRuntime } from "flarex-dev";
import {
  FlarexClient,
  getFunctionName,
  type AnyFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type WebSocketConstructor,
  type WebSocketLike,
} from "flarex";

export type FlarexTestOptions = {
  root?: string;
  appDir?: string;
  generatedDir?: string;
  deploymentId?: string;
  persistDir?: string | false;
};

export type FlarexTestInvokeOptions = {
  partitionKey: string;
  idempotencyKey?: string;
};

export type FlarexTestRawResult<Reference extends AnyFunctionReference> = {
  value?: FunctionReturnType<Reference>;
  readSet?: unknown;
  committedTs?: number;
  writes?: unknown[];
};

export type FlarexTest = {
  query<Reference extends FunctionReference<"query">>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: FlarexTestInvokeOptions,
  ): Promise<FunctionReturnType<Reference>>;
  mutation<Reference extends FunctionReference<"mutation">>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: FlarexTestInvokeOptions,
  ): Promise<FunctionReturnType<Reference>>;
  action<Reference extends FunctionReference<"action">>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: FlarexTestInvokeOptions,
  ): Promise<FunctionReturnType<Reference>>;
  invokeRaw<Reference extends AnyFunctionReference>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: FlarexTestInvokeOptions,
  ): Promise<FlarexTestRawResult<Reference>>;
  client(): FlarexClient;
  webSocketConstructor: WebSocketConstructor;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  reload(): Promise<void>;
  dispose(): Promise<void>;
};

export class FlarexTestInvocationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "FlarexTestInvocationError";
  }
}

export async function flarexTest(options: FlarexTestOptions = {}): Promise<FlarexTest> {
  const runtime = await createFlarexDevRuntime({
    root: options.root ?? process.cwd(),
    ...(options.appDir === undefined ? {} : { appDir: options.appDir }),
    ...(options.generatedDir === undefined ? {} : { generatedDir: options.generatedDir }),
    ...(options.deploymentId === undefined ? {} : { deploymentId: options.deploymentId }),
    persistDir: options.persistDir ?? false,
  });

  return createTestClient(runtime);
}

function createTestClient(runtime: FlarexDevRuntime): FlarexTest {
  const webSocketConstructor = createRuntimeWebSocketConstructor(runtime);

  async function invokeRaw<Reference extends AnyFunctionReference>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: FlarexTestInvokeOptions,
  ): Promise<FlarexTestRawResult<Reference>> {
    const body = {
      path: getFunctionName(reference),
      args,
      partitionKey: options.partitionKey,
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    };
    const response = await runtime.fetch(
      new Request("http://flarex.test/__flarex_dev/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof result === "object" && result !== null && "error" in result
          ? String((result as { error: unknown }).error)
          : `Flarex test invocation failed with status ${response.status}`;
      throw new FlarexTestInvocationError(message, response.status, result);
    }
    return result as FlarexTestRawResult<Reference>;
  }

  return {
    query: async (reference, args, options) =>
      (await invokeRaw(reference, args, options)).value as FunctionReturnType<typeof reference>,
    mutation: async (reference, args, options) =>
      (await invokeRaw(reference, args, options)).value as FunctionReturnType<typeof reference>,
    action: async (reference, args, options) =>
      (await invokeRaw(reference, args, options)).value as FunctionReturnType<typeof reference>,
    invokeRaw,
    client: () =>
      new FlarexClient("http://flarex.test/__flarex_dev", {
        webSocketConstructor,
      }),
    webSocketConstructor,
    fetch: (path, init) => runtime.fetch(requestForPath(path, init)),
    reload: runtime.reload,
    dispose: runtime.dispose,
  };
}

type MiniflareWebSocket = {
  accept(): void;
  send(message: string): void;
  close(): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
    options?: { once?: boolean },
  ): void;
  addEventListener(
    type: "error" | "close",
    listener: (event: unknown) => void,
    options?: { once?: boolean },
  ): void;
};

type WebSocketResponse = Response & {
  webSocket?: MiniflareWebSocket;
};

function createRuntimeWebSocketConstructor(runtime: FlarexDevRuntime): WebSocketConstructor {
  return class RuntimeWebSocket implements WebSocketLike {
    readonly listeners = new Map<string, Array<{ once: boolean; listener: (event: any) => void }>>();
    readyState = 0;
    private socket: MiniflareWebSocket | undefined;
    private closed = false;

    constructor(url: string) {
      void this.connect(url);
    }

    addEventListener(type: string, listener: (event: any) => void, options?: { once?: boolean }): void {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push({ listener, once: options?.once === true });
      this.listeners.set(type, listeners);
    }

    send(message: string): void {
      if (this.socket === undefined || this.readyState !== 1) {
        throw new Error("Flarex test WebSocket is not open.");
      }
      this.socket.send(message);
    }

    close(): void {
      this.closed = true;
      this.readyState = 3;
      this.socket?.close();
      this.emit("close", {});
    }

    private async connect(url: string): Promise<void> {
      try {
        const requestUrl = new URL(url);
        if (requestUrl.protocol === "ws:") {
          requestUrl.protocol = "http:";
        } else if (requestUrl.protocol === "wss:") {
          requestUrl.protocol = "https:";
        }
        const response = await runtime.fetch(new Request(requestUrl, {
          headers: { Upgrade: "websocket" },
        })) as WebSocketResponse;
        if (response.status !== 101 || response.webSocket === undefined) {
          throw new Error(`Expected WebSocket upgrade, got status ${response.status}.`);
        }
        if (this.closed) {
          response.webSocket.close();
          return;
        }
        this.socket = response.webSocket;
        this.socket.accept();
        this.socket.addEventListener("message", event => this.emit("message", event));
        this.socket.addEventListener("error", event => this.emit("error", event));
        this.socket.addEventListener("close", event => {
          this.readyState = 3;
          this.emit("close", event);
        });
        this.readyState = 1;
        this.emit("open", {});
      } catch (error) {
        this.readyState = 3;
        this.emit("error", error);
        this.emit("close", error);
      }
    }

    private emit(type: string, event: any): void {
      const listeners = this.listeners.get(type) ?? [];
      this.listeners.set(type, listeners.filter(entry => !entry.once));
      for (const { listener } of listeners) listener(event);
    }
  };
}

function requestForPath(path: string, init?: RequestInit): Request {
  const url = new URL(path, "http://flarex.test");
  if (!url.pathname.startsWith("/__flarex_dev")) {
    url.pathname = `/__flarex_dev${url.pathname}`;
  }
  return new Request(url, init);
}
