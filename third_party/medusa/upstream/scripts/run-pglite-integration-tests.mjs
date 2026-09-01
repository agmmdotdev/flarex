// @ts-check

import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** @typedef {"jest" | "vitest"} TestRunner */
/**
 * @typedef {object} CliOptions
 * @property {boolean} help
 * @property {boolean} list
 * @property {string | undefined} only
 * @property {string | undefined} from
 * @property {TestRunner} runner
 */
/**
 * @typedef {object} PGliteLane
 * @property {string} id
 * @property {string} label
 * @property {Partial<Record<TestRunner, readonly string[]>>} commands
 */
/**
 * @typedef {object} PlannedLane
 * @property {PGliteLane} lane
 * @property {readonly string[]} args
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pnpmCommand = process.platform === "win32" ? "cmd.exe" : "pnpm"
/** @param {readonly string[]} args */
const pnpmArgs = (args) =>
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args

/** @type {readonly string[]} */
const modulePackages = [
  "@medusajs/currency",
  "@medusajs/api-key",
  "@medusajs/translation",
  "@medusajs/settings",
  "@medusajs/store",
  "@medusajs/auth",
  "@medusajs/region",
  "@medusajs/rbac",
  "@medusajs/user",
  "@medusajs/sales-channel",
  "@medusajs/customer",
  "@medusajs/analytics",
  "@medusajs/file",
  "@medusajs/stock-location",
  "@medusajs/inventory",
  "@medusajs/tax",
  "@medusajs/payment",
  "@medusajs/notification",
  "@medusajs/fulfillment",
  "@medusajs/promotion",
  "@medusajs/product",
  "@medusajs/pricing",
  "@medusajs/cart",
  "@medusajs/order",
]

/** @type {readonly PGliteLane[]} */
const lanes = [
  {
    id: "adapter",
    label: "@medusajs/test-utils PGlite adapter and selection",
    commands: {
      jest: [
        "--filter=@medusajs/test-utils",
        "exec",
        "jest",
        "src/__tests__/module-test-persistence-selection.spec.ts",
        "src/__tests__/pglite-module-test-persistence-adapter.spec.ts",
        "test-runner-contracts/module-test-runner-lifecycle.spec.ts",
        "--setupFiles=../../integration-tests/setup-env.js",
        "--runInBand",
        "--forceExit",
      ],
      vitest: [
        "--filter=@medusajs/test-utils",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.integration.config.mts",
      ],
    },
  },
  ...modulePackages.map((packageName) => ({
    id: packageName.slice("@medusajs/".length),
    label: packageName,
    commands: {
      jest: [
        `--filter=${packageName}`,
        packageName === "@medusajs/currency" ||
        packageName === "@medusajs/api-key" ||
        packageName === "@medusajs/translation" ||
        packageName === "@medusajs/settings" ||
        packageName === "@medusajs/store" ||
        packageName === "@medusajs/auth" ||
        packageName === "@medusajs/region" ||
        packageName === "@medusajs/rbac" ||
        packageName === "@medusajs/user" ||
        packageName === "@medusajs/sales-channel" ||
        packageName === "@medusajs/customer" ||
        packageName === "@medusajs/analytics" ||
        packageName === "@medusajs/file" ||
        packageName === "@medusajs/stock-location" ||
        packageName === "@medusajs/inventory" ||
        packageName === "@medusajs/tax" ||
        packageName === "@medusajs/payment" ||
        packageName === "@medusajs/notification" ||
        packageName === "@medusajs/fulfillment" ||
        packageName === "@medusajs/promotion" ||
        packageName === "@medusajs/product" ||
        packageName === "@medusajs/pricing" ||
        packageName === "@medusajs/cart"
          ? "test:integration:jest"
          : "test:integration",
        "--runInBand",
      ],
      ...(packageName === "@medusajs/currency" ||
      packageName === "@medusajs/api-key" ||
      packageName === "@medusajs/translation" ||
      packageName === "@medusajs/settings" ||
      packageName === "@medusajs/store" ||
      packageName === "@medusajs/auth" ||
      packageName === "@medusajs/region" ||
      packageName === "@medusajs/rbac" ||
      packageName === "@medusajs/user" ||
      packageName === "@medusajs/sales-channel" ||
      packageName === "@medusajs/customer" ||
      packageName === "@medusajs/analytics" ||
      packageName === "@medusajs/file" ||
      packageName === "@medusajs/stock-location" ||
      packageName === "@medusajs/inventory" ||
      packageName === "@medusajs/tax" ||
      packageName === "@medusajs/payment" ||
      packageName === "@medusajs/notification" ||
      packageName === "@medusajs/fulfillment" ||
      packageName === "@medusajs/promotion" ||
      packageName === "@medusajs/product" ||
      packageName === "@medusajs/pricing" ||
      packageName === "@medusajs/cart" ||
      packageName === "@medusajs/order"
        ? {
            vitest: [
              `--filter=${packageName}`,
              packageName === "@medusajs/order"
                ? "test:integration:vitest"
                : "test:integration",
            ],
          }
        : {}),
    },
  })),
]

/** @returns {string} */
function usage() {
  return [
    "Usage: pnpm test:integration:pglite [options]",
    "",
    "Options:",
    "  --list              List lanes without running them",
    "  --only <lane>       Run one lane by id or package name",
    "  --from <lane>       Resume from a lane by id or package name",
    "  --runner <runner>   Select jest (default) or vitest",
    "  --help              Show this help",
  ].join("\n")
}

/**
 * @param {readonly string[]} args
 * @param {number} index
 * @param {string} name
 * @param {string} description
 * @returns {{ value: string, nextIndex: number }}
 */
