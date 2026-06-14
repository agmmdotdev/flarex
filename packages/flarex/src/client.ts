import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "./api";

export type FlarexClientOptions = {
  fetch?: typeof globalThis.fetch;
};

export type InvokeOptions = {
  partitionKey: string;
};

export class FlarexInvocationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FlarexInvocationError";
  }
}

export class FlarexClient {
  private readonly fetch: typeof globalThis.fetch;

  constructor(
    private readonly deploymentUrl: string,
    options: FlarexClientOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  query<Reference extends FunctionReference<"query">>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: InvokeOptions,
  ): Promise<FunctionReturnType<Reference>> {
    return this.invoke(reference, args, options) as Promise<FunctionReturnType<Reference>>;
  }

  mutation<Reference extends FunctionReference<"mutation">>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: InvokeOptions,
  ): Promise<FunctionReturnType<Reference>> {
    return this.invoke(reference, args, options) as Promise<FunctionReturnType<Reference>>;
  }

  private async invoke(
    reference: FunctionReference,
    args: unknown,
    options: InvokeOptions,
  ): Promise<unknown> {
    const response = await this.fetch(new URL("/invoke", this.deploymentUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: getFunctionName(reference),
        args,
        partitionKey: options.partitionKey,
      }),
    });
    const result = (await response.json()) as { value?: unknown; error?: string };
    if (!response.ok) {
      throw new FlarexInvocationError(result.error ?? "Flarex invocation failed", response.status);
    }
    return result.value;
  }
}
