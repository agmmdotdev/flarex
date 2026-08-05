import type {
  DeclarativeV2AnalyzerRegistrationCompleteV1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import type {
  PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import { Effect } from "effect";

/**
 * The exact terminal registration projection produced by the accepted
 * replacement analyzer after its authenticated session-owned parse and link
 * results pass the diagnostic-free registration gate. This alias does not
 * introduce another analysis representation or grant application-revision
 * registration authority.
 */
export type AuthenticatedVerifiedStandardApplicationAnalysisV1 =
  DeclarativeV2AnalyzerRegistrationCompleteV1;

/**
 * A request- or analyzer-session-owned capability that authenticates a
 * prepared definition and drives the accepted analyzer owner.
 *
 * The context stays explicit because several request-scoped analyzer sessions
 * may coexist. Host composition supplies it; ordinary application definitions
 * cannot construct trusted analyzer authority from their own data.
 */
export interface StandardApplicationAnalysisContextV1<
  Failure,
  Requirements = never,
> {
  readonly analyze: (
    preparedDefinition: PreparedStandardApplicationDefinitionV1,
  ) => Effect.Effect<
    AuthenticatedVerifiedStandardApplicationAnalysisV1,
    Failure,
    Requirements
  >;
}

/**
 * Runs one prepared Standard Application through its authenticated analyzer
 * context without translating the analyzer's success, failure, or requirement
 * channels.
 */
export const analyzeStandardApplicationV1 = Effect.fn(
  "StandardApplication.analyzeV1",
)(function* <Failure, Requirements>(
  preparedDefinition: PreparedStandardApplicationDefinitionV1,
  context: StandardApplicationAnalysisContextV1<Failure, Requirements>,
): Effect.fn.Return<
  AuthenticatedVerifiedStandardApplicationAnalysisV1,
  Failure,
  Requirements
> {
  return yield* context.analyze(preparedDefinition);
});
