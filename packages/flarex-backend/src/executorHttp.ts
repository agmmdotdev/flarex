export interface ExecutorHttpEnv {
  readonly FLAREX_EXECUTOR?: {
    fetch(request: Request): Promise<Response>;
  };
  readonly FLAREX_EXECUTOR_URL?: string;
  readonly FLAREX_EXECUTOR_TOKEN?: string;
}

export async function fetchExecutorJson(
  env: ExecutorHttpEnv,
  path: string,
  body: unknown,
): Promise<Response> {
  const url = executorUrl(env.FLAREX_EXECUTOR_URL, path);
  const headers = new Headers({ "content-type": "application/json" });
  if (env.FLAREX_EXECUTOR_TOKEN !== undefined) {
    headers.set("authorization", `Bearer ${env.FLAREX_EXECUTOR_TOKEN}`);
  }
  const request = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return fetchExecutorRequest(env, request);
}

export function fetchExecutorRequest(
  env: ExecutorHttpEnv,
  request: Request,
): Promise<Response> {
  return env.FLAREX_EXECUTOR === undefined
    ? fetch(request)
    : env.FLAREX_EXECUTOR.fetch(request);
}

export function executorRequestUrl(
  baseUrl: string | undefined,
  path: string,
): string {
  return executorUrl(baseUrl, path);
}

function executorUrl(baseUrl: string | undefined, path: string): string {
  const url = new URL(baseUrl ?? "https://flarex-executor.internal");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return url.href;
}
