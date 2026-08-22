import { Context, type Effect } from "effect";
import type { RunAttemptLifecycleErrorV1 } from "../Errors.js";
import type {
  ApplicationCompleteAttemptOutcomeV1,
  ApplicationHandleLeaseExpiryOutcomeV1,
  ApplicationHeartbeatAttemptOutcomeV1,
  ApplicationRequestCancellationOutcomeV1,
  ApplicationStartAttemptOutcomeV1,
  ApplicationTaskSystemRunAttemptTransactionReceiptV1,
  CompleteAttemptCommandV1,
  CompleteAttemptOutcomeV1,
  HandleLeaseExpiryCommandV1,
  HandleLeaseExpiryOutcomeV1,
  HeartbeatAttemptCommandV1,
  HeartbeatAttemptOutcomeV1,
  InspectCurrentAttemptCommandV1,
  RequestCancellationCommandV1,
  RequestCancellationOutcomeV1,
  RunAttemptInspectionV1,
  RunAttemptServiceReceiptV1,
  StartAttemptCommandV1,
  StartAttemptOutcomeV1,
} from "../Model.js";

export interface ApplicationRunAttemptLifecycleShapeV1 {
  readonly startAttempt: (command: StartAttemptCommandV1) => Effect.Effect<
    ApplicationTaskSystemRunAttemptTransactionReceiptV1<
      ApplicationStartAttemptOutcomeV1
    >,
    RunAttemptLifecycleErrorV1
  >;
  readonly heartbeatAttempt: (command: HeartbeatAttemptCommandV1) => Effect.Effect<
    ApplicationTaskSystemRunAttemptTransactionReceiptV1<
      ApplicationHeartbeatAttemptOutcomeV1
    >,
    RunAttemptLifecycleErrorV1
  >;
  readonly completeAttempt: (command: CompleteAttemptCommandV1) => Effect.Effect<
    ApplicationTaskSystemRunAttemptTransactionReceiptV1<
      ApplicationCompleteAttemptOutcomeV1
    >,
    RunAttemptLifecycleErrorV1
  >;
  readonly requestCancellation: (command: RequestCancellationCommandV1) => Effect.Effect<
    ApplicationTaskSystemRunAttemptTransactionReceiptV1<
      ApplicationRequestCancellationOutcomeV1
    >,
    RunAttemptLifecycleErrorV1
  >;
  readonly handleLeaseExpiry: (command: HandleLeaseExpiryCommandV1) => Effect.Effect<
    ApplicationTaskSystemRunAttemptTransactionReceiptV1<
      ApplicationHandleLeaseExpiryOutcomeV1
    >,
    RunAttemptLifecycleErrorV1
  >;
}

export interface RunAttemptLifecycleShape {
  readonly startAttempt: (command: StartAttemptCommandV1) => Effect.Effect<
    RunAttemptServiceReceiptV1<StartAttemptOutcomeV1>, RunAttemptLifecycleErrorV1
  >;
  readonly heartbeatAttempt: (command: HeartbeatAttemptCommandV1) => Effect.Effect<
    RunAttemptServiceReceiptV1<HeartbeatAttemptOutcomeV1>, RunAttemptLifecycleErrorV1
  >;
  readonly completeAttempt: (command: CompleteAttemptCommandV1) => Effect.Effect<
    RunAttemptServiceReceiptV1<CompleteAttemptOutcomeV1>, RunAttemptLifecycleErrorV1
  >;
  readonly requestCancellation: (command: RequestCancellationCommandV1) => Effect.Effect<
    RunAttemptServiceReceiptV1<RequestCancellationOutcomeV1>, RunAttemptLifecycleErrorV1
  >;
  readonly handleLeaseExpiry: (command: HandleLeaseExpiryCommandV1) => Effect.Effect<
    RunAttemptServiceReceiptV1<HandleLeaseExpiryOutcomeV1>, RunAttemptLifecycleErrorV1
  >;
  readonly inspectCurrentAttempt: (command: InspectCurrentAttemptCommandV1) => Effect.Effect<
    RunAttemptInspectionV1, RunAttemptLifecycleErrorV1
  >;
}

export class RunAttemptLifecycle extends Context.Service<
  RunAttemptLifecycle,
  RunAttemptLifecycleShape
>()("FlarexDurableTask/RunAttemptLifecycle") {}
