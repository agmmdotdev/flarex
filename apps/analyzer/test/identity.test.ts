import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canonicalPrivateAnalyzerHostConfigurationV1 } from "../src/Configuration";
import { GENERATED_PRIVATE_ANALYZER_IDENTITY_V1 } from "../src/Identity.generated";
import { installedPrivateAnalyzerIdentityV1 } from "../src/Identity";
import {
  awaitWranglerDryRunOutput,
  normalizeImplementationIdentitySlot,
} from "../scripts/buildIdentity";

describe("private analyzer deterministic identity", () => {
  it("pins the accepted configuration and generated identity goldens", () => {
    const installed = installedPrivateAnalyzerIdentityV1();
    expect(installed.identity).toEqual({
      protocolIdentity: "flarex.private-source-analyzer-handshake.v1",
      protocolVersion: 1,
      implementationIdentity: "b9b9c0588b17197ada79f6dc541211cfcb4a73058ca3380e41039e998774f1ea",
      configurationIdentity: "e9f86d9ee5b5f818adf6df9868729e465a1f7fe3e864e879d2776935bea00196",
    });
    expect(canonicalPrivateAnalyzerHostConfigurationV1(installed.configuration)).toBe(
      '{"compatibilityDate":"2026-06-14","compatibilityFlags":[],"format":"flarex.private-source-analyzer-host-configuration","handshake":{"contentType":"application/json","framing":"canonical-json-utf8-full-scan-v1","maximumBodyReadMilliseconds":5000,"method":"POST","path":"/__flarex_private/source-analyzer-v2/identity","redaction":"private-code-only-v1","statuses":{"bodyReadFailed":400,"bodyReadTimedOut":408,"identityMismatch":409,"malformed":400,"methodNotAllowed":405,"notFound":404,"payloadTooLarge":413,"success":200,"unsupportedMediaType":415}},"handshakeCodecVersion":1,"protocolIdentity":"flarex.private-source-analyzer-handshake.v1","protocolVersion":1,"toolchain":{"effect":"4.0.0-beta.90","esbuild":"0.27.3","typescript":"7.0.2","workersTypes":"4.20260613.1","wrangler":"4.100.0"},"version":1}',
    );
  });

  it("normalizes exactly one fixed-width implementation slot", () => {
    const source = new TextEncoder().encode(
      `before:${GENERATED_PRIVATE_ANALYZER_IDENTITY_V1.implementationIdentityMarker}:after`,
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
      `${GENERATED_PRIVATE_ANALYZER_IDENTITY_V1.implementationIdentityMarker}` +
        `${GENERATED_PRIVATE_ANALYZER_IDENTITY_V1.implementationIdentityMarker}`,
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
      "@flarex/utils": "workspace:*",
      effect: "catalog:",
      "flarex-protocol": "workspace:*",
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
});