function readOptionValue(args, index, name, description) {
  const argument = args[index]
  if (argument === undefined) {
    throw new Error(`${name} requires ${description}`)
  }

  const prefix = `${name}=`
  if (argument.startsWith(prefix)) {
    const value = argument.slice(prefix.length)
    if (!value) {
      throw new Error(`${name} requires ${description}`)
    }
    return { value, nextIndex: index }
  }

  const value = args[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires ${description}`)
  }

  return { value, nextIndex: index + 1 }
}

/** @param {string} value @returns {TestRunner} */
function parseRunner(value) {
  if (value === "jest" || value === "vitest") {
    return value
  }

  throw new Error(
    `Unsupported PGlite test runner: ${value}. Expected jest or vitest.`
  )
}

/** @param {readonly string[]} args @returns {CliOptions} */
function parseArguments(args) {
  /** @type {CliOptions} */
  const options = {
    help: false,
    list: false,
    only: undefined,
    from: undefined,
    runner: "jest",
  }

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === undefined) {
      throw new Error(`Missing argument at position ${index}`)
    }

    if (argument === "--help") {
      options.help = true
      continue
    }
    if (argument === "--list") {
      options.list = true
      continue
    }
    if (argument === "--only" || argument.startsWith("--only=")) {
      const parsed = readOptionValue(
        args,
        index,
        "--only",
        "a lane id or package name"
      )
      options.only = parsed.value
      index = parsed.nextIndex
      continue
    }
    if (argument === "--from" || argument.startsWith("--from=")) {
      const parsed = readOptionValue(
        args,
        index,
        "--from",
        "a lane id or package name"
      )
      options.from = parsed.value
      index = parsed.nextIndex
      continue
    }
    if (argument === "--runner" || argument.startsWith("--runner=")) {
      const parsed = readOptionValue(args, index, "--runner", "jest or vitest")
      options.runner = parseRunner(parsed.value)
      index = parsed.nextIndex
      continue
    }

    throw new Error(`Unknown option: ${argument}`)
  }

  if (options.only && options.from) {
    throw new Error("--only and --from cannot be used together")
  }

  return options
}

/** @param {string} selector @returns {number} */
function findLaneIndex(selector) {
  return lanes.findIndex(
    (lane) => lane.id === selector || lane.label === selector
  )
}

/** @param {CliOptions} options @returns {readonly PGliteLane[]} */
function selectLanes(options) {
  if (options.only) {
    const index = findLaneIndex(options.only)
    if (index === -1) {
      throw new Error(`Unknown PGlite lane: ${options.only}`)
    }

    const lane = lanes[index]
    if (lane === undefined) {
      throw new Error(`Unknown PGlite lane: ${options.only}`)
    }

    return [lane]
  }

  if (options.from) {
    const index = findLaneIndex(options.from)
    if (index === -1) {
      throw new Error(`Unknown PGlite lane: ${options.from}`)
    }
    return lanes.slice(index)
  }

  return lanes
}

/** @param {TestRunner} runner @returns {NodeJS.ProcessEnv} */
function pgliteEnvironment(runner) {
  const environment = {
    ...process.env,
    MEDUSA_MODULE_TEST_PERSISTENCE: "pglite",
    MEDUSA_PGLITE_TESTS: "1",
  }

  if (runner === "vitest") {
    return environment
  }

  const experimentalVmModules = "--experimental-vm-modules"
  const currentNodeOptions = process.env.NODE_OPTIONS?.trim() ?? ""
  const nodeOptions = currentNodeOptions.includes(experimentalVmModules)
    ? currentNodeOptions
    : `${currentNodeOptions} ${experimentalVmModules}`.trim()

  return {
    ...environment,
    NODE_OPTIONS: nodeOptions,
  }
}

/**
 * @param {readonly PGliteLane[]} selectedLanes
 * @param {TestRunner} runner
 * @returns {readonly PlannedLane[]}
 */
function planLanes(selectedLanes, runner) {
  return selectedLanes.map((lane) => {
    const args = lane.commands[runner]
    if (args === undefined) {
      const supportedRunners = Object.keys(lane.commands).join(", ")
      throw new Error(
        `PGlite lane ${lane.id} does not support ${runner}. Supported runners: ${supportedRunners}.`
      )
    }

    return { lane, args }
  })
}

/**
 * @param {PlannedLane} plannedLane
 * @param {number} index
 * @param {number} total
 * @param {TestRunner} runner
 * @returns {void}
 */
function runLane(plannedLane, index, total, runner) {
  process.stdout.write(
    `\n[pglite ${index + 1}/${total}] ${plannedLane.lane.label}\n`
  )
  const result = spawnSync(pnpmCommand, pnpmArgs(plannedLane.args), {
    cwd: repositoryRoot,
    env: pgliteEnvironment(runner),
    stdio: "inherit",
    windowsHide: true,
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

let options
try {
  options = parseArguments(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.stderr.write(`${usage()}\n`)
  process.exit(1)
}

if (options.help) {
  process.stdout.write(`${usage()}\n`)
  process.exit(0)
}

let selectedLanes
try {
  selectedLanes = selectLanes(options)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
}

let plannedLanes
try {
  plannedLanes = planLanes(selectedLanes, options.runner)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
}

if (options.list) {
  plannedLanes.forEach(({ lane }, index) => {
    process.stdout.write(
      `${String(index + 1).padStart(2, " ")}. ${lane.id}\t${lane.label}\n`
    )
  })
  process.exit(0)
}

plannedLanes.forEach((plannedLane, index) => {
  runLane(plannedLane, index, plannedLanes.length, options.runner)
})

process.stdout.write(
  `\nPGlite integration matrix passed: ${plannedLanes.length} lanes.\n`
)
