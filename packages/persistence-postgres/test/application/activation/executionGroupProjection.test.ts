import { createHash, webcrypto } from "node:crypto";
import {
  canonicalizeApplicationManifest,
  verifyApplicationManifestV3,
  type ApplicationManifest,
} from "@flarex/analysis/application-analysis";
import { applicationFunctionCatalogPublicationFrameV1 } from "@flarex/analysis/internal/application-publication-v1";
import {
  applicationFunctionCatalogPublicationFrameV2,
  applicationSchemaPublicationFrame,
} from "@flarex/analysis/internal/application-publication-v2";
import { Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareApplicationExecutionMetadataProjection } from "../../../src/application/activation/metadataProjection";
import {
  disposeFiniteMetadataProjection,
  finiteMetadataContractKey,
  prepareFiniteMetadataEntryComparison,
} from "../../../src/execution/finiteMetadataDependencies";
import { runEffect } from "../../support/effectTestRuntime";
import { relationManifestV2 } from "../applicationAnalysisRegistrationTestSupport";
import { policyManifestFixture } from "../ownership/applicationWritePolicyFixture";
import {
  applicationManifest,
  COMPATIBILITY_DATE,
  ROOT,
  RUNTIME_HOST_IDENTITY,
} from "../support/readinessArtifacts";

type ManifestFunction = ApplicationManifest["functions"][number];

const rootFunction = {
  path: "functions:root", moduleName: "functions", exportName: "root",
  kind: "query", visibility: "public", args: { type: "any" }, returns: null, partition: null,
} satisfies ManifestFunction;
const childFunction = {
  path: "functions:target", moduleName: "functions", exportName: "target",
  kind: "mutation", visibility: "internal", args: { type: "any" }, returns: null, partition: null,
} satisfies ManifestFunction;

beforeAll(() => {
  if (globalThis.crypto === undefined) Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
});

describe("Application execution-group catalog projection", () => {
  it.each([1, 2, 3] as const)("V%i includes child callable semantics while preserving the selected root", async version => {
    const original = await manifestForVersion(version);
    const baseline = await project(original);
    const partitionTable = original.schema.tables[0];
    if (partitionTable === undefined) throw new Error("Expected the canonical fixture's partition table");
    const changes: readonly Readonly<{ name: string; patch: Partial<ManifestFunction> }>[] = [
      { name: "args", patch: { args: { type: "object", value: { title: { fieldType: { type: "string" }, optional: false } } } } },
      { name: "returns", patch: { returns: { type: "string" } } },
      { name: "kind", patch: { kind: "query" } },
      { name: "visibility expansion", patch: { visibility: "public" } },
      { name: "path and export", patch: { path: "functions:updated", exportName: "updated" } },
      { name: "path and module", patch: { path: "nested:target", moduleName: "nested" } },
      { name: "partition", patch: { partition: { type: "partitionCreateRoot", table: partitionTable.name, partitionField: "_id" } } },
    ];
    for (const change of changes) {
      const changed = await canonicalManifest({ ...original,
        functions: [rootFunction, { ...childFunction, ...change.patch }] });
      const current = await project(changed);
      expect(changed.sourceArtifact, change.name).toEqual(original.sourceArtifact);
      expect(current.root, change.name).toEqual(baseline.root);
      expect(current.catalogSha256, change.name).not.toBe(baseline.catalogSha256);
      expect(current.group.semanticSha256Hex, change.name).not.toBe(baseline.group.semanticSha256Hex);
    }
  });

  it.each([1, 2, 3] as const)("V%i includes membership changes and their implicit ordinal shifts", async version => {
    const original = await manifestForVersion(version);
    const baseline = await project(original);
    const inserted = await canonicalManifest({ ...original, functions: [
      { ...childFunction, path: "functions:before", exportName: "before" }, ...original.functions,
    ] });
    expect(inserted.functions.findIndex(fn => fn.path === rootFunction.path))
      .toBe(original.functions.findIndex(fn => fn.path === rootFunction.path) + 1);
    const removed = await canonicalManifest({ ...original, functions: [rootFunction] });
    for (const changed of [inserted, removed]) {
      const current = await project(changed);
      expect(changed.sourceArtifact).toEqual(original.sourceArtifact);
      expect(current.root).toEqual(baseline.root);
      expect(current.catalogSha256).not.toBe(baseline.catalogSha256);
      expect(current.group.semanticSha256Hex).not.toBe(baseline.group.semanticSha256Hex);
    }
  });

  it.each([1, 2, 3] as const)("V%i excludes an independent schema change from execution semantics", async version => {
    const original = await manifestForVersion(version);
    const firstTable = original.schema.tables[0];
    if (firstTable === undefined) throw new Error("Expected a table fixture");
    const validator = firstTable.validator;
    if (validator.type !== "object") throw new Error("Expected an object table fixture");
    const schemaOnly = await canonicalManifest({ ...original, schema: { ...original.schema,
      tables: original.schema.tables.map(table => table.tableId === firstTable.tableId ? { ...table,
        validator: { ...validator, value: { ...validator.value,
          independent: { fieldType: { type: "boolean" }, optional: true } } } } : table),
    } });
    const baseline = await project(original), current = await project(schemaOnly);
    expect(schemaOnly.sourceArtifact).toEqual(original.sourceArtifact);
    expect(current.schemaSha256).not.toBe(baseline.schemaSha256);
    expect(current.catalogSha256).toBe(baseline.catalogSha256);
    expect(current.root).toEqual(baseline.root);
    expect(current.group).toEqual(baseline.group);
  });
});

