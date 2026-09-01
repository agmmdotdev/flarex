import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "child_process"
import { existsSync } from "fs"
import { dirname, join, resolve } from "path"
import type { TestProcessEnv } from "./utils"

const DEFAULT_CLOUDFLARE_HEALTH_TIMEOUT_MS = 240000
const CLOUDFLARE_HEALTH_POLL_INTERVAL_MS = 500
const CLOUDFLARE_OUTPUT_LIMIT = 40
const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

export type CloudflareWorkerProcess = {
  shutdown: () => void
  waitForHealth: () => Promise<void>
}

export function startCloudflareWorkerProcess({
  cwd,
  port,
  env = {},
}: {
  cwd: string
  port: number
  env?: TestProcessEnv
}): CloudflareWorkerProcess {
  const workspaceRoot = findCloudflareWorkerWorkspaceRoot(cwd)
  const output: string[] = []
  const server = spawn(
    PNPM_COMMAND,
    [
      "--filter",
      "medusa-cloudflare",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ...env,
        CI: "true",
        WRANGLER_SEND_METRICS: "false",
      },
    }
  )

  collectProcessOutput(server, output)

  return {
    shutdown: () => stopProcessTree(server.pid),
    waitForHealth: async () => {
      await waitForCloudflareHealth(port, server, output)
    },
  }
}

export function resolveCloudflareHealthTimeout(
  value = process.env.MEDUSA_TEST_CLOUDFLARE_HEALTH_TIMEOUT_MS
): number {
  if (!value) {
    return DEFAULT_CLOUDFLARE_HEALTH_TIMEOUT_MS
  }

  const timeout = Number.parseInt(value, 10)

  if (Number.isFinite(timeout) && timeout > 0) {
    return timeout
  }

  return DEFAULT_CLOUDFLARE_HEALTH_TIMEOUT_MS
}

export function findCloudflareWorkerWorkspaceRoot(start: string): string {
  let current = resolve(start)

  while (current !== dirname(current)) {
    const workspaceManifestPath = join(current, "pnpm-workspace.yaml")
    if (existsSync(workspaceManifestPath)) {
      return current
    }

    current = dirname(current)
  }

  throw new Error(
    `Unable to find workspace root from ${start}; expected pnpm-workspace.yaml`
  )
}

function collectProcessOutput(
  server: ChildProcessWithoutNullStreams,
  output: string[]
): void {
  const collect = (chunk: Buffer) => {
    output.push(chunk.toString())
    if (output.length > CLOUDFLARE_OUTPUT_LIMIT) {
      output.splice(0, output.length - CLOUDFLARE_OUTPUT_LIMIT)
    }
  }

  server.stdout.on("data", collect)
  server.stderr.on("data", collect)
}

async function waitForCloudflareHealth(
  port: number,
  server: ChildProcessWithoutNullStreams,
  output: string[]
): Promise<void> {
  const timeoutMs = resolveCloudflareHealthTimeout()
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) =>
      setTimeout(resolve, CLOUDFLARE_HEALTH_POLL_INTERVAL_MS)
    )

    if (server.exitCode !== null) {
      throw new Error(
        `Cloudflare HTTP test runtime exited before /health responded. Output:\n${output.join(
          ""
        )}`
      )
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) {
        return
      }
    } catch {
      // The workerd-backed Vite server is still starting.
    }
  }

  throw new Error(
    `Timed out waiting for Cloudflare HTTP test runtime. Output:\n${output.join(
      ""
    )}`
  )
}

function stopProcessTree(pid: number | undefined): void {
  if (!pid) {
    return
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
    })
    return
  }

  try {
    process.kill(pid, "SIGTERM")
  } catch {
    // Process already exited.
  }
}
