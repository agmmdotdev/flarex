import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ApplicationManifestV1Schema,
  canonicalizeApplicationManifestV1,
  canonicalizeApplicationManifestWireV1,
} from "../src/applicationAnalysis";
import {
  applicationFunctionCatalogPublicationFrameV1,
  applicationFunctionEntryPublicationFrameV1,
  applicationSchemaPublicationFrameV1,
} from "../src/applicationPublicationFramesV1";
import { canonicalizeApplicationRuntimeTargetV1, applicationRuntimeTargetWireV1 } from "flarex-protocol/internal/application-runtime-target-v1";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  canonicalizeApplicationMutationExecutionAuthorityWireV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import { isJson } from "flarex-protocol/json";
import type { ValidatorLiteralV1 } from "flarex-protocol/validator-json";
import { captureSchemaManifestAppTableDeclarationsV1Result } from "flarex-protocol/schema-manifest";
import { encodeLogicalSchemaCandidate, decodeLogicalSchemaCandidate, type LogicalSchemaCandidate } from "flarex-protocol/internal/logical-schema-candidate";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate, readPreparedLogicalSchemaCandidate } from "../src/logicalSchemaCandidate";

const text = new TextDecoder();
const values = [-9_223_372_036_854_775_808n, 9_223_372_036_854_775_807n, 1n, 1, -0, 0];
const digest = (digit: string) => digit.repeat(64);

