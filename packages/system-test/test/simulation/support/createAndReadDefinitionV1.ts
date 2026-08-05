import type {
  StandardFunctionCatalogV1,
  StandardApplicationDefinitionInputV1,
  StandardModuleV1,
  StandardValidatorRecordV1,
} from "@flarex/standard-application-definition/v1";
import { standardV1 } from "@flarex/standard-application-definition/v1";

type AnyStandardModuleV1 = StandardModuleV1<
  string,
  StandardFunctionCatalogV1
>;

export interface CreateAndReadAdditionalFunctionModuleV1 {
  readonly module: AnyStandardModuleV1;
  readonly artifactModulePath: string;
  readonly sourceBytes: Uint8Array;
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

export function makeCreateAndReadDefinitionV1<
  Fields extends StandardValidatorRecordV1,
>(
  input: CreateAndReadDefinitionInputV1<Fields>,
): StandardApplicationDefinitionInputV1 {
  const documentValidator = standardV1.object(input.fields);
  const lifecycle = input.pointMutationLifecycle;
  const additionalFunctionModules = input.additionalFunctionModules ?? [];
  const lifecycleProgramModules = lifecycle === undefined ? [] : [
    lifecycle.patchModule.toCanonicalInput(),
    lifecycle.replaceModule.toCanonicalInput(),
    lifecycle.deleteModule.toCanonicalInput(),
  ];
  const lifecycleGraphModules = lifecycle === undefined ? [] : [{
    path: lifecycle.patchArtifactPath,
    roles: ["function" as const],
    sourceBytes: new Uint8Array(lifecycle.patchSourceBytes),
    sourceMapBytes: null,
  }, {
    path: lifecycle.replaceArtifactPath,
    roles: ["function" as const],
    sourceBytes: new Uint8Array(lifecycle.replaceSourceBytes),
    sourceMapBytes: null,
  }, {
    path: lifecycle.deleteArtifactPath,
    roles: ["function" as const],
    sourceBytes: new Uint8Array(lifecycle.deleteSourceBytes),
    sourceMapBytes: null,
  }];
  const lifecycleFunctionEntries = lifecycle === undefined ? [] : [{
    logicalModulePath: lifecycle.patchModule.modulePath,
    artifactModulePath: lifecycle.patchArtifactPath,
  }, {
    logicalModulePath: lifecycle.replaceModule.modulePath,
    artifactModulePath: lifecycle.replaceArtifactPath,
  }, {
    logicalModulePath: lifecycle.deleteModule.modulePath,
    artifactModulePath: lifecycle.deleteArtifactPath,
  }];
  const additionalProgramModules = additionalFunctionModules.map(
    entry => entry.module.toCanonicalInput(),
  );
  const additionalGraphModules = additionalFunctionModules.map(module => ({
    path: module.artifactModulePath,
    roles: ["function" as const],
    sourceBytes: new Uint8Array(module.sourceBytes),
    sourceMapBytes: null,
  }));
  const additionalFunctionEntries = additionalFunctionModules.map(module => ({
    logicalModulePath: module.module.modulePath,
    artifactModulePath: module.artifactModulePath,
  }));
  const programModules = [
    input.mutationModule.toCanonicalInput(),
    ...lifecycleProgramModules,
    ...additionalProgramModules,
    input.queryModule.toCanonicalInput(),
  ];
  const moduleCount = programModules.length;
  const functionCount = programModules.reduce(
    (count, module) => count + module.functions.length,
    0,
  );
  return {
    programBudgetInput: {
      maximumModules: moduleCount,
      maximumFunctions: functionCount,
      maximumIdentifierUtf8Bytes: 4_096,
      maximumValidatorNodes: 512,
      maximumValidatorDepth: 32,
      maximumValidatorStringUtf8Bytes: 4_096,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: {
        tables: [{
          logicalName: input.tableName,
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: documentValidator.json,
          },
        }],
        indexes: [],
      },
      modules: programModules,
    },
    materializationBudgetInput: {
      maximumModules: moduleCount,
      maximumEntryBindings: moduleCount,
      maximumSourceBytes: additionalFunctionModules.length === 0
        ? 8_192
        : 16_384,
      maximumSourceMapBytes: 1_024,
      maximumBytesMaterialized: additionalFunctionModules.length === 0
        ? 64_000
        : 128_000,
      maximumSemanticRecords: moduleCount * 32,
      maximumSemanticRecordBytes: 8_000,
      maximumSemanticStreamBytes: 32_000,
    },
    graphInput: {
      modules: [{
        path: input.mutationArtifactPath,
        roles: ["function", "execution"],
        sourceBytes: new Uint8Array(input.mutationSourceBytes),
        sourceMapBytes: null,
      }, ...lifecycleGraphModules, ...additionalGraphModules, {
        path: input.queryArtifactPath,
        roles: ["function"],
        sourceBytes: new Uint8Array(input.querySourceBytes),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: input.mutationModule.modulePath,
        artifactModulePath: input.mutationArtifactPath,
      }, ...lifecycleFunctionEntries, ...additionalFunctionEntries, {
        logicalModulePath: input.queryModule.modulePath,
        artifactModulePath: input.queryArtifactPath,
      }],
      executionPath: input.mutationArtifactPath,
      schemaPath: null,
      authPath: null,
    },
  };
}
