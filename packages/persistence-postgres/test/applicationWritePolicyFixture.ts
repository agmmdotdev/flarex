import { createHash } from "node:crypto";
import { Effect } from "effect";
import { verifyApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import type { ApplicationWritePolicies } from "@flarex/analysis/internal/application-write-policy";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";

export function policyFixture(fields: ApplicationWritePolicies["configuration"]["tables"][number]["fields"] = [{ name: "title", kind: "text" }]) {
  const provenance = {
    format: "flarex.payload-provenance", version: 1, package: "payload", release: "3.88.0",
    npmIntegrity: "sha512-O7zuS80bvEGLte+7xZjwN05+ox5BCsGcQT2M6+CTote07JQOOvHJoiuoyQFw6cUElcFTWGMC5dy03w7J7sTYGg==",
    gitTagObject: "c54dea8f4010d9cb194780f2ee1e4b3ec697f9be", gitCommit: "fea6f8a47a50ff1330d8a5071b43e7dcffb97b22",
  } satisfies ApplicationWritePolicies["provenance"];
  const configuration = {
    format: "flarex.payload-configuration", version: 2, profile: "payload.scalar", provenanceSha256: hashPolicyFixture(provenance),
    tables: [{ logicalTableName: "posts", fields }],
  } satisfies ApplicationWritePolicies["configuration"];
  return {
    format: "flarex.application-table-write-policies", version: 1, provenance, configuration,
    tables: [
      { logicalTableName: "audit", owner: "application" },
      { logicalTableName: "posts", owner: "payload", policyId: "payload.scalar", configSha256: hashPolicyFixture(configuration), provenanceSha256: hashPolicyFixture(provenance) },
    ],
  } satisfies ApplicationWritePolicies;
}

export async function policyManifestFixture(rootSha256 = "1".repeat(64), indexed = false, fields?: ApplicationWritePolicies["configuration"]["tables"][number]["fields"]) {
  const writePolicies = policyFixture(fields);
  const canonical = await Effect.runPromise(verifyApplicationManifestV3({
    format: "flarex.application-manifest", version: 3,
    sourceArtifact: {
      rootSha256, executionModulePath: "functions.js", schemaModulePath: "schema.js",
      modules: [
        { path: "functions.js", roles: 9, sourceSha256: "2".repeat(64), sourceByteLength: 48 },
        { path: "schema.js", roles: 2, sourceSha256: "3".repeat(64), sourceByteLength: 64 },
      ],
    },
    schema: {
      version: 3,
      tables: ["audit", "posts"].map((name, index) => ({ tableId: index + 1, name,
        validator: { type: "object", value: Object.fromEntries((name === "posts" && fields !== undefined ? fields : [{ name: "title", kind: "text" }]).map(field => [field.name, { fieldType: { type: field.kind === "number" ? "number" : field.kind === "boolean" ? "boolean" : "string" }, optional: false }])) },
        placement: { kind: "global" } })),
      indexes: indexed ? [{ indexId: 1, tableId: 2, name: "by_title", fields: ["title"] }] : [],
      relations: [], writePolicies, writePolicySetSha256: hashPolicyFixture(writePolicies),
    },
    functions: [{ path: "functions:write", moduleName: "functions", exportName: "write", kind: "mutation", visibility: "public",
      args: { type: "any" }, returns: null, partition: null }],
  }));
  return { manifest: canonical.manifest, manifestSha256: createHash("sha256").update(canonical.canonicalBytes).digest("hex") };
}

export function hashPolicyFixture(value: Json): string {
  return createHash("sha256").update(encodeCanonicalJson(value, () => { throw new Error("Invalid policy fixture"); })).digest("hex");
}
