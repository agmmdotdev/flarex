import { logger } from "@medusajs/framework/logger"
import { MedusaContainer } from "@medusajs/framework/types"
import { GracefulShutdownServer, promiseAll } from "@medusajs/framework/utils"
import express from "express"
import getPort from "get-port"
import type { Server } from "http"
import { resolve } from "path"
import { startCloudflareWorkerProcess } from "./cloudflare-worker-process"
import {
  applyEnvVarsToProcess,
  execOrTimeout,
  type TestProcessEnv,
} from "./utils"

export type TestHttpRuntime = "express" | "cloudflare"

export function resolveTestHttpRuntime(
  value = process.env.MEDUSA_TEST_HTTP_RUNTIME
): TestHttpRuntime {
  if (!value || value === "express") {
    return "express"
  }

  if (value === "cloudflare") {
    return "cloudflare"
  }

  throw new Error(
    `Unsupported MEDUSA_TEST_HTTP_RUNTIME value "${value}". Expected "express" or "cloudflare".`
  )
}

async function bootstrapApp({
  cwd,
  env = {},
}: { cwd?: string; env?: TestProcessEnv } = {}) {
  const app = express()
  applyEnvVarsToProcess(env)

  // Register a health check endpoint
  app.get("/health", (_, res) => {
    res.status(200).send("OK")
  })

  const loaders = require("@medusajs/medusa/loaders/index").default

  try {
    const { container, shutdown } = await loaders({
      directory: resolve(cwd || process.cwd()),
      expressApp: app,
    })

    const PORT = process.env.PORT ? parseInt(process.env.PORT) : await getPort()

    return {
      shutdown,
      container,
      app,
      port: PORT,
    }
  } catch (error) {
    logger.error("Error bootstrapping app:", error)
    throw error
  }
}

export async function startApp({
  cwd,
  env = {},
  runtime = resolveTestHttpRuntime(),
  container: appContainerOverride,
}: {
  cwd?: string
  env?: TestProcessEnv
  runtime?: TestHttpRuntime
  container?: MedusaContainer
} = {}): Promise<{
  shutdown: () => Promise<void>
  container: MedusaContainer
  port: number
}> {
  if (runtime === "cloudflare") {
    return await startCloudflareApp({
      cwd,
      env,
      container: appContainerOverride,
    })
  }

  let expressServer: (Server & GracefulShutdownServer) | undefined
  let medusaShutdown: () => Promise<void> = async () => void 0
  let container: MedusaContainer

  try {
    const {
      app,
      port,
      container: appContainer,
      shutdown: appShutdown,
    } = await bootstrapApp({
      cwd,
      env,
    })

    container = appContainer
    medusaShutdown = appShutdown

    const shutdown = async () => {
      try {
        const shutdownPromise = promiseAll([
          expressServer?.shutdown(),
          medusaShutdown(),
        ])

        await execOrTimeout(shutdownPromise)

        if (typeof global !== "undefined" && global?.gc) {
          global.gc()
        }
      } catch (error) {
        logger.error("Error during shutdown:", error)
        try {
          await expressServer?.shutdown()
          await medusaShutdown()
        } catch (cleanupError) {
          logger.error("Error during forced cleanup:", cleanupError)
        }
        throw error
      }
    }

    return await new Promise((resolve, reject) => {
      const server = app
        .listen(port)
        .on("error", async (err) => {
          logger.error("Error starting server:", err)
          await shutdown()
          return reject(err)
        })
        .on("listening", () => {
          process.send?.(port)

          resolve({
            shutdown,
            container,
            port,
          })
        })

      expressServer = GracefulShutdownServer.create(server)
    })
  } catch (error) {
    logger.error("Error in startApp:", error)
    if (expressServer) {
      try {
        await expressServer.shutdown()
      } catch (cleanupError) {
        logger.error("Error cleaning up express server:", cleanupError)
      }
    }
    if (medusaShutdown) {
      try {
        await medusaShutdown()
      } catch (cleanupError) {
        logger.error("Error cleaning up medusa:", cleanupError)
      }
    }
    throw error
  }
}

async function startCloudflareApp({
  cwd,
  env = {},
  container,
}: {
  cwd?: string
  env?: TestProcessEnv
  container?: MedusaContainer
} = {}): Promise<{
  shutdown: () => Promise<void>
  container: MedusaContainer
  port: number
}> {
  const bootstrapped = container
    ? {
        container,
        shutdown: async () => void 0,
      }
    : await bootstrapApp({ cwd, env })
  const medusaShutdown = bootstrapped.shutdown
  const port = process.env.PORT ? parseInt(process.env.PORT) : await getPort()
  const workerProcess = startCloudflareWorkerProcess({
    cwd: cwd ?? process.cwd(),
    port,
    env,
  })

  try {
    await workerProcess.waitForHealth()

    return {
      container: bootstrapped.container,
      port,
      shutdown: async () => {
        workerProcess.shutdown()
        await medusaShutdown()
      },
    }
  } catch (error) {
    workerProcess.shutdown()
    await medusaShutdown()
    throw error
  }
}
