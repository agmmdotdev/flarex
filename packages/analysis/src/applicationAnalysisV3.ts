import { Effect, Option, Result, Schema, SchemaGetter, SchemaIssue } from "effect";
import { encodeCanonicalJson, isJson, measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";

import {
  APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1,
  APPLICATION_MANIFEST_FORMAT_V1,
  ApplicationAnalysisContractError,
  type ApplicationManifestV1,
} from "./applicationAnalysisV1.ts";
import {
  decodeApplicationManifestRelationParts,
  strictOwnDataProperties,
  type ApplicationManifestV2,
} from "./applicationAnalysisV2.ts";
import { decodeApplicationWritePolicies } from "./applicationWritePolicy/capture.ts";
import type { ApplicationWritePolicyError, ApplicationWritePolicies } from "./applicationWritePolicy/model.ts";
import { validateApplicationWritePolicySchema } from "./applicationWritePolicy/schemaCompatibility.ts";
import { verifyApplicationWritePolicies } from "./applicationWritePolicy/verification.ts";

/** Encoded policy authority has a separate contract from the V1/V2 manifests. */
export interface ApplicationManifestV3 {
  readonly format: typeof APPLICATION_MANIFEST_FORMAT_V1;
  readonly version: 3;
  readonly sourceArtifact: ApplicationManifestV1["sourceArtifact"];
  readonly schema: Readonly<{
    readonly version: 3;
    readonly tables: ApplicationManifestV1["schema"]["tables"];
    readonly indexes: ApplicationManifestV1["schema"]["indexes"];
    readonly relations: ApplicationManifestV2["schema"]["relations"];
    readonly writePolicies: ApplicationWritePolicies;
    readonly writePolicySetSha256: string;
  }>;
  readonly functions: ApplicationManifestV1["functions"];
}

export interface CanonicalApplicationManifestV3 {
  readonly manifest: ApplicationManifestV3;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
}

export const ApplicationManifestV3Schema = Schema.Unknown.pipe(Schema.decodeTo(
  Schema.declare<ApplicationManifestV3>((value): value is ApplicationManifestV3 =>
    Result.isSuccess(decodeApplicationManifestV3(value))),
  {
    decode: SchemaGetter.transformOrFail<ApplicationManifestV3, unknown>(value =>
      Result.match(decodeApplicationManifestV3(value), {
        onSuccess: Effect.succeed,
        onFailure: failure => Effect.fail(new SchemaIssue.InvalidValue(
          Option.some(value), { message: `Invalid Application V3: ${failure.reason}` },
        )),
      })),
    encode: SchemaGetter.transform(value => structuredClone(value)),
  },
));

export function decodeApplicationManifestV3(
  value: unknown,
): Result.Result<ApplicationManifestV3, ApplicationAnalysisContractError> {
  return Result.gen(function* () {
    const outer = yield* strictOwnDataProperties(value,
      ["format", "version", "sourceArtifact", "schema", "functions"], "manifest", "decodeManifest");
    const schema = yield* strictOwnDataProperties(outer.get("schema"),
      ["version", "tables", "indexes", "relations", "writePolicies", "writePolicySetSha256"], "schema", "decodeManifest");
    if (outer.get("format") !== APPLICATION_MANIFEST_FORMAT_V1 ||
      outer.get("version") !== 3 || schema.get("version") !== 3) {
      return yield* Result.fail(new ApplicationAnalysisContractError({
        operation: "decodeManifest", reason: "invalidInput", path: "version",
      }));
    }
    const { base, relations } = yield* decodeApplicationManifestRelationParts(outer, schema, "decodeManifest", true);
    const writePolicySetSha256 = schema.get("writePolicySetSha256");
    if (typeof writePolicySetSha256 !== "string" || !/^[0-9a-f]{64}$/.test(writePolicySetSha256)) {
      return yield* Result.fail(new ApplicationAnalysisContractError({
        operation: "decodeManifest", reason: "invalidInput", path: "schema.writePolicySetSha256",
      }));
    }
    const writePolicies = yield* decodeApplicationWritePolicies(
      schema.get("writePolicies"), base.schema.tables.map(table => table.name),
    ).pipe(Result.mapError(policyContractError));
    yield* validateApplicationWritePolicySchema(writePolicies, base.schema.tables).pipe(Result.mapError(policyContractError));
    return Object.freeze({
      format: APPLICATION_MANIFEST_FORMAT_V1,
      version: 3,
      sourceArtifact: base.sourceArtifact,
      schema: Object.freeze({
        version: 3,
        tables: base.schema.tables,
        indexes: base.schema.indexes,
        relations,
        writePolicies,
        writePolicySetSha256,
      }),
      functions: base.functions,
    });
  });
}

export function canonicalizeApplicationManifestV3(
  value: unknown,
): Result.Result<CanonicalApplicationManifestV3, ApplicationAnalysisContractError> {
  return decodeApplicationManifestV3(value).pipe(Result.flatMap(manifest => {
    if (!isJson(manifest)) throw new Error("Decoded Application V3 lost JSON");
    const size = measureCanonicalJsonUtf8Bytes(manifest, APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1);
    if (size.kind !== "success") return Result.fail(new ApplicationAnalysisContractError({
      operation: "encodeManifest", reason: "manifestBytesExceeded",
    }));
    const canonicalText = encodeCanonicalJson(manifest, issue => {
      throw new Error(`Application V3 canonical invariant: ${issue.reason}`);
    });
    const bytes = new TextEncoder().encode(canonicalText);
    return Result.succeed(Object.freeze({
      manifest, canonicalText,
      get canonicalBytes(): Uint8Array { return bytes.slice(); },
    }));
  }));
}

/** The asynchronous admission boundary authenticates all configuration references. */
export const verifyApplicationManifestV3 = Effect.fn("ApplicationAnalysis.verifyPolicyManifest")(
  function* (value: unknown): Effect.fn.Return<CanonicalApplicationManifestV3, ApplicationAnalysisContractError> {
    const canonical = yield* Effect.fromResult(canonicalizeApplicationManifestV3(value));
    const verified = yield* verifyApplicationWritePolicies(canonical.manifest.schema.writePolicies,
      canonical.manifest.schema.tables.map(table => table.name)).pipe(Effect.mapError(policyContractError));
    if (verified.policySetSha256 !== canonical.manifest.schema.writePolicySetSha256) {
      return yield* Effect.fail(new ApplicationAnalysisContractError({
        operation: "decodeManifest", reason: "invalidSchemaRelationship", path: "schema.writePolicySetSha256",
      }));
    }
    return canonical;
  },
);

export const makeApplicationManifestV3 = Effect.fn("ApplicationAnalysis.makePolicyManifest")(
  function* (
    base: ApplicationManifestV1,
    relations: ApplicationManifestV2["schema"]["relations"],
    policyInput: unknown,
  ): Effect.fn.Return<CanonicalApplicationManifestV3, ApplicationAnalysisContractError> {
    const verified = yield* verifyApplicationWritePolicies(policyInput, base.schema.tables.map(table => table.name))
      .pipe(Effect.mapError(policyContractError));
    return yield* Effect.fromResult(canonicalizeApplicationManifestV3({
      ...base,
      version: 3,
      schema: {
        ...base.schema,
        version: 3,
        relations,
        writePolicies: verified.policies,
        writePolicySetSha256: verified.policySetSha256,
      },
    }));
  },
);

function policyContractError(cause: ApplicationWritePolicyError): ApplicationAnalysisContractError {
  return new ApplicationAnalysisContractError({
    operation: "decodeManifest",
    reason: cause.reason === "limitExceeded" ? "limitExceeded" : "invalidSchemaRelationship",
    path: `schema.writePolicies.${cause.path}`,
    cause,
  });
}
