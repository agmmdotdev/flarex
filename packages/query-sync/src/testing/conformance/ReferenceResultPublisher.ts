import { Effect, Ref, SynchronizedRef } from "effect";

import {
  makePendingQueryPublication,
  queryPublicationIdentityEquals,
} from "../../kernel/Publication.js";
import type {
  PendingQueryPublication,
} from "../../kernel/Publication.js";
import type {
  PublicationDeliveryBudget,
  ResultPublisher,
} from "../../orchestration/publication/Ports.js";

export interface ReferenceResultPublisherCall {
  readonly publication: PendingQueryPublication;
  readonly budget: PublicationDeliveryBudget;
}

export interface ReferenceResultDestinationAcceptance {
  readonly _tag: "appended" | "alreadyAccepted";
  readonly publication: PendingQueryPublication;
}

export interface ReferenceResultDestinationSnapshot {
  readonly acceptedPublications: readonly PendingQueryPublication[];
}

export type ReferenceResultPublisherStep = (
  call: ReferenceResultPublisherCall,
  destination: ReferenceResultDestinationAccess,
) => ReturnType<ResultPublisher["publish"]>;

export interface ReferenceResultPublisher extends ResultPublisher {
  readonly snapshotForConformance: () => Effect.Effect<
    readonly ReferenceResultPublisherCall[],
    never,
    never
  >;
}

export interface ReferenceResultDestinationAccess {
  readonly acceptExact: (
    publication: PendingQueryPublication,
  ) => Effect.Effect<ReferenceResultDestinationAcceptance, never, never>;
  readonly snapshotForConformance: () => Effect.Effect<
    ReferenceResultDestinationSnapshot,
    never,
    never
  >;
}

export interface ReferenceResultDestination
  extends ReferenceResultDestinationAccess {
  readonly makePublisher: (
    steps: readonly ReferenceResultPublisherStep[],
  ) => Effect.Effect<ReferenceResultPublisher, never, never>;
}

export interface ReferenceResultPublisherHarness {
  readonly makeDestination: () => Effect.Effect<
    ReferenceResultDestination,
    never,
    never
  >;
}

export type ReferenceResultDestinationInvariantReason =
  | "publicationIdentityCollision";

export class ReferenceResultDestinationInvariantDefect extends Error {
  readonly _tag = "ReferenceResultDestinationInvariantDefect";
  readonly operation = "acceptExact";

  constructor(
    readonly reason: ReferenceResultDestinationInvariantReason,
  ) {
    super(`Reference result destination invariant failed: ${reason}.`);
    this.name = "ReferenceResultDestinationInvariantDefect";
  }
}

interface ReferenceResultDestinationState {
  readonly acceptedPublications: readonly PendingQueryPublication[];
}

interface ReferenceResultPublisherState {
  readonly nextStepIndex: number;
  readonly calls: readonly ReferenceResultPublisherCall[];
}

type ReferenceResultDestinationDecision =
  | Readonly<{
    readonly _tag: "accepted";
    readonly acceptance: ReferenceResultDestinationAcceptance;
  }>
  | Readonly<{
    readonly _tag: "collision";
    readonly defect: ReferenceResultDestinationInvariantDefect;
  }>;

function capturePublicationDeliveryBudget(
  budget: PublicationDeliveryBudget,
): PublicationDeliveryBudget {
  return Object.freeze({
    remainingPublisherCallsIncludingThisCall:
      budget.remainingPublisherCallsIncludingThisCall,
    maximumSettlementMilliseconds: budget.maximumSettlementMilliseconds,
  });
}

function capturePublisherCall(
  publication: PendingQueryPublication,
  budget: PublicationDeliveryBudget,
): ReferenceResultPublisherCall {
  return Object.freeze({
    publication,
    budget: capturePublicationDeliveryBudget(budget),
  });
}

function captureAcceptedPublication(
  publication: PendingQueryPublication,
): PendingQueryPublication {
  return makePendingQueryPublication(publication);
}

function publicationMatchesAcceptedObservation(
  left: PendingQueryPublication,
  right: PendingQueryPublication,
): boolean {
  return left.resultDigest === right.resultDigest
    && left.content === right.content;
}

function makeAcceptance(
  disposition: ReferenceResultDestinationAcceptance["_tag"],
  publication: PendingQueryPublication,
): ReferenceResultDestinationAcceptance {
  return Object.freeze({
    _tag: disposition,
    publication: captureAcceptedPublication(publication),
  });
}

function captureDestinationSnapshot(
  state: ReferenceResultDestinationState,
): ReferenceResultDestinationSnapshot {
  return Object.freeze({
    acceptedPublications: Object.freeze(
      state.acceptedPublications.map(captureAcceptedPublication),
    ),
  });
}

