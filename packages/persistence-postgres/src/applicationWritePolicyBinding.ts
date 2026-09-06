import type { ApplicationManifestWithRelations } from "@flarex/analysis/application-analysis";
import {
  verifyApplicationWritePolicies,
  type VerifiedApplicationWritePolicies,
} from "@flarex/analysis/internal/application-write-policy";
import { Data, Effect, Schema } from "effect";
import { ApplicationSchemaTableBindingSchema } from "flarex-protocol/internal/application-schema-binding";
import type { ApplicationSchemaTableProjection } from "./applicationSchemaProjection";
import type {
  ApplicationSchemaBindingWithRelations,
  ApplicationSchemaBindingV3,
  ApplicationSchemaTableBinding,
  ApplicationSchemaWritePolicyBinding,
} from "flarex-protocol/internal/application-schema-binding";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";

export class ApplicationWritePolicyBindingError extends Data.TaggedError("ApplicationWritePolicyBindingError")<{
  readonly reason: "invalidEvidence" | "policyMismatch";
  readonly cause?: unknown;
}> {}

type PolicyBindingFields = Pick<ApplicationSchemaBindingV3, "writePolicies" | "writePolicySetSha256">;
const decodeTables = Schema.decodeUnknownEffect(Schema.Array(ApplicationSchemaTableBindingSchema));

/** Bound policy metadata is derived from authenticated logical declarations. */
export const prepareApplicationWritePolicyBinding = Effect.fn("ApplicationWritePolicyBinding.prepare")(
  function* (
    manifest: ApplicationManifestWithRelations,
    tableInput: ReadonlyArray<ApplicationSchemaTableProjection>,
  ): Effect.fn.Return<PolicyBindingFields | null, ApplicationWritePolicyBindingError> {
    if (manifest.version === 2) return null;
    const tables = yield* decodeTables(tableInput).pipe(Effect.mapError(cause =>
      new ApplicationWritePolicyBindingError({ reason: "invalidEvidence", cause })));
    const verified = yield* verifyApplicationWritePolicies(manifest.schema.writePolicies,
      tables.map(table => table.logicalName)).pipe(Effect.mapError(cause =>
        new ApplicationWritePolicyBindingError({ reason: "invalidEvidence", cause })));
    if (verified.policySetSha256 !== manifest.schema.writePolicySetSha256) {
      return yield* Effect.fail(new ApplicationWritePolicyBindingError({ reason: "policyMismatch" }));
    }
    return yield* bindVerifiedPolicies(verified, tables);
  },
);

/** Recheck the exact retained schema evidence rather than trusting a mutable JSON projection. */
export const verifyStoredApplicationWritePolicyBinding = Effect.fn("ApplicationWritePolicyBinding.verifyStored")(
  function* (
    binding: ApplicationSchemaBindingWithRelations,
    schemaBytes: Uint8Array,
  ): Effect.fn.Return<void, ApplicationWritePolicyBindingError> {
    if (binding.version === 2) return;
    if (schemaBytes.byteLength > 1_048_576) {
      return yield* Effect.fail(new ApplicationWritePolicyBindingError({ reason: "invalidEvidence" }));
    }
    const frame = yield* Effect.try({
      try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(schemaBytes)),
      catch: cause => new ApplicationWritePolicyBindingError({ reason: "invalidEvidence", cause }),
    });
    if (!hasExactOwnDataKeys(frame, ["format", "version", "schema"]) ||
      frame.format !== "flarex.application-schema-publication" || frame.version !== 3 ||
      !hasExactOwnDataKeys(frame.schema, ["version", "tables", "indexes", "relations", "writePolicies", "writePolicySetSha256"]) ||
      frame.schema.version !== 3) {
      return yield* Effect.fail(new ApplicationWritePolicyBindingError({ reason: "invalidEvidence" }));
    }
    const verified = yield* verifyApplicationWritePolicies(frame.schema.writePolicies,
      binding.tables.map(table => table.logicalName)).pipe(Effect.mapError(cause =>
        new ApplicationWritePolicyBindingError({ reason: "invalidEvidence", cause })));
    const expected = yield* bindVerifiedPolicies(verified, binding.tables);
    if (expected.writePolicySetSha256 !== binding.writePolicySetSha256 ||
      frame.schema.writePolicySetSha256 !== binding.writePolicySetSha256 ||
      expected.writePolicies.length !== binding.writePolicies.length ||
      expected.writePolicies.some((policy, index) => {
        const actual = binding.writePolicies[index];
        return actual === undefined || policy.applicationTableId !== actual.applicationTableId ||
          policy.tableId !== actual.tableId || policy.logicalName !== actual.logicalName ||
          policy.owner !== actual.owner || policy.writePolicySha256 !== actual.writePolicySha256;
      })) {
      return yield* Effect.fail(new ApplicationWritePolicyBindingError({ reason: "policyMismatch" }));
    }
    // The binding codec independently hashes each complete policy declaration;
    // matching those digests also binds the payload profile/config/provenance.
  },
);

const bindVerifiedPolicies = Effect.fn("ApplicationWritePolicyBinding.bindTables")(
  function* (
    verified: VerifiedApplicationWritePolicies,
    tables: ReadonlyArray<ApplicationSchemaTableBinding>,
  ): Effect.fn.Return<PolicyBindingFields, ApplicationWritePolicyBindingError> {
    const writePolicies: ApplicationSchemaWritePolicyBinding[] = [];
    if (tables.length !== verified.tables.length) {
      return yield* Effect.fail(new ApplicationWritePolicyBindingError({ reason: "policyMismatch" }));
    }
    for (let index = 0; index < tables.length; index++) {
      const table = tables[index];
      const policy = verified.tables[index];
      if (!table || !policy || table.logicalName !== policy.declaration.logicalTableName) {
        return yield* Effect.fail(new ApplicationWritePolicyBindingError({ reason: "policyMismatch" }));
      }
      const declaration = policy.declaration;
      writePolicies.push(Object.freeze(declaration.owner === "application" ? {
        ...table, owner: "application", writePolicySha256: policy.writePolicySha256,
      } : {
        ...table, owner: "payload", writePolicySha256: policy.writePolicySha256,
        policyId: declaration.policyId, configSha256: declaration.configSha256, provenanceSha256: declaration.provenanceSha256,
      }));
    }
    return Object.freeze({ writePolicySetSha256: verified.policySetSha256, writePolicies: Object.freeze(writePolicies) });
  },
);
