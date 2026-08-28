import {
  action,
  defineApplication,
  defineModule,
  defineSchema,
  defineTable,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  sourceModule,
  v,
  workflowMutation,
  type ApplicationDefinition,
  type FunctionDefinition,
  type TableDefinition,
  type Validator,
  type ValidatorOptionality,
  type ValidatorRecord,
} from "@flarex/application-definition";
import type {
  AnyStandardFunctionContractV1,
  StandardFunctionCatalogV1,
  StandardModuleV1,
  StandardValidatorRecordV1,
} from "@flarex/standard-application-definition/v1";
import { standardV1 } from "@flarex/standard-application-definition/v1";
import type { SchemaManifestAppIndexDeclarationInputV1 } from
  "flarex-protocol/schema-manifest";
import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";

type AnyStandardModuleV1 = StandardModuleV1<
  string,
  StandardFunctionCatalogV1
>;

type RequiredCleanValidator = Validator<unknown, "required", string>;
type CleanFunctionArgs = FunctionDefinition["args"];

export interface CreateAndReadAdditionalFunctionModuleV1 {
  readonly module: AnyStandardModuleV1;
  readonly artifactModulePath: string;
  readonly sourceBytes: Uint8Array;
}

export interface CreateAndReadAdditionalTableV1 {
  readonly logicalName: string;
  readonly fields: StandardValidatorRecordV1;
}

export interface CreateAndReadDefinitionInputV1<
  Fields extends StandardValidatorRecordV1,
> {
  readonly tableName: string;
  readonly mutationModule: AnyStandardModuleV1;
  readonly queryModule: AnyStandardModuleV1;
  readonly mutationArtifactPath: string;
  readonly queryArtifactPath: string;
  readonly mutationSourceBytes: Uint8Array;
  readonly querySourceBytes: Uint8Array;
  readonly fields: Fields;
  readonly additionalTables?:
    ReadonlyArray<CreateAndReadAdditionalTableV1>;
  readonly indexes?: ReadonlyArray<SchemaManifestAppIndexDeclarationInputV1>;
  readonly additionalFunctionModules?:
    ReadonlyArray<CreateAndReadAdditionalFunctionModuleV1>;
  readonly pointMutationLifecycle?: Readonly<{
    readonly patchModule: AnyStandardModuleV1;
    readonly patchArtifactPath: string;
    readonly patchSourceBytes: Uint8Array;
    readonly replaceModule: AnyStandardModuleV1;
    readonly replaceArtifactPath: string;
    readonly replaceSourceBytes: Uint8Array;
    readonly deleteModule: AnyStandardModuleV1;
    readonly deleteArtifactPath: string;
    readonly deleteSourceBytes: Uint8Array;
  }>;
}

export function makeCreateAndReadModulesV1<
  TableName extends string,
  Fields extends StandardValidatorRecordV1,
  MutationModulePath extends string,
  QueryModulePath extends string,
>(input: Readonly<{
  readonly tableName: TableName;
  readonly fields: Fields;
  readonly mutationModulePath: MutationModulePath;
  readonly queryModulePath: QueryModulePath;
}>) {
  const document = standardV1.object({
    _id: standardV1.id(input.tableName),
    _creationTime: standardV1.number(),
    ...input.fields,
  });
  return Object.freeze({
    mutationModule: standardV1.module(input.mutationModulePath, {
      create: standardV1.publicMutation({
        args: standardV1.object(input.fields),
        returns: standardV1.id(input.tableName),
      }),
    }),
    queryModule: standardV1.module(input.queryModulePath, {
      get: standardV1.publicQuery({
        args: standardV1.object({ id: standardV1.string() }),
        returns: standardV1.nullable(document),
      }),
    }),
  });
}

/**
 * Transitional CAPI-B fixture adapter. Existing simulations retain their
 * typed Standard references until the invocation facade lands, while all
 * definition preparation now goes through the clean application facade.
 */
export function makeCreateAndReadDefinitionV1<
  Fields extends StandardValidatorRecordV1,
