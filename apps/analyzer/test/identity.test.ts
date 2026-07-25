import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  canonicalPrivateAnalyzerHostConfigurationV1,
  PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1,
  privateAnalyzerHostConfigurationV1,
  type PrivateAnalyzerDeploymentPostureV1,
} from "../src/Configuration";
import { GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1 } from
  "@flarex/analysis/internal/private-analyzer-release-v1";
import { installedPrivateAnalyzerIdentityV1 } from "../src/Identity";
import {
  awaitWranglerDryRunOutput,
  normalizeImplementationIdentitySlot,
  validatePrivateAnalyzerWranglerConfigurationV1,
} from "../scripts/buildIdentity";

describe("private analyzer deterministic identity", () => {
  it("pins the accepted configuration and generated identity goldens", () => {
    const installed = installedPrivateAnalyzerIdentityV1();
    expect(installed.identity).toEqual({
      protocolIdentity: "flarex.private-source-analyzer-handshake.v1",
      protocolVersion: 1,
      implementationIdentity: "b589730fb8aaa6eeefd461583040133d202e7278726a77abe6834ef5811d1f17",
      configurationIdentity: "c0ffa918d2cbfe69cc6193807caecdccf6d50c391bc2525db300b5a4cc4ce795",
    });
    expect(canonicalPrivateAnalyzerHostConfigurationV1(installed.configuration)).toBe(
      '{"compatibilityDate":"2026-06-14","compatibilityFlags":[],"deploymentPosture":{"format":"flarex.private-source-analyzer-deployment-posture","previewUrls":false,"resourceBindings":[],"routes":[],"version":1,"workersDev":false},"format":"flarex.private-source-analyzer-host-configuration","handshake":{"contentType":"application/json","framing":"canonical-json-utf8-full-scan-v1","maximumBodyReadMilliseconds":5000,"method":"POST","path":"/__flarex_private/source-analyzer-v2/identity","redaction":"private-code-only-v1","statuses":{"bodyReadFailed":400,"bodyReadTimedOut":408,"identityMismatch":409,"malformed":400,"methodNotAllowed":405,"notFound":404,"payloadTooLarge":413,"success":200,"unsupportedMediaType":415}},"handshakeCodecVersion":1,"protocolIdentity":"flarex.private-source-analyzer-handshake.v1","protocolVersion":1,"toolchain":{"effect":"4.0.0-beta.90","esbuild":"0.27.3","typescript":"7.0.2","workersTypes":"4.20260613.1","wrangler":"4.100.0"},"verification":{"contentType":"application/x-flarex-declarative-v2-verification-v1","maximumBodyReadMilliseconds":30000,"maximumFrameBytes":65536,"method":"POST","path":"/__flarex_private/source-analyzer-v2/verify","protocolIdentity":"flarex.private-source-analyzer-verification.v1","protocolVersion":1,"transitionQuantum":1024},"version":1}',
    );
  });

  it("normalizes exactly one fixed-width implementation slot", () => {
    const source = new TextEncoder().encode(
      `constant:${"__FLAREX_PRIVATE_ANALYZER_IMPLEMENTATION_V1__"}:` +
        `before:${GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1.implementationIdentityMarker}:after`,
    );
    const normalized = new TextDecoder().decode(normalizeImplementationIdentitySlot(source));
    expect(normalized).toContain("0".repeat(64));
    expect(normalized).not.toContain(
      installedPrivateAnalyzerIdentityV1().identity.implementationIdentity,
    );
    expect(() => normalizeImplementationIdentitySlot(new Uint8Array(0))).toThrow(
      "identity slot is missing",
    );
    expect(() => normalizeImplementationIdentitySlot(new TextEncoder().encode(
      `${GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1.implementationIdentityMarker}` +
        `${GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1.implementationIdentityMarker}`,
    ))).toThrow("more than one");
  });

  it("accepts a clean exit only after the final stdout sentinel drains through close", async () => {
    let closed = false;
    let stdout = "";
    let outputChecks = 0;
    setTimeout(() => {
      stdout = "wrangler output --dry-run: exiting now.";
      closed = true;
    }, 0);
    await awaitWranglerDryRunOutput({
      closed: () => closed,
      diagnostic: () => stdout,
      exitCode: () => 0,
      outputExists: () => {
        outputChecks += 1;
        return Promise.resolve(true);
      },
      spawnFailure: () => undefined,
      stdout: () => stdout,
    });
    expect(closed).toBe(true);
    expect(outputChecks).toBe(1);
  });

  it("keeps the app private with no package export surface", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      readonly dependencies?: unknown;
      readonly private?: unknown;
      readonly exports?: unknown;
    };
    expect(packageJson.private).toBe(true);
    expect(packageJson.exports).toBeUndefined();
    expect(packageJson.dependencies).toEqual({
      "@flarex/analysis": "workspace:*",
      "@flarex/utils": "workspace:*",
      effect: "catalog:",
      "flarex-protocol": "workspace:*",
    });

    const analysisPackageJson = JSON.parse(
      await readFile(new URL("../../../packages/analysis/package.json", import.meta.url), "utf8"),
    ) as { readonly exports?: unknown };
    expect(analysisPackageJson.exports).toEqual({
      ".": "./src/index.ts",
      "./internal/declarative-v2-verifier-v1": "./src/declarativeV2VerifierV1.ts",
      "./internal/private-analyzer-verification-v1": "./src/privateAnalyzerVerificationV1.ts",
      "./internal/private-analyzer-release-v1": "./src/privateAnalyzerReleaseV1.ts",
      "./internal/private-sha256-v1": "./src/privateSha256V1.ts",
    });

    const wrangler = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")) as unknown;
    expect(wrangler).toEqual({
      $schema: "../../node_modules/wrangler/config-schema.json",
      name: "flarex-source-analyzer-v2",
      main: "src/worker.ts",
      compatibility_date: "2026-06-14",
      workers_dev: false,
      preview_urls: false,
    });
  });

  it("validates the exact private deployment posture from Wrangler configuration", async () => {
    const wrangler = JSON.parse(
      await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(validatePrivateAnalyzerWranglerConfigurationV1(wrangler)).toBe(
      PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1,
    );
    expect(validatePrivateAnalyzerWranglerConfigurationV1({
      ...wrangler,
      name: "environment-specific-name-excluded-from-identity",
    })).toBe(PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1);

    const drifts: readonly Record<string, unknown>[] = [
      { ...wrangler, workers_dev: true },
      { ...wrangler, preview_urls: true },
      { ...wrangler, routes: [] },
      { ...wrangler, r2_buckets: [] },
    ];
    for (const drift of drifts) {
      expect(() => validatePrivateAnalyzerWranglerConfigurationV1(drift)).toThrow();
    }
  });

  it("captures an owned frozen deployment-posture snapshot", () => {
    const callerPosture = {
      ...PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1,
      routes: [] as unknown[],
      resourceBindings: [] as unknown[],
    } as unknown as PrivateAnalyzerDeploymentPostureV1;
    const configuration = privateAnalyzerHostConfigurationV1(
      installedPrivateAnalyzerIdentityV1().configuration.toolchain,
      callerPosture,
    );
    const mutableCaller = callerPosture as unknown as {
      format: string;
      version: number;
      workersDev: boolean;
      previewUrls: boolean;
      routes: unknown[];
      resourceBindings: unknown[];
    };
    mutableCaller.format = "mutated-posture";
    mutableCaller.version = 2;
    mutableCaller.workersDev = true;
    mutableCaller.previewUrls = true;
    mutableCaller.routes.push("https://public.example/*");
    mutableCaller.resourceBindings.push({ r2: "ARTIFACTS" });

    expect(configuration.deploymentPosture).toEqual(PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1);
    expect(configuration.deploymentPosture).not.toBe(callerPosture);
    expect(Object.isFrozen(configuration.deploymentPosture)).toBe(true);
    expect(Object.isFrozen(configuration.deploymentPosture.routes)).toBe(true);
    expect(Object.isFrozen(configuration.deploymentPosture.resourceBindings)).toBe(true);
  });
});
