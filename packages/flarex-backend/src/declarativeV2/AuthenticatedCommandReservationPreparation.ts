/**
 * Private reservation-preparation surface for the persistence-backed analyzer
 * lane. This subpath deliberately exposes only process-local opaque authority
 * and commitment projections; it is not a public System API or wire contract.
 */
import { Effect } from "effect";

import type {
  DeclarativeV2AuthenticatedCommandPreparedReservationClaimV1,
  DeclarativeV2AuthenticatedCommandProducerApiV1,
  DeclarativeV2AuthenticatedCommandProducerV1Error,
  DeclarativeV2AuthenticatedCommandReservationLineageV1,
} from "./AuthenticatedCommandProducer";

export interface DeclarativeV2AuthenticatedCommandPreparedReservationClaimPortV1 {
  readonly claim: (
    authority: unknown,
    lineage: DeclarativeV2AuthenticatedCommandReservationLineageV1,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedCommandPreparedReservationClaimV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error,
    never
  >;
}

export function makeDeclarativeV2AuthenticatedCommandPreparedReservationClaimPortV1(
  producer: Pick<
    DeclarativeV2AuthenticatedCommandProducerApiV1,
    "claimPreparedReservation"
  >,
): DeclarativeV2AuthenticatedCommandPreparedReservationClaimPortV1 {
  return Object.freeze({
    claim: Effect.fn(
      "DeclarativeV2AuthenticatedCommandPreparedReservationClaimPort.claim",
    )(function* (
      authority: unknown,
      lineage: DeclarativeV2AuthenticatedCommandReservationLineageV1,
    ) {
      return yield* Effect.fromResult(
        producer.claimPreparedReservation(authority, lineage),
      );
    }),
  });
}

export {
  type DeclarativeV2AuthenticatedCommandPreparedReservationClaimV1,
  type DeclarativeV2AuthenticatedCommandPreparedReservationV1,
  type DeclarativeV2AuthenticatedCommandProducerV1Error,
  type DeclarativeV2AuthenticatedCommandReservationCommitmentsV1,
  type DeclarativeV2AuthenticatedCommandReservationLineageV1,
} from "./AuthenticatedCommandProducer";
