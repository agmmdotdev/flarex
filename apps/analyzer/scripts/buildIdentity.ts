import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import {
  canonicalPrivateAnalyzerHostConfigurationV1,
  PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1,
  PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX,
  PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_SUFFIX,
  privateAnalyzerHostConfigurationV1,
  type PrivateAnalyzerDeploymentPostureV1,
  type PrivateAnalyzerToolchainV1,
} from "../src/Configuration";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE_ROOT = path.resolve(APP_ROOT, "../..");
const CONFIG_PATH = path.join(APP_ROOT, "wrangler.jsonc");
const GENERATED_PATH = path.join(APP_ROOT, "src", "Identity.generated.ts");
const ZERO_IDENTITY = "0".repeat(64);
const IMPLEMENTATION_DOMAIN = Buffer.from(
  "flarex.private-source-analyzer-implementation.v1\0",
  "ascii",
);
const CONFIGURATION_DOMAIN = Buffer.from(
  "flarex.private-source-analyzer-configuration.v1\0",
  "ascii",
);
const WRANGLER_CONFIGURATION_KEYS = Object.freeze([
  "$schema",
  "name",
  "main",
  "compatibility_date",
  "workers_dev",
  "preview_urls",
] as const);

export interface AnalyzerIdentityBuildReceipt {
  readonly implementationIdentity: string;
  readonly configurationIdentity: string;
  readonly finalBundle: Uint8Array;
  readonly inputCount: number;
}

type GeneratedIdentity = {
  readonly implementationIdentity: string;
  readonly configurationIdentity: string;
  readonly toolchain: PrivateAnalyzerToolchainV1;
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const mode = process.argv[2];
  if (mode !== "update" && mode !== "check") {
    throw new Error("Usage: buildIdentity.ts <update|check>");
  }
  const receipt = mode === "update"
    ? await updateAnalyzerIdentity()
    : await checkAnalyzerIdentity();
  console.log(
    `Verified private analyzer identity ${receipt.implementationIdentity} ` +
      `with configuration ${receipt.configurationIdentity}, ` +
      `${receipt.inputCount} bundled inputs, and two byte-identical clean builds.`,
  );
}

export async function updateAnalyzerIdentity(): Promise<AnalyzerIdentityBuildReceipt> {
  const previous = await readFile(GENERATED_PATH, "utf8");
  const toolchain = await installedToolchain();
  const deploymentPosture = await readDeploymentPosture();
  const configurationIdentity = configurationDigest(toolchain, deploymentPosture);
  try {
    await writeGenerated({
      implementationIdentity: ZERO_IDENTITY,
      configurationIdentity,
      toolchain,
    });
    const bootstrap = await buildOnce("bootstrap");
    const implementationIdentity = implementationDigest(
      bootstrap.bundle,
      toolchain,
    );
    await writeGenerated({
      implementationIdentity,
      configurationIdentity,
      toolchain,
    });
    return await verifyTwoFinalBuilds({
      implementationIdentity,
      configurationIdentity,
      toolchain,
    });
  } catch (error) {
    await writeFile(GENERATED_PATH, previous, "utf8");
    throw error;
  }
}

export async function checkAnalyzerIdentity(): Promise<AnalyzerIdentityBuildReceipt> {
  const generated = parseGenerated(await readFile(GENERATED_PATH, "utf8"));
  const installed = await installedToolchain();
  const deploymentPosture = await readDeploymentPosture();
  if (canonicalToolchain(generated.toolchain) !== canonicalToolchain(installed)) {
    throw new Error("Generated private analyzer toolchain does not match installed dependencies.");
  }
  const expectedConfiguration = configurationDigest(installed, deploymentPosture);
  if (generated.configurationIdentity !== expectedConfiguration) {
    throw new Error("Generated private analyzer configuration identity is stale.");
  }
  return await verifyTwoFinalBuilds(generated);
}

async function verifyTwoFinalBuilds(
  expected: GeneratedIdentity,
): Promise<AnalyzerIdentityBuildReceipt> {
  const first = await buildOnce("final-a");
  const second = await buildOnce("final-b");
  if (!Buffer.from(first.bundle).equals(Buffer.from(second.bundle))) {
    throw new Error("Private analyzer clean final bundles are not byte-for-byte stable.");
  }
  const firstDigest = implementationDigest(first.bundle, expected.toolchain);
  const secondDigest = implementationDigest(second.bundle, expected.toolchain);
  if (
    firstDigest !== expected.implementationIdentity ||
    secondDigest !== expected.implementationIdentity
  ) {
    throw new Error("Private analyzer normalized implementation identity did not reproduce.");
  }
  const firstInputs = verifyMetafile(first.metafile);
  const secondInputs = verifyMetafile(second.metafile);
  if (firstInputs !== secondInputs) {
    throw new Error("Private analyzer clean builds emitted different input counts.");
  }
  return Object.freeze({
    implementationIdentity: expected.implementationIdentity,
    configurationIdentity: expected.configurationIdentity,
    finalBundle: new Uint8Array(first.bundle),
    inputCount: firstInputs,
  });
}

