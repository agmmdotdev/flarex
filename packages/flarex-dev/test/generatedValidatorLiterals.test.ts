import { Schema } from "effect";
import * as flarexServer from "flarex/server";
import {
  decodeValidatorJsonWireV1,
  encodeValidatorJsonV1,
  ValidatorJsonV1,
  ValidatorJsonWireCodecV1,
  type ObjectValidatorJsonV1,
  type ValidatorJsonV1 as ValidatorJson,
} from "flarex-protocol/validator-json";
import { transformWithEsbuild } from "vite";
import { describe, expect, it } from "vitest";

import type { DeploymentAnalysis } from "../src/analyze";
import { finalGeneratedFiles } from "../src/generate";

const literals: ObjectValidatorJsonV1 = {
  type: "object",
  value: {
    count: { fieldType: { type: "literal", value: -9223372036854775808n }, optional: false },
    sign: { fieldType: { type: "literal", value: -0 }, optional: false },
    text: { fieldType: { type: "literal", value: "a\u0000b" }, optional: false },
    ["__proto__"]: { fieldType: { type: "literal", value: 1n }, optional: false },
    nested: { fieldType: { type: "array", value: { type: "object", value: {
      ["__proto__"]: { fieldType: { type: "literal", value: -0 }, optional: false },
    } } }, optional: false },
  },
};

function analysisFor(validator: ObjectValidatorJsonV1, returns: ValidatorJson | null = { type: "literal", value: 9223372036854775807n }): DeploymentAnalysis {
  return {
    schema: { version: 1, tables: [{ tableId: 1, name: "literals", validator, placement: { kind: "global" } }], indexes: [] },
    functions: [{ moduleName: "literals", functions: [{
      moduleName: "literals", exportName: "read", kind: "query", visibility: "public", args: validator, returns, partition: null,
    }] }],
  };
}

/** Execute actual generated TypeScript, substituting only named module bindings. */
async function evaluateGeneratedModule(source: string, dependencies: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
  const compiled = await transformWithEsbuild(source, "generated.ts", { format: "cjs", target: "esnext" });
  const module = { exports: {} };
  const requireDependency = (specifier: string) => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier === "flarex/validator-json") return { decodeValidatorJsonWireV1 };
    throw new Error(`Unexpected generated dependency: ${specifier}`);
  };
  new Function("module", "exports", "require", compiled.code)(module, module.exports, requireDependency);
  return module.exports;
}

type GeneratedFetch = (request: Request, env: object) => unknown;
const decodeWorkerModule = Schema.decodeUnknownSync(Schema.Struct({ default: Schema.Struct({
  fetch: Schema.declare<GeneratedFetch>((value): value is GeneratedFetch => typeof value === "function"),
}) }));

const decodeMetadataResponse = Schema.decodeUnknownSync(Schema.Struct({
  schema: Schema.Struct({ tables: Schema.Array(Schema.Struct({ validator: ValidatorJsonWireCodecV1 })) }),
  functions: Schema.Array(Schema.Struct({ args: ValidatorJsonWireCodecV1, returns: Schema.Union([ValidatorJsonWireCodecV1, Schema.Null]) })),
}));

async function loadGeneratedWorker(analysis: DeploymentAnalysis, codecCalls = { decode: 0, encode: 0 }) {
  const files = finalGeneratedFiles(analysis);
  const metadata = files.find(file => file.name === "functionMetadata.ts");
  const deployment = files.find(file => file.name === "deploymentSchema.ts");
  const worker = files.find(file => file.name === "worker.ts");
  if (metadata === undefined || deployment === undefined || worker === undefined) throw new Error("Missing generated modules.");
  const codecDependency = {
    decodeValidatorJsonWireV1(value: unknown) { codecCalls.decode += 1; return decodeValidatorJsonWireV1(value); },
    encodeValidatorJsonV1(value: ValidatorJson) { codecCalls.encode += 1; return encodeValidatorJsonV1(value); },
  };
  const dependencies = { "flarex/validator-json": codecDependency };
  const metadataModule = await evaluateGeneratedModule(metadata.contents, dependencies);
  const deploymentModule = await evaluateGeneratedModule(deployment.contents, dependencies);
  const workerModule = decodeWorkerModule(await evaluateGeneratedModule(worker.contents, {
    "cloudflare:workers": { DurableObject: class DurableObject {} },
    "flarex/server": flarexServer,
    "flarex/validator-json": codecDependency,
    "./functionMetadata": metadataModule,
    "./deploymentSchema": deploymentModule,
    "./functionRegistry": { functions: {} },
  }));
  return { metadataModule, deploymentModule, worker: workerModule.default, codecCalls };
}

