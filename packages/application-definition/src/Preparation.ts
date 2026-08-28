import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  makeCanonicalDeclarativeProgramBudgetV1,
  type CanonicalDeclarativeProgramBudgetV1,
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

declare const AdmittedApplicationPreparationPolicyType: unique symbol;

export interface AdmittedApplicationPreparationPolicy {
  readonly [AdmittedApplicationPreparationPolicyType]: true;
}

interface AdmittedApplicationPreparationPolicyState {
  readonly policy: Readonly<ApplicationPreparationPolicy>;
  readonly programBudget: CanonicalDeclarativeProgramBudgetV1;
}

const admittedApplicationPreparationPolicyStates = new WeakMap<
  object,
  AdmittedApplicationPreparationPolicyState
>();

class AdmittedApplicationPreparationPolicyHandle implements
  AdmittedApplicationPreparationPolicy {
  declare readonly [AdmittedApplicationPreparationPolicyType]: true;

  constructor() {
    Object.freeze(this);
  }
}

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
  policy:
    | ApplicationPreparationPolicy
    | AdmittedApplicationPreparationPolicy,
): Result.Result<PreparedApplication<Definition>, ApplicationPreparationError> {
  return Result.gen(function* () {
    const admitted = yield* resolveApplicationPreparationPolicy(policy);
    const application = inspectApplicationDefinition(definition);
    const modules = application.modules.map((module) =>
      inspectApplicationModule(module)
    );
    const programInput = {
      format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
      version: CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
      schema: inspectSchemaDefinition(application.schema),
      modules: modules.map((module) => module.authored),
    } satisfies CanonicalDeclarativeProgramInputV1;
    const program = yield* prepareStandardApplicationProgramV1(
      programInput,
      admitted.programBudget,
    );
    const materializationBudget =
      yield* makeDeclarativeV2MaterializationBudgetV1({
        maximumModules: admitted.policy.maximumModules,
        maximumEntryBindings: modules.length,
        maximumSourceBytes: admitted.policy.maximumSourceBytes,
        maximumSourceMapBytes: admitted.policy.maximumSourceMapBytes,
        maximumBytesMaterialized: admitted.policy.maximumBytesMaterialized,
        maximumSemanticRecords: admitted.policy.maximumSemanticRecords,
        maximumSemanticRecordBytes:
          admitted.policy.maximumSemanticRecordBytes,
        maximumSemanticStreamBytes:
          admitted.policy.maximumSemanticStreamBytes,
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

export function admitApplicationPreparationPolicy(
  input: ApplicationPreparationPolicy,
): Result.Result<
  AdmittedApplicationPreparationPolicy,
  ApplicationPreparationError
> {
  return admitApplicationPreparationPolicyFromUnknown(input);
}

function admitApplicationPreparationPolicyFromUnknown(
  input: unknown,
): Result.Result<
  AdmittedApplicationPreparationPolicy,
  ApplicationPreparationError
> {
  const captured = captureApplicationPreparationPolicy(input);
  if (captured === undefined) {
    return Result.map(
      makeCanonicalDeclarativeProgramBudgetV1(undefined),
      () => new AdmittedApplicationPreparationPolicyHandle(),
    );
  }
  return Result.gen(function* () {
    const programBudget = yield* makeCanonicalDeclarativeProgramBudgetV1({
      maximumModules: captured.maximumModules,
      maximumFunctions: captured.maximumFunctions,
      maximumIdentifierUtf8Bytes: captured.maximumIdentifierUtf8Bytes,
      maximumValidatorNodes: captured.maximumValidatorNodes,
      maximumValidatorDepth: captured.maximumValidatorDepth,
      maximumValidatorStringUtf8Bytes:
        captured.maximumValidatorStringUtf8Bytes,
    });
    const materializationBudget =
      yield* makeDeclarativeV2MaterializationBudgetV1({
      maximumModules: captured.maximumModules,
      maximumEntryBindings: 0,
      maximumSourceBytes: captured.maximumSourceBytes,
      maximumSourceMapBytes: captured.maximumSourceMapBytes,
      maximumBytesMaterialized: captured.maximumBytesMaterialized,
      maximumSemanticRecords: captured.maximumSemanticRecords,
      maximumSemanticRecordBytes: captured.maximumSemanticRecordBytes,
      maximumSemanticStreamBytes: captured.maximumSemanticStreamBytes,
    });
    const policy = Object.freeze({
      maximumModules: programBudget.maximumModules,
      maximumFunctions: programBudget.maximumFunctions,
      maximumIdentifierUtf8Bytes:
        programBudget.maximumIdentifierUtf8Bytes,
      maximumValidatorNodes: programBudget.maximumValidatorNodes,
      maximumValidatorDepth: programBudget.maximumValidatorDepth,
      maximumValidatorStringUtf8Bytes:
        programBudget.maximumValidatorStringUtf8Bytes,
      maximumSourceBytes: materializationBudget.maximumSourceBytes,
      maximumSourceMapBytes: materializationBudget.maximumSourceMapBytes,
      maximumBytesMaterialized:
        materializationBudget.maximumBytesMaterialized,
      maximumSemanticRecords: materializationBudget.maximumSemanticRecords,
      maximumSemanticRecordBytes:
        materializationBudget.maximumSemanticRecordBytes,
      maximumSemanticStreamBytes:
        materializationBudget.maximumSemanticStreamBytes,
    });
    const admitted = new AdmittedApplicationPreparationPolicyHandle();
    admittedApplicationPreparationPolicyStates.set(admitted, {
      policy,
      programBudget,
    });
    return admitted;
  });
}

function resolveApplicationPreparationPolicy(
  policy: ApplicationPreparationPolicy | AdmittedApplicationPreparationPolicy,
): Result.Result<
  AdmittedApplicationPreparationPolicyState,
  ApplicationPreparationError
> {
  const admitted = policy !== null && typeof policy === "object"
    ? admittedApplicationPreparationPolicyStates.get(policy)
    : undefined;
  return admitted === undefined
    ? Result.map(
      admitApplicationPreparationPolicyFromUnknown(policy),
      inspectAdmittedApplicationPreparationPolicyState,
    )
    : Result.succeed(admitted);
}

function captureApplicationPreparationPolicy(
  input: unknown,
): CapturedApplicationPreparationPolicy | undefined {
  const keys = [
    "maximumModules",
    "maximumFunctions",
    "maximumIdentifierUtf8Bytes",
    "maximumValidatorNodes",
    "maximumValidatorDepth",
    "maximumValidatorStringUtf8Bytes",
    "maximumSourceBytes",
    "maximumSourceMapBytes",
    "maximumBytesMaterialized",
    "maximumSemanticRecords",
    "maximumSemanticRecordBytes",
    "maximumSemanticStreamBytes",
  ] as const;
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return undefined;
    }
    const captured: unknown[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      captured.push(descriptor.value);
    }
    return Object.freeze({
      maximumModules: captured[0],
      maximumFunctions: captured[1],
      maximumIdentifierUtf8Bytes: captured[2],
      maximumValidatorNodes: captured[3],
      maximumValidatorDepth: captured[4],
      maximumValidatorStringUtf8Bytes: captured[5],
      maximumSourceBytes: captured[6],
      maximumSourceMapBytes: captured[7],
      maximumBytesMaterialized: captured[8],
      maximumSemanticRecords: captured[9],
      maximumSemanticRecordBytes: captured[10],
      maximumSemanticStreamBytes: captured[11],
    });
  } catch {
    return undefined;
  }
}

interface CapturedApplicationPreparationPolicy {
  readonly maximumModules: unknown;
  readonly maximumFunctions: unknown;
  readonly maximumIdentifierUtf8Bytes: unknown;
  readonly maximumValidatorNodes: unknown;
  readonly maximumValidatorDepth: unknown;
  readonly maximumValidatorStringUtf8Bytes: unknown;
  readonly maximumSourceBytes: unknown;
  readonly maximumSourceMapBytes: unknown;
  readonly maximumBytesMaterialized: unknown;
  readonly maximumSemanticRecords: unknown;
  readonly maximumSemanticRecordBytes: unknown;
  readonly maximumSemanticStreamBytes: unknown;
}

function inspectAdmittedApplicationPreparationPolicyState(
  policy: AdmittedApplicationPreparationPolicy,
): AdmittedApplicationPreparationPolicyState {
  const state = admittedApplicationPreparationPolicyStates.get(policy);
  if (state === undefined) {
    throw new TypeError("Admitted application policy metadata is unavailable.");
  }
  return state;
}

export function inspectAdmittedApplicationPreparationPolicy(
  policy: AdmittedApplicationPreparationPolicy,
): Readonly<ApplicationPreparationPolicy> {
  return inspectAdmittedApplicationPreparationPolicyState(policy).policy;
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

/**
 * Temporary workspace-internal bridge for downstream owners that still
 * consume the displaced prepared-definition contract. The callback receives
 * the exact state created by `prepareApplication`; it does not prepare,
 * compare, or fall back to a second definition path.
 */
export function withLegacyPreparedApplication<Output>(
  prepared: PreparedApplication,
  use: (definition: PreparedStandardApplicationDefinitionV1) => Output,
): Output {
  return use(inspectPreparedApplication(prepared));
}
