import { canonicalizeApplicationManifest, type ApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Result } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";
import { decodeLegacyValidatorJsonResultCoreV1, encodeLegacyValidatorJsonWireCoreV1,
  type ObjectValidatorJsonV1 } from "flarex-protocol/internal/validator-json-core";
import { validatorJsonHasNonfiniteLiteralV1 } from "flarex-protocol/validator-json";

const utf8 = new TextEncoder();
const invalid = () => new Error("Invalid immutable pre09 Application program metadata.");

/** Only the stored-program reader enters this frozen pre09 projection. It cannot publish a new program. */
export function readLegacyApplicationProgramManifest(value: unknown) {
  return Result.gen(function* () {
    if (!isNonArrayRecord(value) || Object.hasOwn(value, "validatorIdentityEncoding") || value.version !== 1
      || !isNonArrayRecord(value.schema) || !Array.isArray(value.schema.tables) || !Array.isArray(value.functions))
      return yield* Result.fail(invalid());
    const validators: ObjectValidatorJsonV1[] = [];
    const tableEnvelopes = [];
    for (const table of value.schema.tables) {
      if (!isNonArrayRecord(table)) return yield* Result.fail(invalid());
      const validator = decodeLegacyValidatorJsonResultCoreV1(table.validator, { onExcessProperty: "error" });
      if (!validator.ok || validator.value.type !== "object" || validatorJsonHasNonfiniteLiteralV1(validator.value))
        return yield* Result.fail(invalid());
      validators.push(validator.value);
      // Current Source document admission strips historical top-level underscore
      // fields and has newer child-name rules. Validate only the unchanged table
      // envelope here; the frozen decoder above owns every historical child.
      tableEnvelopes.push({ ...table, validator: { type: "object", value: {} } });
    }
    for (const fn of value.functions) {
      if (!isNonArrayRecord(fn) || !decodeLegacyValidatorJsonResultCoreV1(fn.args, { onExcessProperty: "error" }).ok
        || (fn.returns !== null && !decodeLegacyValidatorJsonResultCoreV1(fn.returns, { onExcessProperty: "error" }).ok))
        return yield* Result.fail(invalid());
    }
    const canonical = yield* canonicalizeApplicationManifest({ ...value, validatorIdentityEncoding: 2,
      schema: { ...value.schema, tables: tableEnvelopes } });
    if (canonical.manifest.version !== 1) return yield* Result.fail(invalid());
    const tables = [];
    for (const [index, table] of canonical.manifest.schema.tables.entries()) {
      const validator = validators[index];
      if (validator === undefined) return yield* Result.fail(invalid());
      tables.push(Object.freeze({ ...table, validator }));
    }
    const manifest = Object.freeze({ ...canonical.manifest,
      schema: Object.freeze({ ...canonical.manifest.schema, tables: Object.freeze(tables) }) });
    return { manifest, canonicalBytes: legacyFrame(legacyManifestWire(manifest)) };
  });
}

function legacyFunctionWire(fn: ApplicationManifestV1["functions"][number]) {
  return { ...fn, args: encodeLegacyValidatorJsonWireCoreV1(fn.args),
    returns: fn.returns === null ? null : encodeLegacyValidatorJsonWireCoreV1(fn.returns) };
}
function legacySchemaWire(manifest: ApplicationManifestV1) {
  return { ...manifest.schema, tables: manifest.schema.tables.map(table => ({ ...table,
    validator: encodeLegacyValidatorJsonWireCoreV1(table.validator) })) };
}
function legacyManifestWire(manifest: ApplicationManifestV1) {
  const { validatorIdentityEncoding: _encoding, ...base } = manifest;
  return { ...base, schema: legacySchemaWire(manifest), functions: manifest.functions.map(legacyFunctionWire) };
}
function legacyFrame(value: unknown): Uint8Array {
  if (!isJson(value)) throw invalid();
  return utf8.encode(encodeCanonicalJson(value, () => { throw invalid(); }));
}
export const legacyApplicationSchemaFrame = (manifest: ApplicationManifestV1) =>
  legacyFrame({ format: "flarex.application-schema-publication", version: 1, schema: legacySchemaWire(manifest) });
export const legacyApplicationCatalogFrame = (manifest: ApplicationManifestV1) =>
  legacyFrame({ format: "flarex.application-function-catalog", version: 1, functions: manifest.functions.map(legacyFunctionWire) });
export const legacyApplicationEntryFrame = (fn: ApplicationManifestV1["functions"][number]) => legacyFrame(legacyFunctionWire(fn));
