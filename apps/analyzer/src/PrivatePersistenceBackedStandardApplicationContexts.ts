import type {
  ApplicationRevisionRegistrationContextV1Error,
  ApplicationRevisionRegistrationEvidenceV1Error,
  PrepareApplicationRevisionAnalysisV1Error,
  PrivateApplicationRevisionAnalysisPreparationV1,
  PrivateApplicationRevisionRegistrationContextV1,
} from
  "@flarex/persistence-postgres/application-revision-registration-v1";
import type {
  AuthenticatedVerifiedStandardApplicationAnalysisV1,
  StandardApplicationAnalysisContextV1,
} from "@flarex/standard-application-analysis/v1";
import type {
  PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import { Effect, Scope } from "effect";
import type {
  DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import type {
  PrivateDeclarativeV2AnalyzerHostV1,
} from "./DeclarativeV2AnalyzerPort";
import {
  makePrivateStandardApplicationAnalysisContextV1,
  type PrivateStandardApplicationAnalysisFailureV1,
  type PrivateStandardApplicationAnalysisPlanV1,
} from "./StandardApplicationAnalysis";

export interface PrivatePersistenceBackedStandardApplicationPreparationV1 {
  readonly authenticatedEvidence: unknown;
  readonly attemptCeilings: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_ceilings";
  };
}

export interface PrivatePersistenceBackedStandardApplicationContextsV1<
  PreparationFailure,
  PlanFailure,
  EvidenceFailure,
  Requirements,
> {
  readonly analysis: StandardApplicationAnalysisContextV1<
    | PreparationFailure
    | PrepareApplicationRevisionAnalysisV1Error
    | PrivateStandardApplicationAnalysisFailureV1<PlanFailure>
    | EvidenceFailure
    | ApplicationRevisionRegistrationContextV1Error
    | ApplicationRevisionRegistrationEvidenceV1Error,
    Requirements | Scope.Scope
  >;
  readonly registration: PrivateApplicationRevisionRegistrationContextV1;
}

/**
 * Creates one request-owned analysis/registration pair.
 *
 * Candidate and attempt persistence happens before the accepted analyzer only
 * in this private lane. The exact returned analysis object is correlated with
 * its durable settlement before it is exposed to SAP03.
 */
export function makePrivatePersistenceBackedStandardApplicationContextsV1<
  PreparationFailure,
  PlanFailure,
  EvidenceFailure,
  Requirements = never,
>(options: Readonly<{
  readonly host: PrivateDeclarativeV2AnalyzerHostV1;
  readonly registration: PrivateApplicationRevisionRegistrationContextV1;
  readonly prepare: (
    definition: PreparedStandardApplicationDefinitionV1,
  ) => Effect.Effect<
    PrivatePersistenceBackedStandardApplicationPreparationV1,
    PreparationFailure,
    Requirements
  >;
  readonly plan: (
    definition: PreparedStandardApplicationDefinitionV1,
    preparation: PrivateApplicationRevisionAnalysisPreparationV1,
  ) => Effect.Effect<
    PrivateStandardApplicationAnalysisPlanV1,
    PlanFailure,
    Requirements
  >;
  readonly commandAuthority: (
    definition: PreparedStandardApplicationDefinitionV1,
    preparation: PrivateApplicationRevisionAnalysisPreparationV1,
    analysis: AuthenticatedVerifiedStandardApplicationAnalysisV1,
  ) => Effect.Effect<
    unknown,
    EvidenceFailure,
    Requirements
  >;
}>): PrivatePersistenceBackedStandardApplicationContextsV1<
  PreparationFailure,
  PlanFailure,
  EvidenceFailure,
  Requirements
> {
  const analyze = Effect.fn(
    "PrivatePersistenceBackedStandardApplication.analyze",
  )(function* (
    definition: PreparedStandardApplicationDefinitionV1,
  ) {
    const prepared = yield* options.prepare(definition);
    const registrationPreparation =
      yield* options.registration.prepareAnalysis({
        preparedDefinition: definition,
        authenticatedEvidence: prepared.authenticatedEvidence,
        attemptCeilings: prepared.attemptCeilings,
      });
    const plan = yield* options.plan(definition, registrationPreparation);
    const analysisContext = makePrivateStandardApplicationAnalysisContextV1({
      host: options.host,
      plan: () => Effect.succeed(plan),
    });
    const analysis = yield* analysisContext.analyze(definition);
    const command = yield* options.commandAuthority(
      definition,
      registrationPreparation,
      analysis,
    );
    yield* options.registration.correlateAnalysis(
      registrationPreparation,
      analysis,
      command,
    );
    return analysis;
  });

  return Object.freeze({
    analysis: Object.freeze({ analyze }),
    registration: options.registration,
  });
}
