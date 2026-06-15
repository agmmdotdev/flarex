import { createFlarexDevRuntime, type FlarexDevRuntime } from "flarex-dev";
import {
  getFunctionName,
  type AnyFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
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
    fetch: (path, init) => runtime.fetch(requestForPath(path, init)),
    reload: runtime.reload,
    dispose: runtime.dispose,
  };
}

function requestForPath(path: string, init?: RequestInit): Request {
  const url = new URL(path, "http://flarex.test");
  if (!url.pathname.startsWith("/__flarex_dev")) {
    url.pathname = `/__flarex_dev${url.pathname}`;
  }
  return new Request(url, init);
}
