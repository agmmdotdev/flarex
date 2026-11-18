import { copyBytesToArrayBuffer, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Result, Schema } from "effect";
import { executionArtifactRefForSourcePackage, sourceModuleDigestInputV1, SOURCE_MODULE_DIGEST_FORMAT_V1,
  type MaterializedArtifactSourcePackage } from "flarex/artifacts";
import type { PushSourcePackage } from "flarex-protocol/deployment";
import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capturePublicApplicationSourcePolicy } from "../src/sourceArtifactV2/PublicApplicationSource";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION, SOURCE_ARTIFACT_V2_ROLE_FUNCTION } from "../src/sourceArtifactV2/Framing";

const admission = { calls: 1 as const, blockBytes: 4_096, modules: 1, sourceMaps: 1,
  canonicalBytes: 65_536, frameBytes: 65_536, hashBytes: 131_072, timeMilliseconds: 1_000 };
const policy = { blockSizeBytes: 256, admission, ceilings: { calls: 256, blockBytes: 1_048_576,
  modules: 256, sourceMaps: 256, canonicalBytes: 16_777_216, frameBytes: 16_777_216,
  hashBytes: 33_554_432, timeMilliseconds: 256_000 } };
const Module = Schema.Struct({ path: Schema.String, roles: Schema.Int, source: Schema.String,
  sourceMap: Schema.optionalKey(Schema.String) });
const Success = Schema.Struct({ result: Schema.Struct({ sourcePackageHash: Schema.String, sourceArtifactRootSha256: Schema.String,
  sourcePackage: Schema.Unknown, metadata: Schema.Unknown, metadataHash: Schema.String,
  source: Schema.Struct({ modules: Schema.Array(Module) }),
  tables: Schema.Array(Schema.Struct({ name: Schema.String })) }) });
const decodeSuccess = Schema.decodeUnknownSync(Success);

