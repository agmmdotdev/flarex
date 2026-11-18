import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApplicationWorkerCoreTwice } from "../scripts/buildApplicationWorkerCore";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const preludePath = fileURLToPath(new URL("../scripts/ApplicationWorkerStackTracePrelude.ts", import.meta.url));
const effectPath = createRequire(import.meta.url).resolve("effect");
const proofId = "trusted-effect-stack-trace-proof";
const resolvedProofId = `\0${proofId}`;
let proofSource = "";

beforeAll(async () => {
  const output = await build({ configFile: false, root: packageRoot, logLevel: "silent", plugins: [{
    name: "trusted-stack-trace-proof",
    resolveId(id) { if (id === proofId || id.replaceAll("\\", "/").endsWith(`/${proofId}`)) return resolvedProofId; },
    load(id) {
      if (id !== resolvedProofId) return;
      return `import ${JSON.stringify(preludePath.replaceAll("\\", "/"))};
import { Data, Result, Schema } from ${JSON.stringify(effectPath.replaceAll("\\", "/"))};
const descriptor = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
const before = Error.stackTraceLimit;
Object.freeze(Error.prototype);
Object.freeze(Error);
class Refusal extends Data.TaggedError("Refusal") {}
const invalid = Schema.decodeUnknownResult(Schema.String)(null);
const refusal = new Refusal({ reason: "capacity" });
globalThis.__proof = { value: before, immutable: descriptor === undefined || descriptor.writable === false && descriptor.configurable === false,
  errorFrozen: Object.isFrozen(Error), prototypeFrozen: Object.isFrozen(Error.prototype),
  schemaFailure: Result.isFailure(invalid), refusalTag: refusal._tag, refusalReason: refusal.reason };
`;
    },
  }], build: { write: false, target: "es2022", minify: "esbuild", sourcemap: false,
    lib: { entry: proofId, formats: ["iife"], name: "TrustedEffectInteropProof" }, rollupOptions: { treeshake: true } } });
  if (!Array.isArray(output) || output.length !== 1 || output[0]?.output.length !== 1
    || output[0].output[0]?.type !== "chunk") throw new Error("Expected one interop proof chunk");
  proofSource = output[0].output[0].code;
});

describe("trusted Application Worker Effect prelude", () => {
  it.each([
    { name: "writable native property", setup: 'Object.defineProperty(Error,"stackTraceLimit",{value:17,writable:true,configurable:true})', value: 17 },
    { name: "absent native property", setup: 'delete Error.stackTraceLimit', value: undefined },
    { name: "already immutable property", setup: 'Object.defineProperty(Error,"stackTraceLimit",{value:23,writable:false,configurable:false})', value: 23 },
    { name: "absent property on a frozen constructor", setup: 'delete Error.stackTraceLimit; Object.freeze(Error)', value: undefined },
    { name: "configurable native accessor", setup: 'Object.defineProperty(Error,"stackTraceLimit",{get:()=>29,set:()=>{},configurable:true})', value: 29 },
  ])("preserves Schema and Data refusals after hardening: $name", ({ setup, value }) => {
    const context = createContext({ TextEncoder, TextDecoder });
    runInContext(setup, context);
    runInContext(proofSource, context);
    const proof: unknown = runInContext("globalThis.__proof", context);
    expect(proof).toEqual({ value, immutable: true, errorFrozen: true, prototypeFrozen: true,
      schemaFailure: true, refusalTag: "Refusal", refusalReason: "capacity" });
  });

  it("retains the prelude and all existing guards in two byte-identical actual core builds", async () => {
    const receipt = await buildApplicationWorkerCoreTwice();
    expect(receipt.sourceBytes).toBe(Buffer.byteLength(receipt.source, "utf8"));
    expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.serverExports).toContain("query");
    expect(receipt.valuesExports).toContain("v");
  });
});
