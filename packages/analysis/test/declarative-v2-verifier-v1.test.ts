import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Encoding, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { afterEach, describe, expect, test } from "vitest";

import { generateDeclarativeV2VerifierV1 } from "../scripts/declarativeV2VerifierV1";
import {
  DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1,
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
  deriveDeclarativeV2VerifierParseArenaStorageV2,
  loadDeclarativeV2VerifierAssetV1,
  loadGeneratedDeclarativeV2VerifierAssetV1,
  planDeclarativeV2VerifierArenaV2,
} from "../src/declarativeV2VerifierV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_ASSET_BASE64_V1,
} from "../src/declarativeV2VerifierV1.generated";

const PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

function generatedAsset(): Uint8Array {
  const decoded = Encoding.decodeBase64(
    GENERATED_DECLARATIVE_V2_VERIFIER_ASSET_BASE64_V1,
  );
  if (Result.isFailure(decoded)) throw decoded.failure;
  return new Uint8Array(decoded.success);
}

function expectFailureReason(
  result: ReturnType<typeof loadDeclarativeV2VerifierAssetV1>,
  reason: string,
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.reason).toBe(reason);
}

function frame(
  kind: "attempt_usage" | "command_budget",
  mutate?: Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>>,
): DeclarativeV2VerifierBudgetFrameV2 {
  const dimensions = Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
      dimension,
      dimension === "tableBytes"
        ? BigInt(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength)
        : dimension === "objectBodyBytes"
        ? 2n
        : dimension === "sourceMapBytes"
        ? 0n
        : 1n,
    ]),
  ) as Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>;
  return Object.freeze({
    kind,
    ...dimensions,
    ...mutate,
  });
}

function plan(
  maximums: DeclarativeV2VerifierBudgetFrameV2,
  required: DeclarativeV2VerifierBudgetFrameV2,
) {
  return planDeclarativeV2VerifierArenaV2({
    maximums,
    required,
    storage: deriveDeclarativeV2VerifierParseArenaStorageV2(required),
  });
}

async function makeGeneratorFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-core-v1-"));
  temporaryDirectories.push(root);
  const packageRoot = resolve(root, "packages/analysis");
  await mkdir(resolve(packageRoot, "src"), { recursive: true });
  await Promise.all([
    cp(resolve(PACKAGE_ROOT, "scripts"), resolve(packageRoot, "scripts"), {
      recursive: true,
    }),
    cp(resolve(PACKAGE_ROOT, "src/declarativeV2VerifierV1.contract.ts"),
      resolve(packageRoot, "src/declarativeV2VerifierV1.contract.ts")),
    cp(resolve(PACKAGE_ROOT, "vendor"), resolve(packageRoot, "vendor"), {
      recursive: true,
    }),
    cp(resolve(PACKAGE_ROOT, "../../pnpm-workspace.yaml"),
      resolve(root, "pnpm-workspace.yaml")),
    cp(resolve(PACKAGE_ROOT, "../../pnpm-lock.yaml"),
      resolve(root, "pnpm-lock.yaml")),
  ]);
  return packageRoot;
}

