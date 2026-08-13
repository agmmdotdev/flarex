import type {
  ApplicationTaskRuntimeReadinessReservationPort,
  ReserveApplicationTaskRuntimeReadinessError,
  ReserveApplicationTaskRuntimeReadinessInput,
} from
  "@flarex/persistence-postgres/internal/application-task-runtime-publication";
import {
  decodeTaskRuntimeMaterializationSpecV1,
  type InvalidTaskRuntimePublicationError,
  type TaskDefinitionSha256V1,
  type TaskRuntimeMaterializationSpecV1,
  type TaskRuntimeReadinessBasisV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";

import type {
  CapturedTaskRuntimeReadinessColdVerification,
  TaskRuntimeReadinessColdVerificationAuthority,
  TaskRuntimeReadinessColdVerificationError,
} from "./Authority.js";

export class TaskRuntimeReadinessConnectedVerificationConfigurationError
  extends Data.TaggedError(
    "TaskRuntimeReadinessConnectedVerificationConfigurationError",
  )<{
    readonly reason: "invalidPort" | "invalidMaterializationPolicy";
    readonly cause?: InvalidTaskRuntimePublicationError<
      "decode_materialization_spec"
    >;
  }> {}

export class TaskRuntimeReadinessConnectedVerificationProofError
  extends Data.TaggedError(
    "TaskRuntimeReadinessConnectedVerificationProofError",
  )<{
    readonly reason: "invalidProof";
  }> {}

export type TaskRuntimeReadinessConnectedVerificationError =
  | ReserveApplicationTaskRuntimeReadinessError
  | TaskRuntimeReadinessColdVerificationError;

export interface TaskRuntimeReadinessConnectedVerificationProof {
  readonly kind: "task_runtime_readiness_connected_verification";
}

export type TaskRuntimeReadinessConnectedVerificationResult =
  | Readonly<{
      readonly status: "not_ready";
      readonly revisionId: string;
      readonly reason: "readiness_snapshot_missing";
    }>
  | Readonly<{
      readonly status: "verified";
      readonly revisionId: string;
      readonly proof: TaskRuntimeReadinessConnectedVerificationProof;
    }>;

export interface CapturedTaskRuntimeReadinessConnectedVerification {
  readonly revisionId: string;
  readonly readReceiptSha256: () => TaskDefinitionSha256V1;
  readonly readBasis: () => TaskRuntimeReadinessBasisV1;
  readonly readCanonicalBytes: () => Uint8Array;
  readonly readSha256: () => TaskDefinitionSha256V1;
}

export interface TaskRuntimeReadinessConnectedVerificationAuthority {
  readonly verify: (
    input: ReserveApplicationTaskRuntimeReadinessInput,
  ) => Effect.Effect<
    TaskRuntimeReadinessConnectedVerificationResult,
    TaskRuntimeReadinessConnectedVerificationError
  >;
  readonly capture: (
    proof: unknown,
  ) => Result.Result<
    CapturedTaskRuntimeReadinessConnectedVerification,
    TaskRuntimeReadinessConnectedVerificationProofError
  >;
}

interface ConnectedProofState {
  readonly revisionId: string;
  readonly receiptSha256: TaskDefinitionSha256V1;
  readonly cold: CapturedTaskRuntimeReadinessColdVerification;
}

export function makeTaskRuntimeReadinessConnectedVerificationAuthority(
  reservation: Pick<
    ApplicationTaskRuntimeReadinessReservationPort,
    "reserve"
  >,
  cold: Pick<
    TaskRuntimeReadinessColdVerificationAuthority,
    "verify" | "capture"
  >,
  materializationPolicyInput: unknown,
): Result.Result<
  TaskRuntimeReadinessConnectedVerificationAuthority,
  TaskRuntimeReadinessConnectedVerificationConfigurationError
> {
  return capturePorts(reservation, cold).pipe(
    Result.flatMap(ports =>
      decodeTaskRuntimeMaterializationSpecV1(materializationPolicyInput).pipe(
        Result.mapError(cause => configurationFailure(
          "invalidMaterializationPolicy",
          cause,
        )),
        Result.map(materializationPolicy => makeAuthority(
          ports,
          materializationPolicy,
        )),
      )
    ),
  );
}

interface CapturedPorts {
  readonly reservationOwner: Pick<
    ApplicationTaskRuntimeReadinessReservationPort,
    "reserve"
  >;
  readonly reserve: ApplicationTaskRuntimeReadinessReservationPort["reserve"];
  readonly coldOwner: Pick<
    TaskRuntimeReadinessColdVerificationAuthority,
    "verify" | "capture"
  >;
  readonly verify: TaskRuntimeReadinessColdVerificationAuthority["verify"];
  readonly capture: TaskRuntimeReadinessColdVerificationAuthority["capture"];
}

function capturePorts(
  reservation: Pick<
    ApplicationTaskRuntimeReadinessReservationPort,
    "reserve"
  >,
  cold: Pick<
    TaskRuntimeReadinessColdVerificationAuthority,
    "verify" | "capture"
  >,
): Result.Result<
  CapturedPorts,
  TaskRuntimeReadinessConnectedVerificationConfigurationError
> {
  return Result.try({
    try: () => {
      const reserve = reservation.reserve;
      const verify = cold.verify;
      const capture = cold.capture;
      if (typeof reserve !== "function" || typeof verify !== "function" ||
        typeof capture !== "function") {
        throw new TypeError("Invalid readiness connected-verification ports.");
      }
      return Object.freeze({
        reservationOwner: reservation,
        reserve,
        coldOwner: cold,
        verify,
        capture,
      });
    },
    catch: () => configurationFailure("invalidPort"),
  });
}

function makeAuthority(
  ports: CapturedPorts,
  materializationPolicy: TaskRuntimeMaterializationSpecV1,
): TaskRuntimeReadinessConnectedVerificationAuthority {
  const proofStates = new WeakMap<object, ConnectedProofState>();
  const verify: TaskRuntimeReadinessConnectedVerificationAuthority["verify"] =
    Effect.fn("TaskRuntimeReadinessConnectedVerificationAuthority.verify")(
      function* (input) {
        const snapshot = yield* ports.reserve.call(
          ports.reservationOwner,
          input,
        );
        if (snapshot === null) {
          return Object.freeze({
            status: "not_ready" as const,
            revisionId: input.revisionId,
            reason: "readiness_snapshot_missing" as const,
          });
        }
        const revisionId = snapshot.revisionId;
        const receiptCanonicalBytes = snapshot.readReceiptCanonicalBytes();
        const receiptSha256 = snapshot.readReceiptSha256();
        const parentEvidence = snapshot.readParentEvidence();
        const coldProof = yield* ports.verify.call(ports.coldOwner, {
          receiptCanonicalBytes,
          receiptSha256,
          expected: Object.freeze({
            ...parentEvidence,
            materializationPolicy,
          }),
        });
        const capturedCold = yield* Effect.fromResult(
          ports.capture.call(ports.coldOwner, coldProof),
        ).pipe(Effect.orDie);
        const proof = Object.freeze({
          kind: "task_runtime_readiness_connected_verification" as const,
        });
        proofStates.set(proof, Object.freeze({
          revisionId,
          receiptSha256,
          cold: capturedCold,
        }));
        return Object.freeze({
          status: "verified" as const,
          revisionId,
          proof,
        });
      },
    );
  const capture: TaskRuntimeReadinessConnectedVerificationAuthority["capture"] =
    proof => {
      if (typeof proof !== "object" || proof === null) {
        return Result.fail(invalidProof());
      }
      const state = proofStates.get(proof);
      return state === undefined
        ? Result.fail(invalidProof())
        : Result.succeed(capturedConnectedProof(state));
    };
  return Object.freeze({ verify, capture });
}

function capturedConnectedProof(
  state: ConnectedProofState,
): CapturedTaskRuntimeReadinessConnectedVerification {
  const coldOwner = state.cold;
  const readBasis = state.cold.readBasis;
  const readCanonicalBytes = state.cold.readCanonicalBytes;
  const readSha256 = state.cold.readSha256;
  return Object.freeze({
    revisionId: state.revisionId,
    readReceiptSha256: () =>
      copyBytes(state.receiptSha256) as TaskDefinitionSha256V1,
    readBasis: () => readBasis.call(coldOwner),
    readCanonicalBytes: () => readCanonicalBytes.call(coldOwner),
    readSha256: () => readSha256.call(coldOwner),
  });
}

function configurationFailure(
  reason: TaskRuntimeReadinessConnectedVerificationConfigurationError["reason"],
  cause?: InvalidTaskRuntimePublicationError<"decode_materialization_spec">,
): TaskRuntimeReadinessConnectedVerificationConfigurationError {
  return new TaskRuntimeReadinessConnectedVerificationConfigurationError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function invalidProof(): TaskRuntimeReadinessConnectedVerificationProofError {
  return new TaskRuntimeReadinessConnectedVerificationProofError({
    reason: "invalidProof",
  });
}