>(
  input: CreateAndReadDefinitionInputV1<Fields>,
): ApplicationDefinition {
  const additionalFunctionModules = input.additionalFunctionModules ?? [];
  const lifecycle = input.pointMutationLifecycle;
  const moduleInputs: Array<Readonly<{
    readonly module: AnyStandardModuleV1;
    readonly artifactPath: string;
    readonly sourceBytes: Uint8Array;
  }>> = [{
    module: input.mutationModule,
    artifactPath: input.mutationArtifactPath,
    sourceBytes: input.mutationSourceBytes,
  }];
  if (lifecycle !== undefined) {
    moduleInputs.push({
      module: lifecycle.patchModule,
      artifactPath: lifecycle.patchArtifactPath,
      sourceBytes: lifecycle.patchSourceBytes,
    }, {
      module: lifecycle.replaceModule,
      artifactPath: lifecycle.replaceArtifactPath,
      sourceBytes: lifecycle.replaceSourceBytes,
    }, {
      module: lifecycle.deleteModule,
      artifactPath: lifecycle.deleteArtifactPath,
      sourceBytes: lifecycle.deleteSourceBytes,
    });
  }
  moduleInputs.push(...additionalFunctionModules.map(entry => ({
    module: entry.module,
    artifactPath: entry.artifactModulePath,
    sourceBytes: entry.sourceBytes,
  })), {
    module: input.queryModule,
    artifactPath: input.queryArtifactPath,
    sourceBytes: input.querySourceBytes,
  });

  const tables: Record<string, TableDefinition> = Object.create(null);
  tables[input.tableName] = tableFromStandardFields(input.fields);
  for (const table of input.additionalTables ?? []) {
    tables[table.logicalName] = tableFromStandardFields(table.fields);
  }
  for (const index of input.indexes ?? []) {
    const table = tables[index.tableLogicalName];
    const [first, ...rest] = index.fields;
    if (table === undefined || first === undefined) {
      throw new TypeError(
        `Create/read fixture index ${index.descriptor} has no owned table or field.`,
      );
    }
    tables[index.tableLogicalName] = table.index(
      index.descriptor,
      [first, ...rest],
    );
  }

  return defineApplication({
    schema: defineSchema(tables),
    modules: moduleInputs.map(entry => moduleFromStandard(
      entry.module,
      entry.artifactPath,
      entry.sourceBytes,
    )),
  });
}

function tableFromStandardFields(
  fields: StandardValidatorRecordV1,
): TableDefinition {
  return defineTable(validatorRecordFromStandard(fields));
}

function moduleFromStandard(
  module: AnyStandardModuleV1,
  artifactPath: string,
  sourceBytes: Uint8Array,
) {
  const functions: Record<string, FunctionDefinition> = Object.create(null);
  for (const [exportName, contract] of Object.entries(module.functions)) {
    functions[exportName] = functionFromStandard(contract);
  }
  return defineModule({
    path: module.modulePath,
    source: sourceModule({ path: artifactPath, bytes: sourceBytes }),
    functions,
  });
}

function functionFromStandard(
  contract: AnyStandardFunctionContractV1,
): FunctionDefinition {
  const args = functionArgsFromJson(contract.args.json);
  const returns = requiredValidatorFromJson(contract.returns.json);
  switch (`${contract.visibility}:${contract.kind}`) {
    case "public:query":
      return query({ args, returns });
    case "internal:query":
      return internalQuery({ args, returns });
    case "public:mutation":
      return mutation({ args, returns });
    case "internal:mutation":
      return internalMutation({ args, returns });
    case "public:workflowMutation":
      return workflowMutation({ args, returns });
    case "public:action":
      return action({ args, returns });
    case "internal:action":
      return internalAction({ args, returns });
    default:
      throw new TypeError(
        `Unsupported simulation function contract: ${contract.visibility}:${contract.kind}.`,
      );
  }
}

function functionArgsFromJson(json: ValidatorJsonV1): CleanFunctionArgs {
  if (json.type === "any") return v.any();
  if (json.type !== "object") {
    throw new TypeError("Simulation function arguments must be object or any.");
  }
  return v.object(validatorRecordFromObjectJson(json));
}

function validatorRecordFromStandard(
  fields: StandardValidatorRecordV1,
): ValidatorRecord {
  const converted: Record<
    string,
    Validator<unknown, ValidatorOptionality, string>
  > = Object.create(null);
  for (const [name, validator] of Object.entries(fields)) {
    const required = requiredValidatorFromJson(validator.json);
    converted[name] = validator.optionality === "optional"
      ? v.optional(required)
      : required;
  }
  return converted;
}

function validatorRecordFromObjectJson(
  json: ObjectValidatorJsonV1,
): ValidatorRecord {
  const converted: Record<
    string,
    Validator<unknown, ValidatorOptionality, string>
  > = Object.create(null);
  for (const [name, field] of Object.entries(json.value)) {
    const required = requiredValidatorFromJson(field.fieldType);
    converted[name] = field.optional ? v.optional(required) : required;
  }
  return converted;
}

function requiredValidatorFromJson(
  json: ValidatorJsonV1,
): RequiredCleanValidator {
  switch (json.type) {
    case "null":
      return v.null();
    case "number":
      return v.number();
    case "bigint":
      return v.bigint();
    case "boolean":
      return v.boolean();
    case "string":
      return v.string();
    case "bytes":
      return v.bytes();
    case "any":
      return v.any();
    case "id":
      return v.id(json.tableName);
    case "literal":
      return v.literal(json.value);
    case "array":
      return v.array(requiredValidatorFromJson(json.value));
    case "record":
      return v.record(
        requiredValidatorFromJson(json.keys),
        requiredValidatorFromJson(json.values),
      );
    case "object":
      return v.object(validatorRecordFromObjectJson(json));
    case "union": {
      const [first, ...rest] = json.value;
      if (first === undefined) {
        throw new TypeError("Simulation validator union must not be empty.");
      }
      return v.union(
        requiredValidatorFromJson(first),
        ...rest.map(requiredValidatorFromJson),
      );
    }
  }
}
