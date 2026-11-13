import assert from "node:assert/strict";
import { serialize } from "node:v8";
import { Result, Schema } from "effect";
// This helper is deliberately JS: Effect strips its internal runtime types from
// declarations, but it is exactly the runtime imported by the generated modules.
import { runtime } from "effect/schema/SchemaCompiler/runtime";

const invocations = new Map();
const original = runtime.setCompiler;
runtime.setCompiler = (ast, compile, ...rest) => original(ast, new Proxy(compile, {
  apply(target, receiver, args) {
    const operation = Reflect.apply(target, receiver, args);
    return !["decode", "decodeEffect"].includes(args[2]) || typeof operation !== "function" ? operation : new Proxy(operation, {
      apply(decode, thisArg, inputs) {
        invocations.set(ast, (invocations.get(ast) ?? 0) + 1);
        return Reflect.apply(decode, thisArg, inputs);
      },
    });
  },
}), ...rest);
try {
  const { suites } = await import("./cases.ts");
  const { CoreIndexMetadataSchema, decodeCoreIndexMetadata } = await import("../../../persistence-postgres/src/core/indexState.ts");
  const { decodeCoreSchemaMetadata, captureCoreSchema } = await import("../../../persistence-postgres/src/core/schemaTypes.ts");
  const { ProductReadSchema } = await import("../../src/modules/product/service-schemas.ts");
  const { decodeProductRead, prepareProductReadInput } = await import("../../src/modules/product/service-input.ts");
  const { CoreProgramIdentitySchema, CoreApplicationSourcePinSchema, CoreSchemaWorkBudgetSchema,
    CoreSchemaWorkerOptionsSchema } = await import("../../../persistence-postgres/src/core/api.ts");
  const { CoreTableIteratorBudgetSchema } = await import("../../../persistence-postgres/src/core/iteratorBudget.ts");
  const { captureCoreApplicationPrograms } = await import("../../../persistence-postgres/src/core/applicationRegistration.ts");
  const actualIndex = decodeCoreIndexMetadata(suites[1].valid[0]);
  const actualMetadata = decodeCoreSchemaMetadata({ state: { state: "failed", error: "expected" }, schema: "{}" });
  const actualProduct = decodeProductRead({ id: "product_aot", config: { select: ["id"] } });
  assert(Result.isSuccess(actualIndex) && Result.isSuccess(actualMetadata) && Result.isSuccess(actualProduct));
  assert.equal(actualMetadata.success.state.table_name, null);
  for (const [name, schema] of [["core index", CoreIndexMetadataSchema], ["product read", ProductReadSchema]]) {
    assert.equal((invocations.get(schema.ast) ?? 0) > 0, process.argv[2] === "aot", `Actual ${name} decoder activation`);
  }
  let getters = 0;
  const accessor = Object.defineProperty({}, "id", { enumerable: true, get() { getters++; return "product_aot"; } });
  assert(Result.isFailure(prepareProductReadInput(accessor)));
  assert.equal(getters, 0, "Refuse accessors before Schema parsing");
  let schemaReads = 0;
  const rawSchema = { get tables() { return ++schemaReads === 1 ? null : []; } };
  assert(Result.isFailure(captureCoreSchema(rawSchema)), "Raw schema refusal cannot become success after getter replay");
  assert.equal(schemaReads, 1, "Keep the raw schema boundary's original single traversal");
  let programReads = 0;
  const identity = { get functionPath() { return ++programReads === 1 ? null : "program"; }, programHash: "hash", schemaHash: "hash" };
  assert(Result.isFailure(captureCoreApplicationPrograms([{ identity, metadata: {} }])));
  assert.equal(programReads, 1, "The existing program capture must refuse the first invalid value");
  const budget = { documentBytes: 1, documentCount: 1, logPageSize: 1, maxLogPagesPerStep: 1, maxMetadataEntries: 1 };
  const rawCases = [
    [CoreProgramIdentitySchema, { functionPath: "fn", programHash: "hash", schemaHash: "hash" }, "functionPath"],
    [CoreApplicationSourcePinSchema, { sourceArtifactRootSha256: "a".repeat(64), sourcePackageHash: "b".repeat(64) }, "sourceArtifactRootSha256"],
    [CoreSchemaWorkBudgetSchema, { pageSize: 1, maxPages: 1 }, "pageSize"],
    [CoreSchemaWorkerOptionsSchema, { ...budget, physicalChunkSize: 1, physicalConcurrency: 1 }, "documentBytes"],
    [CoreTableIteratorBudgetSchema, { ...budget, pageSize: 1 }, "documentBytes"],
  ];
  for (const [schema, value, key] of rawCases) {
    let reads = 0;
    const input = Object.defineProperty({ ...value }, key, { enumerable: true, get() { return ++reads === 1 ? null : value[key]; } });
    assert(Result.isFailure(Schema.decodeUnknownResult(schema)(input)), "Raw decoder refusal cannot change after getter replay");
    assert.equal(reads, 1, "Excluded raw roots retain a single traversal");
  }
  assert(Result.isFailure(decodeProductRead({ id: "product_aot", excess: true })));
  process.stdout.write(serialize([actualIndex.success, actualMetadata.success, actualProduct.success]).toString("base64"));
} finally {
  runtime.setCompiler = original;
}
