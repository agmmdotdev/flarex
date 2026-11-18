import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalizeApplicationManifest } from "@flarex/analysis/application-analysis";
import { Effect, Result, Schema } from "effect";
import { expect, it } from "vitest";
import { CoreProgramIdentitySchema } from "../../src/core/api";
import { captureCoreObject } from "../../src/core/document";
import { readCoreApplicationProgram } from "../../src/application/coreProgram";
import { readLegacyApplicationProgramManifest } from "../../src/application/LegacyApplicationProgramIdentity";

const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const FrozenPrograms = Schema.Struct({ sourceCommit: Schema.Literal("8b52e473dfd66d8b8d7655bf865abc147ba1b154"),
  manifest: Schema.Struct({ schema: Schema.Struct({ tables: Schema.Array(Schema.Struct({ validator: Schema.Unknown })) }) }),
  programs: Schema.Array(Schema.Struct({ identity: CoreProgramIdentitySchema, metadata: Schema.Unknown })) });

it("authenticates baseline production hashes without fresh filtering or name validation of retained table validators", async () => {
  const captured = Schema.decodeUnknownSync(FrozenPrograms)(JSON.parse(await readFile(
    new URL("./fixtures/pre09-underscore-programs.json", import.meta.url), "utf8")));
  for (const frozen of captured.programs) {
    const metadata = Result.getOrThrow(captureCoreObject(frozen.metadata, true)).value;
    const authenticated = await Effect.runPromise(readCoreApplicationProgram({ identity: frozen.identity, metadata }, hash));
    expect(authenticated.definition.identity).toEqual(frozen.identity);
    expect(authenticated.validatorIdentityEncoding).toBe(1);
    expect(authenticated.manifest.schema.tables[0]?.validator).toEqual(captured.manifest.schema.tables[0]?.validator);
    const validator = authenticated.manifest.schema.tables[0]?.validator;
    expect(validator?.type).toBe("object");
    if (validator?.type === "object") {
      expect(Object.hasOwn(validator.value, "_custom")).toBe(true);
      expect(Object.hasOwn(validator.value, "_nested")).toBe(true);
    }
    // The fresh Source owner correctly refuses this old child name before its
    // parent underscore field would be removed. Historical authentication must
    // never pass the retained bytes through that fresh admission pipeline.
    expect(Result.isFailure(canonicalizeApplicationManifest(authenticated.manifest))).toBe(true);
    const { validatorIdentityEncoding: _current, ...legacy } = authenticated.manifest;
    expect(Result.isFailure(readLegacyApplicationProgramManifest({ ...legacy, schema: { ...legacy.schema,
      tables: legacy.schema.tables.map(table => ({ ...table, validator: { type: "object", value: {
        _custom: { fieldType: { type: "literal", value: Infinity }, optional: true },
      } } })),
    } }))).toBe(true);
  }
});