describe("Declarative V2 verifier Core V1 asset", () => {
  test("regenerates the committed golden twice byte-for-byte", async () => {
    const first = await generateDeclarativeV2VerifierV1(PACKAGE_ROOT);
    const second = await generateDeclarativeV2VerifierV1(PACKAGE_ROOT);
    expect(first.asset).toEqual(second.asset);
    expect(first.source).toBe(second.source);
    expect(first.manifest).toEqual(
      GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
    );
    expect(first.manifest.assetSha256).toBe(
      "00eb1d44298eac350d1e4dcac1d14896b13b8e0d841c8c01108c8a60fca8fc39",
    );
    expect(first.manifest.specificationSha256).toBe(
      "de3de99e65449e9ab0d84a85541a2bf20fc65cf290204852c5032e7dd866e3e9",
    );
    expect(first.manifest.manifestIdentity).toBe(
      "4969b46aa3ebcb82f95d2578b4424515b755d7792304b2a0ffe8f25340cbee30",
    );
    expect(first.manifest.assetByteLength).toBe(83_584);
  });

  test("binds every generation identity input", async () => {
    const baseline = await generateDeclarativeV2VerifierV1(PACKAGE_ROOT);
    const mutations = [
      "src/declarativeV2VerifierV1.contract.ts",
      "scripts/declarativeV2VerifierV1.ts",
      "vendor/unicode-14.0.0/DerivedCoreProperties.txt",
      "vendor/unicode-14.0.0/ReadMe.txt",
      "vendor/unicode-14.0.0/LICENSE.txt",
      "vendor/unicode-14.0.0/PROVENANCE.json",
      "../../pnpm-workspace.yaml",
      "../../pnpm-lock.yaml",
    ] as const;
    for (const relative of mutations) {
      const fixture = await makeGeneratorFixture();
      const path = resolve(fixture, relative);
      if (relative.endsWith("PROVENANCE.json")) {
        const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        value.note = "identity mutation";
        await writeFile(
          path,
          `${JSON.stringify(Object.fromEntries(Object.entries(value).sort()))}`,
          "utf8",
        );
      } else if (relative.endsWith("pnpm-workspace.yaml")) {
        const value = await readFile(path, "utf8");
        await writeFile(path, value.replace('"tsx": "^4.21.0"', '"tsx": "^4.21.1"'));
      } else if (relative.endsWith("pnpm-lock.yaml")) {
        const value = await readFile(path, "utf8");
        const importerStart = value.indexOf("  packages/analysis:");
        const importerEnd = value.indexOf("\n  packages/executor:", importerStart);
        const importer = value.slice(importerStart, importerEnd)
          .replace("version: 4.22.4", "version: 4.22.5");
        await writeFile(
          path,
          `${value.slice(0, importerStart)}${importer}${value.slice(importerEnd)}`,
        );
      } else {
        await writeFile(path, new Uint8Array([
          ...await readFile(path),
          ...new TextEncoder().encode(
            relative.endsWith(".ts") ? "\n// identity mutation\n" : "\n# identity mutation\n",
          ),
        ]));
      }
      if (relative.includes("unicode-14.0.0") &&
        !relative.endsWith("PROVENANCE.json")) {
        const provenancePath = resolve(
          fixture,
          "vendor/unicode-14.0.0/PROVENANCE.json",
        );
        const provenance = JSON.parse(
          await readFile(provenancePath, "utf8"),
        ) as {
          inputs: Array<{ path: string; sha256: string; source: string }>;
          license: string;
          unicodeVersion: string;
        };
        const crypto = await import("node:crypto");
        const input = provenance.inputs.find((candidate) =>
          relative.endsWith(candidate.path)
        );
        if (input === undefined) throw new Error("Missing provenance input.");
        input.sha256 = crypto.createHash("sha256")
          .update(await readFile(path)).digest("hex");
        await writeFile(
          provenancePath,
          JSON.stringify({
            inputs: provenance.inputs,
            license: provenance.license,
            unicodeVersion: provenance.unicodeVersion,
          }),
        );
      }
      const changed = await generateDeclarativeV2VerifierV1(fixture);
      expect(
        changed.manifest.manifestIdentity,
        relative,
      ).not.toBe(baseline.manifest.manifestIdentity);
    }
  });

  test("loads with an exact byte budget and returns an owned snapshot", () => {
    const input = generatedAsset();
    const result = loadDeclarativeV2VerifierAssetV1(input, {
      maximumTableBytes: input.byteLength,
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    expect(result.success.usage.tableBytes).toBe(input.byteLength);
    expect(result.success.sections).toHaveLength(14);
    expect(Object.isFrozen(result.success)).toBe(true);
    expect(Object.isFrozen(result.success.sections)).toBe(true);
    const firstCopy = result.success.copyBytes();
    input.fill(0);
    expect(firstCopy[0]).toBe("F".charCodeAt(0));
    firstCopy[0] = 0;
    expect(result.success.copyBytes()[0]).toBe("F".charCodeAt(0));
    const lexical = result.success.copySectionBytes("lexicalRules");
    expect(lexical).toBeInstanceOf(Uint8Array);
    lexical?.fill(0);
    expect(result.success.copySectionBytes("lexicalRules")?.some((byte) =>
      byte !== 0
    )).toBe(true);
  });

  test("preflights one-less byte admission before copying", () => {
    const input = generatedAsset();
    expectFailureReason(
      loadDeclarativeV2VerifierAssetV1(input, {
        maximumTableBytes: input.byteLength - 1,
      }),
      "budgetExceeded",
    );
    const hostile = new Uint8Array(input);
    Object.defineProperty(hostile, "byteLength", {
      get() {
        throw new Error("must not read an own byteLength");
      },
    });
    expect(Result.isSuccess(loadDeclarativeV2VerifierAssetV1(hostile, {
      maximumTableBytes: hostile.length,
    }))).toBe(true);
  });

  test("rejects malformed structural boundaries and noncanonical content", () => {
    const exact = generatedAsset();
    for (const length of [0, 7, 95, 96, exact.byteLength - 1]) {
      expectFailureReason(
        loadDeclarativeV2VerifierAssetV1(exact.subarray(0, length), {
          maximumTableBytes: exact.byteLength,
        }),
        "malformed",
      );
    }
    const wrongVersion = new Uint8Array(exact);
    wrongVersion[11] = 2;
    expectFailureReason(loadDeclarativeV2VerifierAssetV1(wrongVersion, {
      maximumTableBytes: exact.byteLength,
    }), "unsupportedVersion");
    const misaligned = new Uint8Array(exact);
    misaligned[107] ^= 1;
    expectFailureReason(loadDeclarativeV2VerifierAssetV1(misaligned, {
      maximumTableBytes: exact.byteLength,
    }), "malformed");
    const overlap = new Uint8Array(exact);
    overlap[131] ^= 8;
    expectFailureReason(loadDeclarativeV2VerifierAssetV1(overlap, {
      maximumTableBytes: exact.byteLength,
    }), "malformed");
    const trailing = new Uint8Array(exact.byteLength + 1);
    trailing.set(exact);
    expectFailureReason(loadDeclarativeV2VerifierAssetV1(trailing, {
      maximumTableBytes: trailing.byteLength,
    }), "malformed");
    const content = new Uint8Array(exact);
    const lexicalOffset = new DataView(
      content.buffer,
      content.byteOffset,
      content.byteLength,
    ).getUint32(96 + 2 * 24 + 8, false);
    content[lexicalOffset + 4] ^= 1;
    expectFailureReason(loadDeclarativeV2VerifierAssetV1(content, {
      maximumTableBytes: content.byteLength,
    }), "nonCanonical");
  });

  test("rejects proxies, prototype impostors, detached bytes, and hostile budgets", () => {
    const exact = generatedAsset();
    for (const input of [
      new Proxy(exact, {}),
      Object.create(Uint8Array.prototype),
      { 0: exact[0], byteLength: exact.byteLength },
    ]) {
      expectFailureReason(loadDeclarativeV2VerifierAssetV1(input, {
        maximumTableBytes: exact.byteLength,
      }), "invalidInput");
    }
    const detached = new Uint8Array([1]);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expectFailureReason(loadDeclarativeV2VerifierAssetV1(detached, {
      maximumTableBytes: exact.byteLength,
    }), "invalidInput");
    const hostileBudget = Object.defineProperty({}, "maximumTableBytes", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expectFailureReason(
      loadDeclarativeV2VerifierAssetV1(exact, hostileBudget),
      "invalidBudget",
    );
    for (const budget of [
      new Proxy({}, {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
      }),
      new Proxy({ maximumTableBytes: exact.byteLength }, {
        getOwnPropertyDescriptor() {
          throw new Error("descriptor trap");
        },
      }),
    ]) {
      expectFailureReason(
        loadDeclarativeV2VerifierAssetV1(exact, budget),
        "invalidBudget",
      );
    }
  });

  test("loads the generated asset through the internal owner", () => {
    const result = loadGeneratedDeclarativeV2VerifierAssetV1({
      maximumTableBytes:
        GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength,
    });
    expect(Result.isSuccess(result)).toBe(true);
  });
});

describe("Declarative V2 verifier Core V1 arena planner", () => {
  test("plans all 26 dimensions exactly and freezes owned results", () => {
    const required = frame("attempt_usage");
    const storage = deriveDeclarativeV2VerifierParseArenaStorageV2(required);
    const result = plan(frame("command_budget"), required);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    expect(result.success.requiredBytes).toBeGreaterThan(12_544);
    expect(result.success.regions).toHaveLength(16);
    expect(result.success.regions.map(({ name }) => name)).not.toContain(
      "objectBodyBytesStorage",
    );
    expect(result.success.regions.map(({ name }) => name)).not.toContain(
      "canonicalBytesStorage",
    );
    expect(
      Object.fromEntries(
        result.success.regions
          .filter(({ name }) => name.endsWith("Storage"))
          .map(({ name, byteLength }) => [name, BigInt(byteLength)]),
      ),
    ).toEqual(storage);
    expect(Object.isFrozen(result.success)).toBe(true);
    expect(Object.isFrozen(result.success.regions)).toBe(true);
    expect(Object.isFrozen(result.success.usage)).toBe(true);
  });

  test("fails exact one-less admission for every budget dimension", () => {
    const required = frame("attempt_usage");
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      if (required[dimension] === 0n) continue;
      const result = plan(
        frame("command_budget", {
          [dimension]: required[dimension] - 1n,
        }),
        required,
      );
      expect(Result.isFailure(result), dimension).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason, dimension).toBe("budgetExceeded");
        expect(result.failure.path, dimension).toBe(dimension);
      }
    }
  });

  test("rejects source-map work because authoritative positions are omitted", () => {
    const result = plan(
      frame("command_budget", { sourceMapBytes: 1n, objectBodyBytes: 3n }),
      frame("attempt_usage", { sourceMapBytes: 1n, objectBodyBytes: 3n }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("invalidInput");
      expect(result.failure.path).toBe("sourceMapBytes");
    }
  });

  test("rejects invalid shapes, accessors, address overflow, and arithmetic overflow", () => {
    expect(Result.isFailure(planDeclarativeV2VerifierArenaV2({}))).toBe(true);
    const hostile = Object.defineProperty({
      maximums: frame("command_budget"),
    }, "required", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expect(Result.isFailure(planDeclarativeV2VerifierArenaV2(hostile))).toBe(true);
    for (const input of [
      new Proxy({}, {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
      }),
      new Proxy({
        maximums: frame("command_budget"),
        required: frame("attempt_usage"),
      }, {
        getOwnPropertyDescriptor() {
          throw new Error("descriptor trap");
        },
      }),
    ]) {
      const result = planDeclarativeV2VerifierArenaV2(input);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("invalidInput");
      }
    }
    const hostileMaximums = new Proxy(frame("command_budget"), {
      ownKeys() {
        throw new Error("nested ownKeys trap");
      },
    });
    const nestedRequiredFrame = frame("attempt_usage");
    const nested = planDeclarativeV2VerifierArenaV2({
      maximums: hostileMaximums,
      required: nestedRequiredFrame,
      storage: deriveDeclarativeV2VerifierParseArenaStorageV2(
        nestedRequiredFrame,
      ),
    });
    expect(Result.isFailure(nested)).toBe(true);
    if (Result.isFailure(nested)) {
      expect(nested.failure.reason).toBe("invalidBudget");
    }
    const hostileRequired = new Proxy(frame("attempt_usage"), {
      getOwnPropertyDescriptor() {
        throw new Error("nested descriptor trap");
      },
    });
    const nestedRequired = planDeclarativeV2VerifierArenaV2({
      maximums: frame("command_budget"),
      required: hostileRequired,
      storage: deriveDeclarativeV2VerifierParseArenaStorageV2(
        frame("attempt_usage"),
      ),
    });
    expect(Result.isFailure(nestedRequired)).toBe(true);
    if (Result.isFailure(nestedRequired)) {
      expect(nestedRequired.failure.reason).toBe("invalidBudget");
    }
    const address = plan(
      frame("command_budget", { tokens: 0x1_0000_0000n }),
      frame("attempt_usage", { tokens: 0x1_0000_0000n }),
    );
    expect(Result.isFailure(address)).toBe(true);
    if (Result.isFailure(address)) {
      expect(address.failure.reason).toBe("addressabilityExceeded");
    }
    const overflowRequired = frame("attempt_usage");
    const overflow = planDeclarativeV2VerifierArenaV2({
      maximums: frame("command_budget"),
      required: overflowRequired,
      storage: Object.freeze({
        ...deriveDeclarativeV2VerifierParseArenaStorageV2(overflowRequired),
        tokenBytesStorage: 9_223_372_036_854_775_807n,
      }),
    });
    expect(Result.isFailure(overflow)).toBe(true);
    if (Result.isFailure(overflow)) {
      expect(overflow.failure.reason).toBe("overflow");
    }
  });

  test("pins host failures and full Cause as uncatchable diagnostics", () => {
    const rules = DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.operationalRules;
    expect(rules.find((rule) => rule.code === "errors.host")?.rule)
      .toContain("uncatchable");
    expect(rules.find((rule) => rule.code === "errors.hostDependency")?.rule)
      .toContain("finally");
    expect(
      DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.diagnostics.find(
        (diagnostic) => diagnostic.code === "CORE_HOST_FAILURE_OBSERVATION",
      )?.order,
    ).toBe(16);
  });

  test("runtime-freezes every identity-bearing contract and manifest layer", () => {
    expect(Object.isFrozen(DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1)).toBe(true);
    expect(Object.isFrozen(DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.arena))
      .toBe(true);
    expect(Object.isFrozen(
      DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.arena.widths,
    )).toBe(true);
    expect(Object.isFrozen(
      DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.arena.widths[0],
    )).toBe(true);
    expect(Object.isFrozen(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1))
      .toBe(true);
    expect(Object.isFrozen(
      GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.unicodeInputs,
    )).toBe(true);
    expect(Object.isFrozen(
      GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.toolchain,
    )).toBe(true);
    expect(Reflect.set(
      DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.arena.widths[0],
      "bytes",
      1,
    )).toBe(false);
    expect(
      DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.arena.widths[0].bytes,
    ).toBe(56);
  });

  test("keeps the owner on the intentional internal subpath only", async () => {
    const root = await import("@flarex/analysis");
    expect("loadDeclarativeV2VerifierAssetV1" in root).toBe(false);
    const internal = await import(
      "@flarex/analysis/internal/declarative-v2-verifier-v1"
    );
    expect(internal.loadDeclarativeV2VerifierAssetV1).toBeTypeOf("function");
  });
});
