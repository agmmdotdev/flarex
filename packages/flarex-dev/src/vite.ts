import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import type { FlarexDevRuntime } from "./dev.ts";
import { generateFlarex, type FlarexGenerateOptions } from "./generate.ts";
import {
  generatedOutputTypecheckOptions,
  typecheckGeneratedOutput,
  type FlarexGeneratedOutputTypecheckOption,
} from "./generatedTypecheck.ts";

export type FlarexPluginOptions = Omit<FlarexGenerateOptions, "root"> & {
  dev?:
    | false
    | {
        deploymentId?: string;
        persistDir?: string | false;
      };
  typecheckGeneratedOutput?: FlarexGeneratedOutputTypecheckOption;
};

export function flarex(options: FlarexPluginOptions = {}): Plugin {
  let root = process.cwd();
  let command: ResolvedConfig["command"] = "build";
  let devRuntime: FlarexDevRuntime | undefined;
  let reloadTimer: NodeJS.Timeout | undefined;
  let pluginCodegenRan = false;
  return {
    name: "flarex",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
      command = config.command;
    },
    async buildStart() {
      if (command === "serve" && options.dev !== false) return;
      if (command === "serve" && pluginCodegenRan) return;
      await generateAndMaybeTypecheck(options, root);
      pluginCodegenRan = true;
    },
    async configureServer(server) {
      if (options.dev !== false) {
        const { createFlarexDevRuntime } = await import("./dev.ts");
        const devOptions = typeof options.dev === "object" ? options.dev : {};
        devRuntime = await createFlarexDevRuntime({
          root,
          ...(options.appDir === undefined ? {} : { appDir: options.appDir }),
          ...(options.generatedDir === undefined ? {} : { generatedDir: options.generatedDir }),
          ...(devOptions.deploymentId === undefined ? {} : { deploymentId: devOptions.deploymentId }),
          ...(devOptions.persistDir === undefined ? {} : { persistDir: devOptions.persistDir }),
          ...(options.typecheckGeneratedOutput === undefined
            ? {}
            : { typecheckGeneratedOutput: options.typecheckGeneratedOutput }),
        });
      } else if (!pluginCodegenRan) {
        await generateAndMaybeTypecheck(options, root);
        pluginCodegenRan = true;
      }
      if (options.dev !== false) {
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
      const appDir = path.resolve(root, options.appDir ?? "flarex");
      const generatedDir = path.resolve(appDir, options.generatedDir ?? "_generated");
      server.watcher.add(`${appDir}/**/*.ts`);
      server.watcher.on("change", async file => {
        const changedPath = path.resolve(file);
        if (isWithinPath(appDir, changedPath) && !isWithinPath(generatedDir, changedPath)) {
          if (devRuntime) {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
              devRuntime?.reload().catch(error => {
                logViteError(server.config.logger, error);
              });
            }, 500);
          } else {
            try {
              await generateAndMaybeTypecheck(options, root);
            } catch (error) {
              logViteError(server.config.logger, error);
            }
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

function isWithinPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function generateAndMaybeTypecheck(
  options: FlarexPluginOptions,
  root: string,
): Promise<void> {
  await generateFlarex({
    root,
    ...(options.appDir === undefined ? {} : { appDir: options.appDir }),
    ...(options.generatedDir === undefined ? {} : { generatedDir: options.generatedDir }),
  });
  const typecheckOptions = generatedOutputTypecheckOptions({
    root,
    ...(options.appDir === undefined ? {} : { appDir: options.appDir }),
    ...(options.generatedDir === undefined ? {} : { generatedDir: options.generatedDir }),
    ...(options.typecheckGeneratedOutput === undefined
      ? {}
      : { typecheckGeneratedOutput: options.typecheckGeneratedOutput }),
  });
  if (typecheckOptions === undefined) return;
  await typecheckGeneratedOutput(typecheckOptions);
}

function logViteError(
  logger: { error(message: string): void },
  error: unknown,
): void {
  logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
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
    init.body = copyBytesToArrayBuffer(body);
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