function capturePublisherCalls(
  calls: readonly ReferenceResultPublisherCall[],
): readonly ReferenceResultPublisherCall[] {
  return Object.freeze(calls.map((call) => capturePublisherCall(
    call.publication,
    call.budget,
  )));
}

const makeReferenceResultPublisher = Effect.fn(
  "QuerySync.ReferenceResultPublisher.make",
)(function*(
  destination: ReferenceResultDestinationAccess,
  stepsInput: readonly ReferenceResultPublisherStep[],
): Effect.fn.Return<ReferenceResultPublisher> {
    const steps = Object.freeze([...stepsInput]);
    const stateRef = yield* Ref.make<ReferenceResultPublisherState>(
      Object.freeze({
        nextStepIndex: 0,
        calls: Object.freeze([]),
      }),
    );

    const publish: ResultPublisher["publish"] = Effect.fn(
      "QuerySync.ReferenceResultPublisher.publish",
    )(function*(publication, budget) {
      const call = capturePublisherCall(publication, budget);
      const step = yield* Ref.modify(stateRef, (state) => [
        steps[state.nextStepIndex],
        Object.freeze({
          nextStepIndex: state.nextStepIndex + 1,
          calls: Object.freeze([...state.calls, call]),
        }),
      ]);
      if (step === undefined) {
        return yield* Effect.die(
          "Reference result publisher script exhausted",
        );
      }
      return yield* step(call, destination);
    });

    const snapshotForConformance = Effect.fn(
      "QuerySync.ReferenceResultPublisher.snapshotForConformance",
    )(function*(): Effect.fn.Return<
      readonly ReferenceResultPublisherCall[]
    > {
      const state = yield* Ref.get(stateRef);
      return capturePublisherCalls(state.calls);
    });

  return Object.freeze({ publish, snapshotForConformance });
});

const makeReferenceResultDestination = Effect.fn(
  "QuerySync.ReferenceResultPublisherHarness.makeDestination",
)(function*(): Effect.fn.Return<ReferenceResultDestination> {
  const stateRef = yield* SynchronizedRef.make<
    ReferenceResultDestinationState
  >(Object.freeze({ acceptedPublications: Object.freeze([]) }));

  const acceptExact = Effect.fn(
    "QuerySync.ReferenceResultDestination.acceptExact",
  )(function*(publicationInput): Effect.fn.Return<
    ReferenceResultDestinationAcceptance
  > {
    const publication = captureAcceptedPublication(publicationInput);
    const decision = yield* SynchronizedRef.modify(
      stateRef,
      (state): readonly [
        ReferenceResultDestinationDecision,
        ReferenceResultDestinationState,
      ] => {
        const existing = state.acceptedPublications.find((candidate) =>
          queryPublicationIdentityEquals(
            candidate.identity,
            publication.identity,
          )
        );
        if (existing === undefined) {
          const acceptance = makeAcceptance("appended", publication);
          return [
            Object.freeze({ _tag: "accepted", acceptance }),
            Object.freeze({
              acceptedPublications: Object.freeze([
                ...state.acceptedPublications,
                captureAcceptedPublication(publication),
              ]),
            }),
          ];
        }
        if (!publicationMatchesAcceptedObservation(existing, publication)) {
          return [
            Object.freeze({
              _tag: "collision",
              defect: new ReferenceResultDestinationInvariantDefect(
                "publicationIdentityCollision",
              ),
            }),
            state,
          ];
        }
        return [
          Object.freeze({
            _tag: "accepted",
            acceptance: makeAcceptance("alreadyAccepted", existing),
          }),
          state,
        ];
      },
    );
    if (decision._tag === "collision") {
      return yield* Effect.die(decision.defect);
    }
    return decision.acceptance;
  });

  const snapshotForConformance = Effect.fn(
    "QuerySync.ReferenceResultDestination.snapshotForConformance",
  )(function*(): Effect.fn.Return<ReferenceResultDestinationSnapshot> {
    const state = yield* SynchronizedRef.get(stateRef);
    return captureDestinationSnapshot(state);
  });

  const destinationAccess: ReferenceResultDestinationAccess = Object.freeze({
    acceptExact,
    snapshotForConformance,
  });

  const makePublisher = Effect.fn(
    "QuerySync.ReferenceResultDestination.makePublisher",
  )(function*(steps): Effect.fn.Return<ReferenceResultPublisher> {
    return yield* makeReferenceResultPublisher(destinationAccess, steps);
  });

  return Object.freeze({
    ...destinationAccess,
    makePublisher,
  });
});

export const makeReferenceResultPublisherHarness = Effect.fn(
  "QuerySync.ReferenceResultPublisherHarness.make",
)((): Effect.Effect<ReferenceResultPublisherHarness, never, never> =>
  Effect.succeed(Object.freeze({
    makeDestination: makeReferenceResultDestination,
  }))
);
