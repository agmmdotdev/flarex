import type {
  ApplicationAnalysisReceiptV1,
  ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { Effect } from "effect";

export interface StandardApplicationAnalysisInput {
  readonly requestKey: string;
  readonly sourceArtifactRootSha256: string;
}

export type StandardApplicationAnalysis =
  | Readonly<{
    readonly kind: "analyzed";
    readonly receipt: Extract<
      ApplicationAnalysisReceiptV1,
      { readonly status: "analyzed" }
    >;
    readonly manifest: ApplicationManifestV1;
  }>
  | Readonly<{
    readonly kind: "rejected";
    readonly receipt: Extract<
      ApplicationAnalysisReceiptV1,
      { readonly status: "rejected" }
    >;
  }>;

/**
 * Trusted host composition owns Source Artifact reads, cold analysis, and
 * durable first-terminal settlement. Standard definitions cannot construct
 * this authority from their own metadata.
 */
export interface StandardApplicationAnalysisContext<
  Failure,
  Requirements = never,
> {
  readonly analyze: (
    input: StandardApplicationAnalysisInput,
  ) => Effect.Effect<StandardApplicationAnalysis, Failure, Requirements>;
}

export const analyzeStandardApplication = Effect.fn(
  "StandardApplication.analyze",
)(function* <Failure, Requirements>(
  input: StandardApplicationAnalysisInput,
  context: StandardApplicationAnalysisContext<Failure, Requirements>,
): Effect.fn.Return<StandardApplicationAnalysis, Failure, Requirements> {
  return yield* context.analyze(input);
});
