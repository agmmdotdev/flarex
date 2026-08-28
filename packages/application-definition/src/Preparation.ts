import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  makeCanonicalDeclarativeProgramBudgetV1,
  type CanonicalDeclarativeProgramInputV1,
  type CanonicalDeclarativeProgramV1Error,
} from "@flarex/declarative-program/v1";
import {
  makeDeclarativeV2MaterializationBudgetV1,
  type DeclarativeV2MaterializationV1Error,
  type DeclarativeV2PrebuiltModuleGraphInputV1,
} from "@flarex/declarative-materializer/v1";
import {
  materializeStandardApplicationArtifactsV1,
  prepareStandardApplicationProgramV1,
  type PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Result } from "effect";

import {
  inspectApplicationDefinition,
  inspectApplicationModule,
  inspectSchemaDefinition,
  type ApplicationDefinition,
} from "./Authoring.js";

export interface ApplicationPreparationPolicy {
  readonly maximumModules: number;
  readonly maximumFunctions: number;
  readonly maximumIdentifierUtf8Bytes: number;
  readonly maximumValidatorNodes: number;
  readonly maximumValidatorDepth: number;
  readonly maximumValidatorStringUtf8Bytes: number;
  readonly maximumSourceBytes: number;
  readonly maximumSourceMapBytes: number;
  readonly maximumBytesMaterialized: number;
  readonly maximumSemanticRecords: number;
  readonly maximumSemanticRecordBytes: number;
  readonly maximumSemanticStreamBytes: number;
}

export type ApplicationPreparationError =
  | CanonicalDeclarativeProgramV1Error
  | DeclarativeV2MaterializationV1Error;

declare const PreparedApplicationType: unique symbol;

export interface PreparedApplication<
  Definition extends ApplicationDefinition = ApplicationDefinition,
> {
  readonly [PreparedApplicationType]: Definition;
  readonly application: Definition;
}

const preparedApplicationStates = new WeakMap<
  PreparedApplication,
  PreparedStandardApplicationDefinitionV1
>();

class PreparedApplicationHandle<
  Definition extends ApplicationDefinition,
> implements PreparedApplication<Definition> {
  declare readonly [PreparedApplicationType]: Definition;

  constructor(readonly application: Definition) {
    Object.freeze(this);
  }
}

export function prepareApplication<
  Definition extends ApplicationDefinition,
>(
  definition: Definition,
  policy: ApplicationPreparationPolicy,
): Result.Result<PreparedApplication<Definition>, ApplicationPreparationError> {
  const application = inspectApplicationDefinition(definition);
  const modules = application.modules.map((module) =>
    inspectApplicationModule(module)
  );
  const programInput = {
    format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
    version: CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
    schema: inspectSchemaDefinition(application.schema),
    modules: modules.map((module) => module.authored.toCanonicalInput()),
  } satisfies CanonicalDeclarativeProgramInputV1;

  return Result.gen(function* () {
    const programBudget = yield* makeCanonicalDeclarativeProgramBudgetV1({
      maximumModules: policy.maximumModules,
      maximumFunctions: policy.maximumFunctions,
      maximumIdentifierUtf8Bytes: policy.maximumIdentifierUtf8Bytes,
      maximumValidatorNodes: policy.maximumValidatorNodes,
      maximumValidatorDepth: policy.maximumValidatorDepth,
      maximumValidatorStringUtf8Bytes:
        policy.maximumValidatorStringUtf8Bytes,
    });
    const program = yield* prepareStandardApplicationProgramV1(
      programInput,
      programBudget,
    );
    const materializationBudget =
      yield* makeDeclarativeV2MaterializationBudgetV1({
        maximumModules: policy.maximumModules,
        maximumEntryBindings: modules.length,
        maximumSourceBytes: policy.maximumSourceBytes,
        maximumSourceMapBytes: policy.maximumSourceMapBytes,
        maximumBytesMaterialized: policy.maximumBytesMaterialized,
        maximumSemanticRecords: policy.maximumSemanticRecords,
        maximumSemanticRecordBytes: policy.maximumSemanticRecordBytes,
        maximumSemanticStreamBytes: policy.maximumSemanticStreamBytes,
      });
    const artifactIngressPlan =
      yield* materializeStandardApplicationArtifactsV1(
        program,
        makeModuleGraphInput(application.modules),
        materializationBudget,
      );
    const prepared = new PreparedApplicationHandle(definition);
    preparedApplicationStates.set(prepared, { program, artifactIngressPlan });
    return prepared;
  });
}

function makeModuleGraphInput(
  modules: ReadonlyArray<ApplicationDefinition["modules"][number]>,
): DeclarativeV2PrebuiltModuleGraphInputV1 {
  const executionModuleIndex = selectExecutionModuleIndex(modules);
  const executionModule = executionModuleIndex === undefined
    ? undefined
    : modules[executionModuleIndex];
  return {
    modules: modules.map((module, index) => {
      const state = inspectApplicationModule(module);
      return {
        path: module.source.path,
        roles: index === executionModuleIndex
          ? ["function", "execution"]
          : ["function"],
        sourceBytes: state.source.bytes,
        sourceMapBytes: state.source.sourceMapBytes,
      };
    }),
    functionEntries: modules.map((module) => ({
      logicalModulePath: module.path,
      artifactModulePath: module.source.path,
    })),
    executionPath: executionModule?.source.path ?? "",
    schemaPath: null,
    authPath: null,
  };
}

function selectExecutionModuleIndex(
  modules: ReadonlyArray<ApplicationDefinition["modules"][number]>,
): number | undefined {
  // Preparation needs one inert execution-role placeholder for the existing
  // materializer. Source production later generates the actual execution
  // module, so select this placeholder only by stable application metadata.
  if (modules.length === 0) return undefined;
  let selectedIndex = 0;
  for (let index = 1; index < modules.length; index += 1) {
    const candidate = modules[index];
    const selected = modules[selectedIndex];
    if (candidate === undefined || selected === undefined) {
      throw new Error("Application module capture lost a dense member.");
    }
    const sourceOrder = compareUtf16Strings(
      candidate.source.path,
      selected.source.path,
    );
    if (
      sourceOrder < 0 ||
      (sourceOrder === 0 &&
        compareUtf16Strings(candidate.path, selected.path) < 0)
    ) {
      selectedIndex = index;
    }
  }
  return selectedIndex;
}

export function inspectPreparedApplication(
  prepared: PreparedApplication,
): PreparedStandardApplicationDefinitionV1 {
  const state = preparedApplicationStates.get(prepared);
  if (state === undefined) {
    throw new TypeError("Prepared application metadata is unavailable.");
  }
  return state;
}
