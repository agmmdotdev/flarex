import { Result } from "effect";
import { prepareStandardApplicationDefinitionV1 } from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { produceStandardApplicationSource } from "@flarex/standard-application-definition/application-source";
import { sourceBundleFromProduced } from "../../../system-test/support/standardApplicationCurrentAnalysisHarness";
import type { MixedMutationProductFixture } from "./mixedMutationWorkerdFixture";

/** A genuine analyzer-owned program with the original global schema and function
 * contracts. Only executable source changes; activation remains with its owner. */
export async function changedMixedMutationExecutableSource(fixture: MixedMutationProductFixture) {
  const manifest = fixture.active.basis.manifest;
  const prepared = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: { maximumModules: 1, maximumFunctions: 8, maximumIdentifierUtf8Bytes: 1024,
      maximumValidatorNodes: 128, maximumValidatorDepth: 16, maximumValidatorStringUtf8Bytes: 1024 },
    programInput: { format: "flarex.declarative-program/v1", version: 1,
      schema: { tables: manifest.schema.tables.map(table => {
        if (table.validator.type !== "object") throw new Error("Metadata ABA fixture requires genuine object table validators");
        return { logicalName: table.name,
          definition: { kind: "appDocument", definitionVersion: 1, documentType: table.validator } };
      }), indexes: manifest.schema.indexes.map(index => {
        const table = manifest.schema.tables.find(member => member.tableId === index.tableId);
        if (table === undefined) throw new Error("Metadata ABA fixture index has no genuine table declaration");
        return { tableLogicalName: table.name, descriptor: index.name, fields: index.fields,
          ...(index.decimalFields === undefined ? {} : { decimalFields: index.decimalFields }) };
      }) },
      modules: [{ modulePath: "users", functions: manifest.functions.map(fn => ({ exportName: fn.exportName,
        kind: fn.kind, visibility: fn.visibility, argsValidator: fn.args, returnsValidator: fn.returns })) }] },
    materializationBudgetInput: { maximumModules: 1, maximumEntryBindings: 8, maximumSourceBytes: 8192,
      maximumSourceMapBytes: 0, maximumBytesMaterialized: 65536, maximumSemanticRecords: 64,
      maximumSemanticRecordBytes: 8192, maximumSemanticStreamBytes: 65536 },
    graphInput: { modules: [{ path: "functions/users.js", roles: ["function", "execution"],
      sourceBytes: new TextEncoder().encode(["// genuinely changed executable for metadata ABA",
        ...manifest.functions.map(fn => `export async function ${fn.exportName}(_ctx, args) { return args; }`)].join("\n")),
      sourceMapBytes: null }], functionEntries: [{ logicalModulePath: "users", artifactModulePath: "functions/users.js" }],
      executionPath: "functions/users.js", schemaPath: null, authPath: null },
  }));
  const produced = Result.getOrThrow(produceStandardApplicationSource(prepared));
  // Author the fixture's original global placement using the real schema API.
  // The existing bundle owner hashes these actual bytes before the real analyzer.
  return sourceBundleFromProduced({ ...produced, modules: produced.modules.map(module => {
    if (module.path !== produced.schemaPath) return module;
    const schemaSource = new TextDecoder("utf-8", { fatal: true }).decode(module.sourceBytes);
    return { ...module, sourceBytes: new TextEncoder().encode(schemaSource.replaceAll("definePartitionTable", "defineGlobalTable")) };
  }) });
}
