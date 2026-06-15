import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { createFlarexDevRuntime, type FlarexDevRuntime } from "./dev.ts";
import { generateFlarex, type FlarexGenerateOptions } from "./generate.ts";

export type FlarexPluginOptions = Omit<FlarexGenerateOptions, "root"> & {
      dev?:
    | false
    | {
        deploymentId?: string;
        persistDir?: string | false;
      };
};

export function flarex(options: FlarexPluginOptions = {}): Plugin {
  let root = process.cwd();
  let devRuntime: FlarexDevRuntime | undefined;
  let reloadTimer: NodeJS.Timeout | undefined;
  return {
    name: "flarex",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      await generateFlarex({ ...options, root });
    },
    async configureServer(server) {
      await generateFlarex({ ...options, root });
      if (options.dev !== false) {
        const devOptions = typeof options.dev === "object" ? options.dev : {};
        devRuntime = await createFlarexDevRuntime({
          root,
          ...(options.appDir === undefined ? {} : { appDir: options.appDir }),
          ...(options.generatedDir === undefined ? {} : { generatedDir: options.generatedDir }),
          ...(devOptions.deploymentId === undefined ? {} : { deploymentId: devOptions.deploymentId }),
          ...(devOptions.persistDir === undefined ? {} : { persistDir: devOptions.persistDir }),
        });
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith("/__flarex_dev")) {
            next();
            return;
          }
          try {
            await writeNodeResponse(
              response,
              await devRuntime!.fetch(await nodeRequestToRequest(request)),
            );
          } catch (error) {
            response.statusCode = 500;
            response.setHeader("content-type", "application/json");
            response.end(
              JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            );
          }
        });
      }
      server.watcher.add(`${root}/${options.appDir ?? "flarex"}/**/*.ts`);
      server.watcher.on("change", async file => {
        if (file.includes(`${options.appDir ?? "flarex"}`)) {
          if (devRuntime) {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
              devRuntime?.reload().catch(error => {
                server.config.logger.error(
                  error instanceof Error ? error.stack ?? error.message : String(error),
                );
              });
            }, 500);
          } else {
            await generateFlarex({ ...options, root });
          }
        }
      });
      server.httpServer?.once("close", () => {
        if (reloadTimer) clearTimeout(reloadTimer);
        devRuntime?.dispose().catch(error => {
          server.config.logger.error(
            error instanceof Error ? error.stack ?? error.message : String(error),
          );
        });
      });
    },
  };
}

async function nodeRequestToRequest(request: IncomingMessage): Promise<Request> {
  const host = request.headers.host ?? "localhost";
  const url = `http://${host}${request.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const body = await readNodeBody(request);
  const init: RequestInit = { headers };
  if (request.method !== undefined) init.method = request.method;
  if (body.byteLength > 0 && request.method !== "GET" && request.method !== "HEAD") {
    init.body = new Uint8Array(body).buffer as ArrayBuffer;
  }
  return new Request(url, init);
}

async function readNodeBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function writeNodeResponse(response: ServerResponse, value: Response): Promise<void> {
  response.statusCode = value.status;
  value.headers.forEach((headerValue, headerName) => {
    response.setHeader(headerName, headerValue);
  });
  response.end(Buffer.from(await value.arrayBuffer()));
}
