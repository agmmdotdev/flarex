export interface Clock {
  now(): Date;
}

export interface FlarexExecutorConfig {
  clock?: Clock;
  healthPath?: string;
}

export interface FlarexExecutor {
  fetch(request: Request): Promise<Response>;
  health(): FlarexHealth;
}

export interface FlarexHealth {
  service: "flarex-executor";
  status: "ok";
  time: string;
}

const defaultClock: Clock = {
  now: () => new Date(),
};

export function createFlarexExecutor(
  config: FlarexExecutorConfig = {},
): FlarexExecutor {
  const clock = config.clock ?? defaultClock;
  const healthPath = normalizePath(config.healthPath ?? "/health");

  return {
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "GET" && normalizePath(url.pathname) === healthPath) {
        return jsonResponse(this.health());
      }

      return jsonResponse(
        {
          error: "not_found",
          message: `No Flarex executor route for ${request.method} ${url.pathname}`,
        },
        { status: 404 },
      );
    },

    health() {
      return {
        service: "flarex-executor",
        status: "ok",
        time: clock.now().toISOString(),
      };
    },
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