async function fetchMetadata(worker: { readonly fetch: GeneratedFetch }, authorized = true): Promise<Response> {
  const response = await worker.fetch(new Request("https://generated.test/__flarex_internal/metadata", {
    headers: authorized ? { authorization: "Bearer fixture-secret" } : {},
  }), { FLAREX_INTERNAL_TOKEN: "fixture-secret" });
  if (!(response instanceof Response)) throw new Error("Generated handler did not return a Response.");
  return response;
}

describe("generated validator literal metadata", () => {
  it("loads exact int64, negative zero, NUL and own __proto__ literals from both generated modules", async () => {
    const modules = await loadGeneratedWorker(analysisFor(literals));
    const metadata = Schema.decodeUnknownSync(Schema.Struct({
      functionMetadata: Schema.Array(Schema.Struct({ args: ValidatorJsonV1, returns: ValidatorJsonV1 })),
    }))(modules.metadataModule);
    const deployment = Schema.decodeUnknownSync(Schema.Struct({
      deploymentSchema: Schema.Struct({ tables: Schema.Array(Schema.Struct({ validator: ValidatorJsonV1 })) }),
    }))(modules.deploymentModule);
    expect(metadata.functionMetadata[0]?.args).toEqual(literals);
    expect(metadata.functionMetadata[0]?.returns).toEqual({ type: "literal", value: 9223372036854775807n });
    expect(deployment.deploymentSchema.tables[0]?.validator).toEqual(literals);
    for (const validator of [metadata.functionMetadata[0]?.args, deployment.deploymentSchema.tables[0]?.validator]) {
      if (validator?.type !== "object" || validator.value.sign?.fieldType.type !== "literal") throw new Error("Generated literal shape was lost.");
      expect(Object.is(validator.value.sign.fieldType.value, -0)).toBe(true);
      expect(Object.hasOwn(validator.value, "__proto__")).toBe(true);
      expect(validator.value.__proto__?.fieldType).toEqual({ type: "literal", value: 1n });
      const nested = validator.value.nested?.fieldType;
      if (nested?.type !== "array" || nested.value.type !== "object") throw new Error("Generated nested literal shape was lost.");
      expect(Object.hasOwn(nested.value.value, "__proto__")).toBe(true);
      const negativeZero = nested.value.value.__proto__?.fieldType;
      if (negativeZero?.type !== "literal") throw new Error("Missing nested signed-zero literal.");
      expect(Object.is(negativeZero.value, -0)).toBe(true);
    }
  });

  it("serves wire literals through the actual generated metadata handler without per-request recapture", async () => {
    const modules = await loadGeneratedWorker(analysisFor(literals));
    const initialCalls = { ...modules.codecCalls };
    const unauthorized = await fetchMetadata(modules.worker, false);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized internal Flarex request." });
    for (let index = 0; index < 2; index += 1) {
      const response = await fetchMetadata(modules.worker);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      const decoded = decodeMetadataResponse(await response.json());
      expect(decoded.schema.tables[0]?.validator).toEqual(literals);
      expect(decoded.functions[0]?.args).toEqual(literals);
      expect(decoded.functions[0]?.returns).toEqual({ type: "literal", value: 9223372036854775807n });
    }
    expect(modules.codecCalls).toEqual(initialCalls);
  });

  it("preserves ordinary metadata response bytes and envelope shape", async () => {
    const ordinary: ObjectValidatorJsonV1 = { type: "object", value: {
      name: { fieldType: { type: "string" }, optional: false },
      count: { fieldType: { type: "literal", value: 1 }, optional: false },
    } };
    const analysis = analysisFor(ordinary, null);
    const modules = await loadGeneratedWorker(analysis);
    const response = await fetchMetadata(modules.worker);
    expect(await response.text()).toBe(JSON.stringify({
      schema: analysis.schema,
      functions: [{ path: "literals:read", kind: "query", visibility: "public", args: ordinary, returns: null, partition: null }],
    }));
  });
});