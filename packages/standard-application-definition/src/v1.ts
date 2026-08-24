import {
  decodeCanonicalDeclarativeProgramV1,
  makeCanonicalDeclarativeProgramBudgetV1,
  type CanonicalDeclarativeProgramBudgetInputV1,
  type CanonicalDeclarativeProgramBudgetV1,
  type CanonicalDeclarativeProgramInputV1,
  type CanonicalDeclarativeProgramV1,
  type CanonicalDeclarativeProgramV1Error,
} from "@flarex/declarative-program/v1";
import {
  makeDeclarativeV2MaterializationBudgetV1,
  materializeDeclarativeV2ArtifactsV1,
  type DeclarativeV2ArtifactIngressPlanV1,
  type DeclarativeV2MaterializationBudgetInputV1,
  type DeclarativeV2MaterializationBudgetV1,
  type DeclarativeV2MaterializationV1Error,
  type DeclarativeV2PrebuiltModuleGraphInputV1,
} from "@flarex/declarative-materializer/v1";
import { Result } from "effect";

export {
  standardValidatorV1FromExactJsonV1,
  standardV1,
  type AnyStandardFunctionContractV1,
  type InferStandardFunctionArgsV1,
  type InferStandardFunctionReturnV1,
  type InferStandardObjectV1,
  type InferStandardValidatorV1,
  type StandardFunctionArgsValidatorV1,
  type StandardFunctionCatalogV1,
  type StandardFunctionContractV1,
  type StandardFunctionContractInputV1,
  type StandardFunctionReferenceV1,
  type StandardIdV1,
  type StandardModuleV1,
  type StandardObjectValidatorV1,
  type StandardValidatorV1,
  type StandardValidatorOptionalityV1,
  type StandardValidatorFieldPathsV1,
  type StandardValidatorWithFieldPathsV1,
  type StandardValidatorRecordV1,
} from "./authoringV1";

export {
  type StandardSchemaDefinitionV1,
  type StandardTableCatalogV1,
  type StandardTableDefinitionV1,
  type StandardTableFieldPathsV1,
  type StandardTableIndexCatalogV1,
  type StandardTableIndexFieldsV1,
} from "./schemaAuthoringV1.js";

export interface StandardApplicationDefinitionInputV1 {
  readonly programBudgetInput: CanonicalDeclarativeProgramBudgetInputV1;
  readonly programInput: CanonicalDeclarativeProgramInputV1;
  readonly materializationBudgetInput:
    DeclarativeV2MaterializationBudgetInputV1;
  readonly graphInput: DeclarativeV2PrebuiltModuleGraphInputV1;
}

export interface PreparedStandardApplicationDefinitionV1 {
  readonly program: CanonicalDeclarativeProgramV1;
  readonly artifactIngressPlan: DeclarativeV2ArtifactIngressPlanV1;
}

export type StandardApplicationDefinitionV1Error =
  | CanonicalDeclarativeProgramV1Error
  | DeclarativeV2MaterializationV1Error;

/**
 * Normalizes explicit Standard Application intent through the canonical
 * program owner. Producer-specific SDK inspection remains above this stage.
 */
export function prepareStandardApplicationProgramV1(
  programInput: unknown,
  programBudget: CanonicalDeclarativeProgramBudgetV1,
): Result.Result<
  CanonicalDeclarativeProgramV1,
  CanonicalDeclarativeProgramV1Error
> {
  return decodeCanonicalDeclarativeProgramV1(programInput, programBudget);
}

/**
 * Materializes a canonical program and prebuilt graph through the artifact
 * materializer owner. Producer-specific bundling policy remains above this
 * stage.
 */
export function materializeStandardApplicationArtifactsV1(
  program: CanonicalDeclarativeProgramV1,
  graphInput: DeclarativeV2PrebuiltModuleGraphInputV1,
  materializationBudget: DeclarativeV2MaterializationBudgetV1,
): Result.Result<
  DeclarativeV2ArtifactIngressPlanV1,
  DeclarativeV2MaterializationV1Error
> {
  return materializeDeclarativeV2ArtifactsV1(
    program,
    graphInput,
    materializationBudget,
  );
}

/**
 * Purely prepares one explicit Standard Application definition through the
 * canonical-program and artifact-materializer owners.
 *
 * The result is inert. It is not authenticated analysis, verified
 * registration, an active application revision, or an execution capability.
 */
export function prepareStandardApplicationDefinitionV1(
  input: StandardApplicationDefinitionInputV1,
): Result.Result<
  PreparedStandardApplicationDefinitionV1,
  StandardApplicationDefinitionV1Error
> {
  return Result.gen(function* () {
    const programBudget = yield* makeCanonicalDeclarativeProgramBudgetV1(
      input.programBudgetInput,
    );
    const program = yield* prepareStandardApplicationProgramV1(
      input.programInput,
      programBudget,
    );
    const materializationBudget =
      yield* makeDeclarativeV2MaterializationBudgetV1(
        input.materializationBudgetInput,
      );
    const artifactIngressPlan = yield* materializeStandardApplicationArtifactsV1(
      program,
      input.graphInput,
      materializationBudget,
    );
    return { program, artifactIngressPlan };
  });
}
