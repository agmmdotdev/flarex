import type {
  PointMutationAttemptDiscoveryCandidateV1,
  PointMutationAttemptDiscoveryContinuationV1,
  PointMutationAttemptDiscoveryV1,
  PointMutationAttemptDiscoveryV1Error,
} from "@flarex/persistence-postgres/point-mutation-attempt-discovery";
import { Effect } from "effect";

import type {
  PointMutationCrashRedispatchV1Error,
  PointMutationCrashRedispatchResultV1,
  StoredPointMutationCrashRedispatchV1,
} from "./storedAttemptAuthentication";

export type PointMutationAttemptRedeliveryDispositionV1 =
  | Readonly<{
      readonly kind: "published" | "replayed" | "expired";
      readonly token: PointMutationAttemptRedeliveryTokenV1;
    }>
  | Readonly<{ readonly kind: "busy" }>
  | PointMutationAttemptRedeliveryClosedV1;

export type PointMutationAttemptRedeliveryClosedV1 = Extract<
  PointMutationCrashRedispatchResultV1,
  { readonly kind: "closed" }
>;

export interface PointMutationAttemptRedeliveryItemV1 {
  readonly candidate: PointMutationAttemptDiscoveryCandidateV1;
  readonly disposition: PointMutationAttemptRedeliveryDispositionV1;
}

export interface PointMutationAttemptRedeliveryPageV1 {
  readonly horizon: string;
  readonly items: ReadonlyArray<PointMutationAttemptRedeliveryItemV1>;
  /** Inert discovery pagination data; never execution or retry authority. */
  readonly continuation: PointMutationAttemptDiscoveryContinuationV1 | null;
}

export type PointMutationAttemptRedeliveryV1Error =
  | PointMutationAttemptDiscoveryV1Error
  | PointMutationCrashRedispatchV1Error;

type PointMutationAttemptRedeliveryTokenV1 = Extract<
  PointMutationCrashRedispatchResultV1,
  { readonly kind: "published" | "replayed" | "expired" }
>["token"];

export interface PointMutationAttemptRedeliveryV1 {
  /**
   * Processes exactly one bounded discovery page in its canonical order.
   * The first typed failure stops the page and is preserved unchanged. A later
   * fresh sweep remains safe because exact-selector redispatch is outcome-first.
   */
  readonly sweepEffect: (
    input: unknown,
  ) => Effect.Effect<
    PointMutationAttemptRedeliveryPageV1,
    PointMutationAttemptRedeliveryV1Error,
    never
  >;
}

export function createPointMutationAttemptRedeliveryV1(
  discovery: Pick<PointMutationAttemptDiscoveryV1, "discoverEffect">,
  redispatch: Pick<
    StoredPointMutationCrashRedispatchV1,
    "redispatchExactPointMutationAttempt"
  >,
): PointMutationAttemptRedeliveryV1 {
  const sweepEffect: PointMutationAttemptRedeliveryV1["sweepEffect"] =
    Effect.fn("PointMutationAttemptRedelivery.sweep")(function* (input) {
      const page = yield* discovery.discoverEffect(input);
      const items: Array<PointMutationAttemptRedeliveryItemV1> = [];
      for (const candidate of page.candidates) {
        const result = yield* redispatch.redispatchExactPointMutationAttempt(
          selectorInputForRedispatch(candidate),
        );
        items.push(Object.freeze({
          candidate: captureCandidate(candidate),
          disposition: captureDisposition(result),
        }));
      }
      return Object.freeze({
        horizon: page.horizon,
        items: Object.freeze(items),
        continuation: page.continuation === null
          ? null
          : captureContinuation(page.continuation),
      });
    });

  return Object.freeze({ sweepEffect });
}

function selectorInputForRedispatch(
  candidate: PointMutationAttemptDiscoveryCandidateV1,
): Readonly<{
  readonly deploymentId: string;
  readonly scopeId: string;
  readonly sessionId: string;
  readonly attemptFence: string;
}> {
  return Object.freeze({
    deploymentId: candidate.selector.deploymentId,
    scopeId: candidate.selector.scopeId,
    sessionId: candidate.selector.sessionId,
    attemptFence: candidate.selector.attemptFence.toString(),
  });
}

function captureCandidate(
  candidate: PointMutationAttemptDiscoveryCandidateV1,
): PointMutationAttemptDiscoveryCandidateV1 {
  return Object.freeze({
    selector: Object.freeze({ ...candidate.selector }),
    source: candidate.source,
    eligibleAt: candidate.eligibleAt,
  });
}

function captureContinuation(
  continuation: PointMutationAttemptDiscoveryContinuationV1,
): PointMutationAttemptDiscoveryContinuationV1 {
  return Object.freeze({ ...continuation });
}

function captureToken(
  token: PointMutationAttemptRedeliveryTokenV1,
): PointMutationAttemptRedeliveryTokenV1 {
  return Object.freeze({ ...token });
}

function captureDisposition(
  result: PointMutationCrashRedispatchResultV1,
): PointMutationAttemptRedeliveryDispositionV1 {
  switch (result.kind) {
    case "published":
    case "replayed":
    case "expired":
      return Object.freeze({
        kind: result.kind,
        token: captureToken(result.token),
      });
    case "busy":
      return Object.freeze({ kind: "busy" });
    case "closed": {
      if (result.reason === "authorityExpired") {
        return Object.freeze({
          kind: "closed",
          reason: result.reason,
          lifecycle: result.lifecycle,
          terminalizedAt: result.terminalizedAt,
        });
      }
      return Object.freeze({
        kind: "closed",
        reason: result.reason,
        lifecycle: result.lifecycle,
        terminalizedAt: result.terminalizedAt,
      });
    }
  }
}