describe("Application numeric literal publication", () => {
  it("preserves numeric source digests through the committed Application V2 candidate path", async () => {
    const digests: string[] = [];
    for (const value of [1, 1n, 0, -0]) {
      const tables = Result.getOrThrow(captureSchemaManifestAppTableDeclarationsV1Result([{ logicalName: "records",
        definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object", value: {
          value: { fieldType: { type: "literal", value }, optional: false },
        } } },
      }]));
      const source = await Effect.runPromise(captureLogicalSchemaSource({
        key: "application", owner: "application", evidence: { fixture: "numeric-literal-identity" }, writeProfile: "application.occ",
        definition: { kind: "documents", tables, indexes: [], uniqueConstraints: [], relations: [] },
        bindings: [{ kind: "definition", localName: "records", table: { namespace: "app", logicalName: "records" } }],
      }));
      digests.push(source.sourceSha256);
      const candidate: LogicalSchemaCandidate = {
        kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate", deploymentId: "deployment", scopeId: "scope",
        applicationAnalysis: { candidateId: "candidate", analysisId: "analysis", manifestSha256: digest("a"), sourceArtifactRootSha256: digest("b") },
        sources: [source], extensions: [],
      };
      const wire = encodeLogicalSchemaCandidate(candidate);
      const parsed: unknown = JSON.parse(JSON.stringify(wire));
      const reopened = Result.getOrThrow(decodeLogicalSchemaCandidate(parsed));
      const prepared = await Effect.runPromise(prepareLogicalSchemaCandidate(reopened));
      const read = await Effect.runPromise(readPreparedLogicalSchemaCandidate(prepared));
      expect(read.definitionVersion).toBe(2);
      expect(encodeLogicalSchemaCandidate(read)).toEqual(wire);
      expect(read.sources[0]?.sourceSha256).toBe(source.sourceSha256);
      const definition = read.sources[0]?.definition;
      if (definition?.kind !== "documents") throw new Error("Expected document source");
      const field = definition.tables[0]?.definition.documentType.value.value;
      if (field?.fieldType.type !== "literal") throw new Error("Expected literal source field");
      expect(Object.is(field.fieldType.value, value)).toBe(true);
    }
    expect(new Set(digests).size).toBe(4);
  });
  it("preserves every numeric literal through manifest, codec and publication frames", () => {
    const identities = values.map(value => {
      const canonical = Result.getOrThrow(canonicalizeApplicationManifestV1(manifest(value)));
      const wire: unknown = JSON.parse(canonical.canonicalText);
      const reopened = Result.getOrThrow(canonicalizeApplicationManifestWireV1(wire));
      expect(reopened.canonicalBytes).toEqual(canonical.canonicalBytes);
      expect(Schema.encodeSync(ApplicationManifestV1Schema)(canonical.manifest)).toEqual(wire);
      const fn = reopened.manifest.functions[0];
      if (fn === undefined || fn.returns?.type !== "literal") throw new Error("Expected literal return");
      expect(Object.is(fn.returns.value, value)).toBe(true);
      const table = reopened.manifest.schema.tables[0];
      if (table?.validator.type !== "object") throw new Error("Expected object validator");
      const field = table.validator.value.value;
      if (field?.fieldType.type !== "literal") throw new Error("Expected literal field");
      expect(Object.is(field.fieldType.value, value)).toBe(true);
      return [canonical.canonicalText,
        text.decode(Result.getOrThrow(applicationSchemaPublicationFrameV1(canonical.manifest))),
        text.decode(Result.getOrThrow(applicationFunctionCatalogPublicationFrameV1(canonical.manifest))),
        text.decode(Result.getOrThrow(applicationFunctionEntryPublicationFrameV1(fn)))];
    });
    for (const index of [0, 1, 2, 3]) expect(new Set(identities.map(identity => identity[index])).size).toBe(values.length);
    expect(isJson(manifest(1n))).toBe(false);
    expect(Result.isFailure(canonicalizeApplicationManifestWireV1(manifest(1n)))).toBe(true);
  });

  it("keeps ordinary and NUL string bytes in the established manifest representation", () => {
    const canonical = Result.getOrThrow(canonicalizeApplicationManifestV1(manifest("nul\0text")));
    expect(canonical.canonicalText).toContain('"value":"nul\\u0000text"');
    expect(canonical.canonicalText).not.toContain('"$string"');
    expect(Result.getOrThrow(canonicalizeApplicationManifestWireV1(JSON.parse(canonical.canonicalText))).canonicalText)
      .toBe(canonical.canonicalText);
  });

  it("rejects nonfinite literals only at complete analyzed metadata admission", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(Result.isFailure(canonicalizeApplicationManifestV1(manifest(value)))).toBe(true);
    }
  });

  it("authenticates the encoded target on cold authority reconstruction and rejects literal tampering", async () => {
    for (const value of values) {
      const fn = manifest(value).functions[0];
      if (fn === undefined) throw new Error("Expected function");
      const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
        format: "flarex.application-runtime-target", version: 1,
        scopeId: "scope", revisionId: "revision", candidateId: "candidate", analysisId: "analysis",
        sourceArtifactRootSha256: digest("1"), manifestSha256: digest("2"), schemaSha256: digest("3"),
        functionCatalogSha256: digest("4"), publicationSha256: digest("5"),
        executionModulePath: "_flarex/execution.js", function: { ...fn, entrySha256: digest("6") },
      }));
      const runtimeTargetSha256 = Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(target.canonicalBytes).buffer)).toString("hex");
      const authority = await Effect.runPromise(canonicalizeApplicationMutationExecutionAuthorityV1({
        format: "flarex.application-mutation-execution-authority", version: 1, runtimeTarget: target.target,
        runtimeTargetSha256, activationSequence: "1", activeHeadSha256: digest("7"), schemaVersionId: "schema",
      }));
      const reopened = await Effect.runPromise(canonicalizeApplicationMutationExecutionAuthorityWireV1(
        JSON.parse(JSON.stringify(authority.authorityJson)),
      ));
      expect(reopened.canonicalBytes).toEqual(authority.canonicalBytes);
      const returns = reopened.authority.runtimeTarget.function.returns;
      if (returns?.type !== "literal") throw new Error("Expected literal return");
      expect(Object.is(returns.value, value)).toBe(true);
      const tampered = { ...authority.authorityJson, runtimeTarget: applicationRuntimeTargetWireV1({ ...target.target,
        function: { ...target.target.function, returns: { type: "literal", value: "tampered" } },
      }) };
      const rejected = await Effect.runPromise(Effect.result(canonicalizeApplicationMutationExecutionAuthorityWireV1(tampered)));
      expect(Result.isFailure(rejected)).toBe(true);
      if (Result.isFailure(rejected)) expect(rejected.failure.reason).toBe("runtimeTargetDigestMismatch");
    }
  });
});

function manifest(value: ValidatorLiteralV1) {
  return {
    format: "flarex.application-manifest", version: 1,
    sourceArtifact: {
      rootSha256: digest("1"), executionModulePath: "_flarex/execution.js", schemaModulePath: "_flarex/schema.js",
      modules: [{ path: "_flarex/execution.js", roles: 8, sourceSha256: digest("2"), sourceByteLength: 1 },
        { path: "_flarex/schema.js", roles: 2, sourceSha256: digest("3"), sourceByteLength: 1 }],
    },
    schema: { version: 1, tables: [{ tableId: 1, name: "literalDocs", placement: { kind: "global" },
      validator: { type: "object", value: { value: { fieldType: { type: "literal", value }, optional: false } } },
    }], indexes: [] },
    functions: [{ path: "literal:run", moduleName: "literal", exportName: "run", kind: "mutation", visibility: "public",
      args: { type: "object", value: { value: { fieldType: { type: "literal", value }, optional: false } } },
      returns: { type: "literal", value }, partition: null,
    }],
  };
}