function implementationDigest(
  bundle: Uint8Array,
  toolchain: PrivateAnalyzerToolchainV1,
): string {
  const normalized = normalizeImplementationIdentitySlot(bundle);
  rejectUnstableBundleEvidence(normalized);
  const toolchainBytes = Buffer.from(canonicalToolchain(toolchain), "utf8");
  return createHash("sha256")
    .update(IMPLEMENTATION_DOMAIN)
    .update(u32be(toolchainBytes.byteLength))
    .update(toolchainBytes)
    .update(u64be(normalized.byteLength))
    .update(normalized)
    .digest("hex");
}

function configurationDigest(
  toolchain: PrivateAnalyzerToolchainV1,
  deploymentPosture: PrivateAnalyzerDeploymentPostureV1,
): string {
  const configuration = privateAnalyzerHostConfigurationV1(toolchain, deploymentPosture);
  const bytes = Buffer.from(
    canonicalPrivateAnalyzerHostConfigurationV1(configuration),
    "utf8",
  );
  return createHash("sha256")
    .update(CONFIGURATION_DOMAIN)
    .update(u32be(bytes.byteLength))
    .update(bytes)
    .digest("hex");
}

async function readDeploymentPosture(): Promise<PrivateAnalyzerDeploymentPostureV1> {
  const parsed = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as unknown;
  return validatePrivateAnalyzerWranglerConfigurationV1(parsed);
}

export function validatePrivateAnalyzerWranglerConfigurationV1(
  value: unknown,
): PrivateAnalyzerDeploymentPostureV1 {
  if (!isNonArrayRecord(value)) {
    throw new Error("Private analyzer Wrangler configuration must be a record.");
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [...WRANGLER_CONFIGURATION_KEYS].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Private analyzer Wrangler configuration surface is not the exact H0a surface.");
  }
  if (value.$schema !== "../../node_modules/wrangler/config-schema.json") {
    throw new Error("Private analyzer Wrangler schema reference is invalid.");
  }
  if (!isNonEmptyString(value.name)) {
    throw new Error("Private analyzer Wrangler worker name must be nonempty.");
  }
  if (value.main !== "src/worker.ts") {
    throw new Error("Private analyzer Wrangler entrypoint is invalid.");
  }
  if (value.compatibility_date !== "2026-06-14") {
    throw new Error("Private analyzer Wrangler compatibility date is invalid.");
  }
  if (value.workers_dev !== false) {
    throw new Error("Private analyzer Wrangler workers_dev must remain false.");
  }
  if (value.preview_urls !== false) {
    throw new Error("Private analyzer Wrangler preview_urls must remain false.");
  }
  return PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1;
}

export function normalizeImplementationIdentitySlot(bundle: Uint8Array): Uint8Array {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bundle);
  const markerStart = text.indexOf(PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX);
  if (markerStart < 0) throw new Error("Private analyzer implementation identity slot is missing.");
  const identityStart = markerStart + PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX.length;
  const suffixStart = identityStart + 64;
  if (
    !/^[0-9a-f]{64}$/u.test(text.slice(identityStart, suffixStart)) ||
    text.slice(suffixStart, suffixStart + PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_SUFFIX.length) !==
      PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_SUFFIX
  ) {
    throw new Error("Private analyzer implementation identity slot is malformed.");
  }
  if (
    text.indexOf(
      PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX,
      markerStart + PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX.length,
    ) !== -1
  ) {
    throw new Error("Private analyzer bundle contains more than one implementation identity slot.");
  }
  const normalized =
    text.slice(0, identityStart) + ZERO_IDENTITY + text.slice(suffixStart);
  return new TextEncoder().encode(normalized);
}

