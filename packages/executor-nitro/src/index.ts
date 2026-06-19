import type { FlarexExecutor } from "@flarex/executor";

export interface FlarexNitroEventLike {
  request: Request;
}

export interface FlarexNitroAdapterConfig {
  executor: FlarexExecutor;
  healthPath?: string;
}

export function createFlarexNitroHandler(
  config: FlarexNitroAdapterConfig,
): (event: FlarexNitroEventLike) => Promise<Response> {
  const executor = config.executor;
  const healthPath = normalizePath(config.healthPath ?? "/health");

  return async (event) => {
    const url = new URL(event.request.url);

    if (
      event.request.method === "GET" &&
      normalizePath(url.pathname) === healthPath
    ) {
      return jsonResponse(await executor.health());
    }

    return jsonResponse(
      {
        error: "not_found",
        message: `No Flarex executor adapter route for ${event.request.method} ${url.pathname}`,
      },
      { status: 404 },
    );
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function normalizePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}