async function manifestForVersion(version: ApplicationManifest["version"]): Promise<ApplicationManifest> {
  const original = version === 1 ? applicationManifest(true, true).manifest
    : version === 2 ? relationManifestV2(ROOT) : (await policyManifestFixture(ROOT)).manifest;
  return canonicalManifest({ ...original, schema: { ...original.schema,
    tables: original.schema.tables.map((table, index) => index === 0
      ? { ...table, placement: { kind: "partitionBy", field: "_id" } } : table),
  }, functions: [rootFunction, childFunction] });
}

async function canonicalManifest(input: unknown): Promise<ApplicationManifest> {
  const canonical = Result.getOrThrow(canonicalizeApplicationManifest(input));
  return canonical.manifest.version === 3
    ? (await runEffect(verifyApplicationManifestV3(canonical.manifest))).manifest : canonical.manifest;
}

async function project(manifest: ApplicationManifest) {
  const frame = manifest.version === 1 ? Result.getOrThrow(applicationFunctionCatalogPublicationFrameV1(manifest))
    : Result.getOrThrow(applicationFunctionCatalogPublicationFrameV2(manifest));
  const functionCatalogSha256 = createHash("sha256").update(frame).digest();
  const projection = await runEffect(prepareApplicationExecutionMetadataProjection({ manifest, functionCatalogSha256,
    runtimeHostIdentity: RUNTIME_HOST_IDENTITY, compatibilityDate: COMPATIBILITY_DATE }));
  try {
    const contracts = Result.getOrThrow(prepareFiniteMetadataEntryComparison(projection));
    const root = contracts.find(contract => contract.contractKey === finiteMetadataContractKey("function", rootFunction.path));
    const group = contracts.find(contract => contract.contractKey === finiteMetadataContractKey("executionGroup", "legacy_dynamic_worker_v1"));
    if (root === undefined || group === undefined) throw new Error("Missing issued execution contracts");
    return { root, group, catalogSha256: functionCatalogSha256.toString("hex"),
      schemaSha256: createHash("sha256").update(Result.getOrThrow(applicationSchemaPublicationFrame(manifest))).digest("hex") };
  } finally {
    disposeFiniteMetadataProjection(projection);
  }
}
