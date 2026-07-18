import type { FlarexHttpAppConfig } from "./config";
import type { ElysiaSet } from "./errors";
import {
  handleInvokeAbort,
  handleInvokeAbortStale,
  handleInvokeFinish,
  handleInvokePrepare,
  handleInvokeStart,
  handleInvokeSyscall,
} from "./routeEffects";
import {
  normalizeExecutorHttpRoutePath as normalizeRoutePath,
} from "./routePath";

export type FlarexExecutorFetchConfig = Pick<
  FlarexHttpAppConfig,
  | "executor"
  | "capabilityToken"
  | "healthPath"
  | "invokePreparePath"
  | "invokeStartPath"
  | "invokeSyscallPath"
  | "invokeFinishPath"
  | "invokeAbortPath"
  | "invokeAbortStalePath"
>;

export type FlarexExecutorFetchHandler = (
  request: Request,
) => Promise<Response>;

interface InvokeRoute {
  readonly path: string;
  readonly handle: (
    request: Request,
    set: ElysiaSet,
  ) => Promise<object>;
}

/**
 * Creates the code-generation-free Fetch boundary used by the private
 * executor Worker. The Elysia adapter remains available for compatibility
 * hosts, but it is deliberately absent from this module's import graph.
 */
export function createFlarexExecutorFetchHandler(
  config: FlarexExecutorFetchConfig,
): FlarexExecutorFetchHandler {
  const executor = config.executor;
  const capabilityToken = config.capabilityToken;
  const healthPath = normalizeRoutePath(config.healthPath ?? "/health");
  const invokeRoutes = [
    {
      path: normalizeRoutePath(config.invokePreparePath ?? "/invoke/prepare"),
      handle: (request, set) =>
        handleInvokePrepare(executor, request, set, capabilityToken),
    },
    {
      path: normalizeRoutePath(config.invokeStartPath ?? "/invoke/start"),
      handle: (request, set) =>
        handleInvokeStart(executor, request, set, capabilityToken),
    },
    {
      path: normalizeRoutePath(config.invokeSyscallPath ?? "/invoke/syscall"),
      handle: (request, set) =>
        handleInvokeSyscall(executor, request, set, capabilityToken),
    },
    {
      path: normalizeRoutePath(config.invokeFinishPath ?? "/invoke/finish"),
      handle: (request, set) =>
        handleInvokeFinish(executor, request, set, capabilityToken),
    },
    {
      path: normalizeRoutePath(config.invokeAbortPath ?? "/invoke/abort"),
      handle: (request, set) =>
        handleInvokeAbort(executor, request, set, capabilityToken),
    },
    {
      path: normalizeRoutePath(config.invokeAbortStalePath ?? "/invoke/abort-stale"),
      handle: (request, set) =>
        handleInvokeAbortStale(executor, request, set, capabilityToken),
    },
  ] satisfies readonly InvokeRoute[];

  return async (request) => {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === healthPath) {
      return Response.json(await executor.health());
    }

    const invokeRoute = invokeRoutes.find((route) => route.path === pathname);
    if (invokeRoute !== undefined) {
      if (request.method !== "POST") {
        return Response.json(
          {
            error: "method_not_allowed",
            message: `${invokeRoute.path} only supports POST`,
          },
          { status: 405 },
        );
      }
      const set: ElysiaSet = {};
      const body = await invokeRoute.handle(request, set);
      return Response.json(body, { status: numericStatus(set.status) });
    }

    return Response.json(
      {
        error: "not_found",
        message: `No Flarex executor adapter route for ${request.method} ${pathname}`,
      },
      { status: 404 },
    );
  };
}

function numericStatus(status: ElysiaSet["status"]): number {
  return typeof status === "number" ? status : 200;
}