describe("public package source producer with actual SQLite and R2", () => {
  let runtime: Miniflare;
  beforeAll(async () => {
    const base = dirname(fileURLToPath(import.meta.url));
    const built = await build({ configFile: false, logLevel: "silent", build: { write: false, target: "es2022",
      lib: { entry: join(base, "publicApplicationSource.workerd.worker.ts"), formats: ["es"], fileName: () => "worker.js" },
      rolldownOptions: { external: ["cloudflare:workers"] } } });
    const chunks = (Array.isArray(built) ? built : [built]).flatMap(result => "output" in result ? result.output : []);
    const output = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
    if (output?.type !== "chunk") throw new Error("Missing actual source producer Worker");
    runtime = new Miniflare({ modules: [{ type: "ESModule", path: "worker.js", contents: output.code }],
      compatibilityDate: "2026-06-14", durableObjects: { SOURCES: { className: "PublicApplicationSourceDO", useSQLite: true } },
      r2Buckets: ["ARTIFACTS"] });
  }, 90_000);
  afterAll(async () => { await runtime?.dispose(); });

  const invoke = (name: string, sourcePackage: PushSourcePackage, extra: Record<string, unknown> = {}) => runtime.dispatchFetch(
    `https://public-source.test/${name}`, { method: "POST", body: JSON.stringify({ sourcePackage, policy, ...extra }) });

  it("preserves multi-block source/maps, dependency roles, inline auth and genuine independent identities", async () => {
    const pkg = await sourcePackage("mapped ".repeat(100), true, true);
    const response = await invoke("multi-block", pkg);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = decodeSuccess(await response.json()).result;
    expect(result.sourcePackageHash).toBe((await executionArtifactRefForSourcePackage(pkg)).sourcePackageHash);
    expect(result.sourceArtifactRootSha256).not.toBe(result.sourcePackageHash);
    expect(result.source.modules.find(module => module.path === "dependency.js")).toMatchObject({ roles: 0, source: pkg.modules[0]?.source });
    expect(result.source.modules.find(module => module.path === "app.js")?.roles)
      .toBe(SOURCE_ARTIFACT_V2_ROLE_EXECUTION | SOURCE_ARTIFACT_V2_ROLE_FUNCTION);
    expect(result.source.modules.find(module => module.path === "app.js")?.sourceMap).toBe(pkg.modules.find(module => module.path === "app.js")?.sourceMap);
    expect(result.sourcePackage).toEqual(pkg);
    expect(result.metadataHash).toBe(result.sourcePackageHash);
    expect(result.metadata).not.toHaveProperty("modules.0.source");
    expect(result.tables).toEqual([{ name: "source_artifact_upload_attempts_v2" }]);
    const replay = await invoke("multi-block", pkg);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(decodeSuccess(await replay.json()).result.sourceArtifactRootSha256).toBe(result.sourceArtifactRootSha256);
    const changedMap = await sourcePackage("changed map", true, true);
    const changed = await invoke("multi-block", changedMap);
    expect(changed.status, await changed.clone().text()).toBe(200);
    const changedResult = decodeSuccess(await changed.json()).result;
    expect(changedResult.sourcePackageHash).not.toBe(result.sourcePackageHash);
    expect(changedResult.sourceArtifactRootSha256).not.toBe(result.sourceArtifactRootSha256);
  }, 60_000);

  it("resumes persisted reserved and prepared commands after lost acknowledgements", async () => {
    const pkg = await sourcePackage();
    const reserved = await invoke("reserved-loss", pkg, { loseWrite: 3 });
    expect(reserved.status).toBe(409);
    expect(await reserved.text()).toContain("SourceArtifactV2AttemptStoreSettlementUncertainError");
    const resumed = await invoke("reserved-loss", pkg);
    expect(resumed.status, await resumed.clone().text()).toBe(200);
    const prepared = await invoke("prepared-loss", pkg, { loseObject: "source-block" });
    expect(prepared.status).toBe(409);
    expect(await prepared.text()).toContain("SourceArtifactV2R2SettlementUncertainError");
    const completed = await invoke("prepared-loss", pkg);
    expect(completed.status, await completed.clone().text()).toBe(200);
    expect(decodeSuccess(await completed.json()).result.sourceArtifactRootSha256)
      .toBe(decodeSuccess(await resumed.json()).result.sourceArtifactRootSha256);
  }, 60_000);

  it("rejects tampered bytes/maps, duplicate membership and executable auth before upload", async () => {
    const pkg = await sourcePackage();
    const first = pkg.modules[0];
    if (first === undefined) throw new Error("Missing source module");
    for (const bad of [
      { ...pkg, modules: [{ ...first, source: first.source + "tamper" }, ...pkg.modules.slice(1)] },
      { ...pkg, modules: [{ ...first, sourceMap: "tampered" }, ...pkg.modules.slice(1)] },
      { ...pkg, modules: [...pkg.modules, first] },
      { ...pkg, functions: ["app.js", "app.js"] },
      { ...pkg, functions: ["missing.js"] },
      { ...pkg, authConfigModule: "app.js" },
    ]) expect((await invoke("invalid", bad)).status).toBe(409);
    const exhausted = await invoke("bounded-plan", pkg, { policy: { ...policy, blockSizeBytes: 1,
      ceilings: { ...policy.ceilings, calls: 2 } } });
    expect(exhausted.status).toBe(409);
    expect(await exhausted.text()).toContain("limitExceeded");
    expect(Result.isFailure(capturePublicApplicationSourcePolicy({ ...policy, blockSizeBytes: 10_000 }))).toBe(true);
    expect(Result.isSuccess(capturePublicApplicationSourcePolicy(policy))).toBe(true);
  });

  it("refuses a stored finalized root with matching bytes but foreign function membership", async () => {
    const pkg = await sourcePackage();
    const original = await invoke("foreign-root", pkg);
    expect(original.status, await original.clone().text()).toBe(200);
    const first = decodeSuccess(await original.json()).result;
    const other = await invoke("foreign-root", { ...pkg, functions: [] });
    expect(other.status, await other.clone().text()).toBe(200);
    const second = decodeSuccess(await other.json()).result;
    const corrupted = await invoke("foreign-root", pkg, { replaceRoot: {
      from: first.sourceArtifactRootSha256, to: second.sourceArtifactRootSha256,
    } });
    expect(corrupted.status).toBe(409);
    expect(await corrupted.text()).toContain("integrityMismatch");
  });

  it("preserves leading BOM bytes in source text and source maps", async () => {
    const source = "\ufeffexport const value = 1;";
    const sourceMap = "\ufeff{\"version\":3}";
    const pkg = await sourcePackage(sourceMap, false, false, source);
    const response = await invoke("bom", pkg);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(decodeSuccess(await response.json()).result.source.modules).toEqual([
      { path: "app.js", roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION | SOURCE_ARTIFACT_V2_ROLE_FUNCTION, source, sourceMap },
    ]);
  });

  it("refuses unrepresentable empty maps before creating upload storage or R2 objects", async () => {
    const response = await invoke("empty-map", await sourcePackage(""));
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ tables: [], objectWrites: 0,
      reasons: [{ _tag: "PublicApplicationSourceError", reason: "invalidPackage" }] });
  });

  it("refuses a stored finalized root with different source-map bytes or presence", async () => {
    for (const replacement of ["different map bytes", null]) {
      const name = replacement === null ? "absent-map-root" : "foreign-map-root";
      const pkg = await sourcePackage("original map");
      const original = await invoke(name, pkg);
      expect(original.status, await original.clone().text()).toBe(200);
      const first = decodeSuccess(await original.json()).result;
      const other = await invoke(name, await sourcePackage(replacement));
      expect(other.status, await other.clone().text()).toBe(200);
      const second = decodeSuccess(await other.json()).result;
      const corrupted = await invoke(name, pkg, { replaceRoot: {
        from: first.sourceArtifactRootSha256, to: second.sourceArtifactRootSha256,
      } });
      expect(corrupted.status, await corrupted.clone().text()).toBe(409);
      expect(await corrupted.text()).toContain("integrityMismatch");
    }
  });
});

async function sourcePackage(sourceMap: string | null = "mapped ".repeat(100), inlineAuth = false, includeDependency = false,
  sourceText = "export const source = '" + "source ".repeat(100) + "';"): Promise<MaterializedArtifactSourcePackage> {
  const modules = [];
  const bodies: Array<readonly [string, string, string | undefined]> = [
    ["app.js", sourceText, sourceMap ?? undefined],
  ];
  if (includeDependency) bodies.unshift(["dependency.js", "export const value = 1;", undefined]);
  for (const [path, source, map] of bodies) {
    const sha256 = encodeBytesToLowercaseHex(new Uint8Array(await crypto.subtle.digest("SHA-256",
      copyBytesToArrayBuffer(sourceModuleDigestInputV1(source, map)))));
    modules.push({ path, source, sha256, environment: "isolate" as const, ...(map === undefined ? {} : { sourceMap: map }) });
  }
  return { modules, execution: "app.js", functions: ["app.js"], sourceModuleDigestFormat: SOURCE_MODULE_DIGEST_FORMAT_V1,
    ...(inlineAuth ? { authConfig: { providers: [{ type: "customJwt" as const, issuer: "https://issuer.example", jwks: "https://issuer.example/jwks",
      algorithm: "RS256" as const, applicationID: "public" }] } } : {}) };
}