async function buildOnce(label: string): Promise<{
  readonly bundle: Uint8Array;
  readonly metafile: unknown;
}> {
  const root = await mkdtemp(path.join(tmpdir(), `flarex-analyzer-${label}-`));
  const outdir = path.join(root, "dist");
  const metafilePath = path.join(root, "bundle-meta.json");
  try {
    await runWrangler(outdir, metafilePath);
    const bundle = new Uint8Array(await readFile(path.join(outdir, "worker.js")));
    const metafile = JSON.parse(await readFile(metafilePath, "utf8")) as unknown;
    return { bundle, metafile };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runWrangler(outdir: string, metafile: string): Promise<void> {
  const wranglerCli = createRequire(import.meta.url).resolve("wrangler");
  const child = spawn(process.execPath, [
    wranglerCli,
    "deploy",
    "--dry-run",
    "--config",
    CONFIG_PATH,
    "--outdir",
    outdir,
    "--metafile",
    metafile,
  ], {
    cwd: APP_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let exitCode: number | null | undefined;
  let spawnFailure: Error | undefined;
  let closed = false;
  child.stdout.on("data", chunk => {
    stdout += String(chunk);
  });
  child.stderr.on("data", chunk => {
    stderr += String(chunk);
  });
  child.once("error", error => {
    spawnFailure = error;
  });
  child.once("exit", code => {
    exitCode = code;
  });
  child.once("close", () => {
    closed = true;
  });
  const bundlePath = path.join(outdir, "worker.js");
  let loopFailure: Readonly<{ readonly error: unknown }> | undefined;
  try {
    await awaitWranglerDryRunOutput({
      closed: () => closed,
      diagnostic: () => stderr || stdout,
      exitCode: () => exitCode,
      outputExists: () => pathsExist(bundlePath, metafile),
      spawnFailure: () => spawnFailure,
      stdout: () => stdout,
    });
  } catch (error) {
    loopFailure = { error };
  } finally {
    const exited = await terminateWranglerChild(child, () => exitCode);
    child.stdout.destroy();
    child.stderr.destroy();
    const settled = exited && (closed || await waitFor(() => closed, 2_000));
    if (!settled) {
      loopFailure = { error: new AggregateError(
        loopFailure === undefined ? [] : [loopFailure.error],
        "Wrangler private analyzer dry-run did not terminate after escalation.",
      ) };
    }
  }
  if (loopFailure !== undefined) throw loopFailure.error;
  if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
    throw new Error(
      `Wrangler private analyzer dry-run failed (${String(exitCode)}): ${stderr || stdout}`,
    );
  }
}

export async function awaitWranglerDryRunOutput(options: {
  readonly closed: () => boolean;
  readonly diagnostic: () => string;
  readonly exitCode: () => number | null | undefined;
  readonly outputExists: () => Promise<boolean>;
  readonly spawnFailure: () => Error | undefined;
  readonly stdout: () => string;
}): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (true) {
    const spawnFailure = options.spawnFailure();
    if (spawnFailure !== undefined) throw spawnFailure;
    if (
      options.stdout().includes("--dry-run: exiting now.") &&
      await options.outputExists()
    ) return;
    const exitCode = options.exitCode();
    if (exitCode !== undefined) {
      if (!options.closed()) await waitFor(options.closed, 1_000);
      if (
        options.stdout().includes("--dry-run: exiting now.") &&
        await options.outputExists()
      ) return;
      throw new Error(
        `Wrangler private analyzer dry-run exited before verified output ` +
          `(${String(exitCode)}): ${options.diagnostic()}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error("Wrangler private analyzer dry-run exceeded 60 seconds.");
    }
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
}

async function terminateWranglerChild(
  child: ReturnType<typeof spawn>,
  exitCode: () => number | null | undefined,
): Promise<boolean> {
  if (exitCode() === undefined) child.kill();
  if (!(await waitFor(() => exitCode() !== undefined, 5_000))) {
    child.kill("SIGKILL");
    if (!(await waitFor(() => exitCode() !== undefined, 2_000))) return false;
  }
  return true;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
  return true;
}

async function pathsExist(...paths: readonly string[]): Promise<boolean> {
  try {
    await Promise.all(paths.map(value => access(value)));
    return true;
  } catch {
    return false;
  }
}

function verifyMetafile(value: unknown): number {
  if (typeof value !== "object" || value === null || !("inputs" in value)) {
    throw new Error("Private analyzer Wrangler metafile has no inputs record.");
  }
  const inputs = (value as { readonly inputs?: unknown }).inputs;
  if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) {
    throw new Error("Private analyzer Wrangler metafile inputs are invalid.");
  }
  const names = Object.keys(inputs);
  const forbidden = [
    "flarex-backend",
    "flarex-dev",
    "@flarex/executor",
    "persistence-postgres",
    "runtime-topology-probe",
    "node:fs",
    "node:path",
    "node:crypto",
  ];
  for (const name of names) {
    const portable = name.replaceAll("\\", "/").toLowerCase();
    if (forbidden.some(fragment => portable.includes(fragment))) {
      throw new Error(`Private analyzer bundle includes forbidden input ${name}.`);
    }
  }
  return names.length;
}

function rejectUnstableBundleEvidence(bundle: Uint8Array): void {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bundle);
  const candidates = [
    WORKSPACE_ROOT,
    WORKSPACE_ROOT.replaceAll("\\", "/"),
    `file:///${WORKSPACE_ROOT.replaceAll("\\", "/")}`,
  ];
  const lower = text.toLowerCase();
  for (const candidate of candidates) {
    if (lower.includes(candidate.toLowerCase())) {
      throw new Error("Private analyzer bundle contains an absolute workspace path.");
    }
  }
}

async function installedToolchain(): Promise<PrivateAnalyzerToolchainV1> {
  return Object.freeze({
    wrangler: await packageVersion("wrangler"),
    typescript: await packageVersion("typescript"),
    effect: await packageVersion("effect"),
    workersTypes: await packageVersionFromPackageJson(
      path.join(APP_ROOT, "node_modules", "@cloudflare", "workers-types", "package.json"),
    ),
    esbuild: await packageVersionFromResolved(
      createRequire(import.meta.resolve("wrangler")).resolve("esbuild"),
    ),
  });
}

async function packageVersion(specifier: string): Promise<string> {
  return await packageVersionFromResolved(fileURLToPath(import.meta.resolve(specifier)));
}

async function packageVersionFromResolved(resolved: string): Promise<string> {
  let current = path.dirname(resolved);
  while (true) {
    const candidate = path.join(current, "package.json");
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8")) as unknown;
      if (
        typeof parsed === "object" && parsed !== null &&
        "version" in parsed && typeof parsed.version === "string"
      ) return parsed.version;
    } catch {
      // Continue to the package root.
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to resolve installed package version from ${resolved}.`);
}

async function packageVersionFromPackageJson(packageJsonPath: string): Promise<string> {
  const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as unknown;
  if (
    typeof parsed === "object" && parsed !== null &&
    "version" in parsed && typeof parsed.version === "string"
  ) return parsed.version;
  throw new Error(`Installed package metadata lacks a version at ${packageJsonPath}.`);
}

function canonicalToolchain(value: PrivateAnalyzerToolchainV1): string {
  return encodeCanonicalJson(value as unknown as Json, () => {
    throw new Error("Private analyzer toolchain record lost its JSON invariant.");
  });
}

function parseGenerated(source: string): GeneratedIdentity {
  const implementation = source.match(
    /implementationIdentityMarker:\s*\n?\s*"__FLAREX_PRIVATE_ANALYZER_IMPLEMENTATION_V1__([0-9a-f]{64})__END__"/u,
  );
  const configuration = source.match(/configurationIdentity:\s*\n?\s*"([0-9a-f]{64})"/u);
  const field = (name: keyof PrivateAnalyzerToolchainV1): string => {
    const match = source.match(new RegExp(`${name}: "([^"]+)"`, "u"));
    if (match?.[1] === undefined) throw new Error(`Generated analyzer identity lacks ${name}.`);
    return match[1];
  };
  if (implementation?.[1] === undefined || configuration?.[1] === undefined) {
    throw new Error("Generated private analyzer identity file is malformed.");
  }
  return {
    implementationIdentity: implementation[1],
    configurationIdentity: configuration[1],
    toolchain: Object.freeze({
      wrangler: field("wrangler"),
      typescript: field("typescript"),
      effect: field("effect"),
      workersTypes: field("workersTypes"),
      esbuild: field("esbuild"),
    }),
  };
}

async function writeGenerated(value: GeneratedIdentity): Promise<void> {
  const source = `// Generated by scripts/buildIdentity.ts. Do not edit by hand.\n` +
    `export const GENERATED_PRIVATE_ANALYZER_IDENTITY_V1 = Object.freeze({\n` +
    `  implementationIdentityMarker:\n` +
    `    "${PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX}${value.implementationIdentity}${PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_SUFFIX}",\n` +
    `  implementationIdentityOffset: ${PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX.length},\n` +
    `  implementationIdentityLength: 64,\n` +
    `  configurationIdentity:\n` +
    `    "${value.configurationIdentity}",\n` +
    `  toolchain: Object.freeze({\n` +
    `    wrangler: ${JSON.stringify(value.toolchain.wrangler)},\n` +
    `    typescript: ${JSON.stringify(value.toolchain.typescript)},\n` +
    `    effect: ${JSON.stringify(value.toolchain.effect)},\n` +
    `    workersTypes: ${JSON.stringify(value.toolchain.workersTypes)},\n` +
    `    esbuild: ${JSON.stringify(value.toolchain.esbuild)},\n` +
    `  }),\n` +
    `});\n`;
  await writeFile(GENERATED_PATH, source, "utf8");
}

function u32be(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("Private analyzer identity U32 length is out of range.");
  }
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function u64be(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Private analyzer identity U64 length is out of range.");
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}
