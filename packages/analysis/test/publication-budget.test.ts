import { Result } from "effect";
import { expect, it } from "vitest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { canonicalizeApplicationManifestV1 } from "../src/applicationAnalysisV1";
import type { ApplicationManifestV2 } from "../src/applicationAnalysisV2";
import { applicationFunctionCatalogPublicationFrameV1, applicationFunctionEntryPublicationFrameV1,
  applicationSchemaPublicationFrameV1, type ApplicationPublicationFrameV1Error } from "../src/applicationPublicationFramesV1";
import { applicationFunctionCatalogPublicationFrameV2, applicationFunctionEntryPublicationFrameV2,
  applicationSchemaPublicationFrameV2, type ApplicationPublicationFrameV2Error,
  type ApplicationSchemaPublicationFrameV2Error } from "../src/applicationPublicationFramesV2";

it("refuses expanded DAG publication frames at their actual byte budget before materializing them", () => {
  const base = Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest", version: 1,
    sourceArtifact: { rootSha256: "1".repeat(64), executionModulePath: "_flarex/execution.js", schemaModulePath: "_flarex/schema.js",
      modules: [{ path: "_flarex/execution.js", roles: 8, sourceSha256: "2".repeat(64), sourceByteLength: 48 },
        { path: "_flarex/schema.js", roles: 2, sourceSha256: "3".repeat(64), sourceByteLength: 48 }] },
    schema: { version: 1, tables: [], indexes: [] },
    functions: [{ path: "items:query", moduleName: "items", exportName: "query", kind: "query", visibility: "public",
      args: { type: "object", value: {} }, returns: null, partition: null }],
  })).manifest;
  const baseV2: ApplicationManifestV2 = { ...base, version: 2,
    schema: { ...base.schema, version: 2, relations: [] } };
  let payload: ValidatorJsonV1 = { type: "string" };
  for (let index = 0; index < 40; index++) payload = { type: "union", value: [payload, payload] };
  const first = base.functions[0];
  if (first === undefined) throw new Error("Missing query fixture");
  const fn = { ...first, args: payload };
  const table = { tableId: 1, name: "items", placement: { kind: "global" as const },
    validator: { type: "object" as const, value: { payload: { fieldType: payload, optional: false } } } };
  const frames: readonly Result.Result<Uint8Array, ApplicationPublicationFrameV1Error
    | ApplicationPublicationFrameV2Error | ApplicationSchemaPublicationFrameV2Error>[] = [
    applicationFunctionCatalogPublicationFrameV1({ ...base, functions: [fn] }),
    applicationFunctionEntryPublicationFrameV1(fn),
    applicationSchemaPublicationFrameV1({ ...base, schema: { ...base.schema, tables: [table] } }),
    applicationFunctionCatalogPublicationFrameV2({ functions: [fn] }),
    applicationFunctionEntryPublicationFrameV2(fn),
    applicationSchemaPublicationFrameV2({ ...baseV2, schema: { ...baseV2.schema, tables: [table] } }),
  ];
  for (const frame of frames) expect(Result.isFailure(frame) && frame.failure).toMatchObject({ reason: "bytesExceeded" });
});
