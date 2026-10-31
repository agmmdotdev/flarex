import { createHash } from "node:crypto";
import { canonicalizeApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { canonicalizeApplicationRuntimeTargetV1, applicationRuntimeTargetWireV1 } from "flarex-protocol/internal/application-runtime-target-v1";
import { makeCoreApplicationPrograms, readCoreApplicationProgram } from "../../src/application/coreProgram";

const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const manifest = Result.getOrThrow(canonicalizeApplicationManifestV1({
  format: "flarex.application-manifest", version: 1,
  sourceArtifact: { rootSha256: "1".repeat(64), executionModulePath: "_flarex/execution.js", schemaModulePath: null,
    modules: [{ path: "_flarex/execution.js", roles: 8, sourceSha256: "2".repeat(64), sourceByteLength: 48 },
      { path: "items.js", roles: 1, sourceSha256: "3".repeat(64), sourceByteLength: 48 }] },
  schema: { version: 1, tables: [], indexes: [] },
  functions: ["internal", "public"].flatMap(visibility => ["mutation", "query"].map(kind => ({
    path: `items:${visibility}${kind}`, moduleName: "items", exportName: `${visibility}${kind}`,
    kind, visibility, args: { type: "object", value: {} }, returns: null, partition: null,
  }))),
})).manifest;
const configuration = { manifest, scopeUuid: "45000000-0000-4000-8000-000000000001",
  epochUuid: "45000000-0000-4000-8000-000000000002", compatibilityDate: "2026-06-14", sha256: hash };

describe("shared verified Application programs", () => {
  it("stores a declaration with more than1024 fields as JSON text within the unchanged metadata value boundary", async () => {
    const fields = Object.fromEntries(Array.from({ length: 1025 }, (_value, index) => [`f${index}`,
      { fieldType: { type: "null" }, optional: false }]));
    const fn = manifest.functions[0];
    if (fn === undefined) throw new Error("Missing baseline function");
    await Effect.runPromise(Effect.gen(function* () {
      const [definition] = yield* makeCoreApplicationPrograms({ ...configuration, manifest: {
        ...manifest, functions: [{ ...fn, args: { type: "object", value: fields } }],
      } });
      if (definition === undefined) throw new Error("Missing constructed declaration");
      expect(typeof definition.metadata.manifest).toBe("string");
      const program = yield* readCoreApplicationProgram(definition, hash);
      expect(program.runtimeTarget.function.args.type).toBe("object");
      if (program.runtimeTarget.function.args.type === "object") expect(Object.keys(program.runtimeTarget.function.args.value)).toHaveLength(1025);
    }));
  });
  it("produces public/internal queries directly and retains the real mutation authority format", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const definitions = yield* makeCoreApplicationPrograms(configuration);
      expect(definitions).toHaveLength(4);
      for (const definition of definitions) {
        const program = yield* readCoreApplicationProgram(definition, hash);
        expect(program.runtimeTarget.function.visibility).toBe(definition.identity.functionPath.includes("internal") ? "internal" : "public");
        if (program.kind === "query") {
          expect(Object.hasOwn(definition.metadata, "executionAuthority")).toBe(false);
          expect(Object.hasOwn(program, "executionAuthority")).toBe(false);
        } else {
          expect(program.executionAuthority.authority.format).toBe("flarex.application-mutation-execution-authority");
          expect(definition.identity.programHash).toBe(encodeBytesToLowercaseHex(program.executionAuthority.sha256));
        }
      }
    }));
  });

  it("rejects self-consistent query identity hashes with forged function visibility or publication commitments", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const definitions = yield* makeCoreApplicationPrograms(configuration);
      const definition = definitions.find(candidate => candidate.identity.functionPath === "items:publicquery");
      if (definition === undefined) throw new Error("Missing public query");
      const program = yield* readCoreApplicationProgram(definition, hash);
      for (const runtimeTarget of [
        { ...program.runtimeTarget, function: { ...program.runtimeTarget.function, visibility: "internal" } },
        { ...program.runtimeTarget, publicationSha256: "f".repeat(64) },
      ]) {
        const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1(runtimeTarget));
        const changed = { identity: { ...definition.identity,
          programHash: encodeBytesToLowercaseHex(yield* hash(target.canonicalBytes)) },
          metadata: { ...definition.metadata, runtimeTarget: JSON.stringify(applicationRuntimeTargetWireV1(target.target)) } };
        const result = yield* Effect.result(readCoreApplicationProgram(changed, hash));
        expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "metadataInvalid" });
      }
    }));
  });

  it("publishes only the closed current string envelope and refuses unknown or mixed identity generations", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const definitions = yield* makeCoreApplicationPrograms(configuration);
      for (const definition of definitions) {
        expect(definition.metadata).toMatchObject({ format: "flarex.core-application-program", version: 1, validatorIdentityEncoding: 2 });
        expect(typeof definition.metadata.manifest).toBe("string");
        const program = yield* readCoreApplicationProgram(definition, hash);
        expect(program.validatorIdentityEncoding).toBe(2);
        expect(program.runtimeTarget.validatorIdentityEncoding).toBe(2);
        for (const metadata of [{ ...definition.metadata, validatorIdentityEncoding: 3 },
          { ...definition.metadata, format: "unknown" }, { ...definition.metadata, version: 2 },
          { ...definition.metadata, extra: true }]) {
          const result = yield* Effect.result(readCoreApplicationProgram({ ...definition, metadata }, hash));
          expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "metadataInvalid" });
        }
      }
    }));
  });

  it("keeps fixed mutation authority distinct from an identical query republish", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const original = yield* makeCoreApplicationPrograms(configuration);
      const republished = yield* makeCoreApplicationPrograms({ ...configuration, generation: 2 });
      for (const definition of original) {
        const next = republished.find(candidate => candidate.identity.functionPath === definition.identity.functionPath);
        if (next === undefined) throw new Error("Missing republished program");
        const program = yield* readCoreApplicationProgram(definition, hash);
        if (program.kind === "query") expect(next.identity).toEqual(definition.identity);
        else expect(next.identity.programHash).not.toBe(definition.identity.programHash);
      }
    }));
  });
});
