import { bytesEqualFullScan, encodeBytesToLowercaseHex, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import type { TrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { Data, Effect, Schema } from "effect";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1Result, projectScopeEpochUuidV1Result } from "flarex-protocol/storage-authority";
import {
  openCommitEventEligibilityGroupInTransaction, decideCommitEventEligibilityGroupInTransaction,
  inspectCommitEventEligibilityGroupInTransaction, type CommitEventEligibilityGroup,
} from "../commit/events/eligibility";
import { EventName, EventRevision, eventError } from "../commit/events/model";
import { readCommitEventScopeTimeInTransaction, type CommitEventScopePins } from "../commit/events/transaction";
import type { TrustedScopeAuthority } from "../scope/scopeAuthorityResolution";
import type { AppRowTransaction } from "../storage/documents/appRows";
import { capturePrivateJsonData } from "../values/privateJsonData";
import { requireLockedTaskSystemScopeAuthorityV1 } from "./taskSystemScopeAuthorityV1";
import {
  requireDeadlineOwnedTaskPersistenceTarget, runDeadlineOwnedTaskPersistenceTransaction,
  type DeadlineOwnedTaskPersistenceTarget,
} from "./taskPersistenceTransaction";
import {
  captureTrustedWorkflowExecutionAuthority, requireLiveTrustedWorkflowInterpreterSubject,
  type TrustedWorkflowInterpreterSubject,
} from "./trustedWorkflowExecutionSubject";

const boundedCount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 }));
const Roles = Schema.Array(Schema.Struct({ role: EventName, policyRevision: EventRevision,
  maximumCommits: boundedCount, maximumOccurrences: boundedCount })).check(Schema.isLengthBetween(1, 2));
const Selection = Schema.Struct({ role: EventName, occurrence: boundedCount });
const decodeRoles = Schema.decodeUnknownEffect(Roles, { onExcessProperty: "error" });
const decodeSelection = Schema.decodeUnknownEffect(Selection, { onExcessProperty: "error" });
const utf8 = new TextEncoder();
export class TrustedWorkflowEventEligibilityError extends Data.TaggedError("TrustedWorkflowEventEligibilityError")<{
  readonly reason: "invalidTarget" | "invalidInput" | "invalidBinding" | "staleAuthority" | "storeFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: TrustedWorkflowEventEligibilityError["reason"], cause?: unknown) =>
  new TrustedWorkflowEventEligibilityError({ reason, ...(cause === undefined ? {} : { cause }) });

/** Trusted profile construction fixes roles and bounds. No native message group
 * string grants a capability, and no paused or stale attempt can decide a gate. */
export const makeTrustedWorkflowEventEligibilityStore = Effect.fn("TrustedWorkflowEligibility.makeStore")(
  function* <HashFailure>(input: {
    readonly authority: TrustedScopeAuthority;
    readonly target: DeadlineOwnedTaskPersistenceTarget;
    readonly binding: TrustedWorkflowTaskBinding;
    readonly principal: unknown;
    readonly principalCanonicalBytes: Uint8Array;
    readonly sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array, HashFailure>;
    readonly roles: unknown;
  }) {
    const target = yield* Effect.fromResult(requireDeadlineOwnedTaskPersistenceTarget(input.target))
      .pipe(Effect.mapError(cause => failure("invalidTarget", cause)));
    const authority = yield* captureTrustedWorkflowExecutionAuthority(input);
    const sha256 = input.sha256;
    const capturedRoles = yield* Effect.fromResult(capturePrivateJsonData(input.roles, 4096, () => failure("invalidInput")));
    const roles = yield* decodeRoles(capturedRoles.value).pipe(Effect.mapError(cause => failure("invalidInput", cause)));
    if (new Set(roles.map(role => role.role)).size !== roles.length) return yield* failure("invalidInput");
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authority.authority.scopeId))
      .pipe(Effect.mapError(cause => failure("staleAuthority", cause)));
    const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(authority.authority.epoch))
      .pipe(Effect.mapError(cause => failure("staleAuthority", cause)));
    const scopePins = Object.freeze({ scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid });
    const digest = Effect.fn("TrustedWorkflowEligibility.digest")(function* (value: Json) {
      const text = encodeCanonicalJson(value, issue => { throw new Error(`Invalid trusted eligibility identity: ${issue.reason}`); });
      const bytes = yield* sha256(utf8.encode(text));
      if (!isUint8ArrayWithByteLength(bytes, 32)) return yield* failure("invalidInput");
      return encodeBytesToLowercaseHex(bytes);
    });
    const transact = Effect.fn("TrustedWorkflowEligibility.transact")(<A, E>(subject: TrustedWorkflowInterpreterSubject, raw: unknown,
      work: (tx: AppRowTransaction, pins: CommitEventScopePins, group: CommitEventEligibilityGroup) => Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const captured = yield* Effect.fromResult(capturePrivateJsonData(raw, 1024, () => failure("invalidInput")));
        const selection = yield* decodeSelection(captured.value).pipe(Effect.mapError(cause => failure("invalidInput", cause)));
        const role = roles.find(candidate => candidate.role === selection.role);
        if (role === undefined || selection.occurrence > role.maximumOccurrences) return yield* failure("invalidInput");
        return yield* runDeadlineOwnedTaskPersistenceTransaction(target, "trustedWorkflowEligibility", tx => Effect.gen(function* () {
          yield* Effect.tryPromise({ try: () => requireLockedTaskSystemScopeAuthorityV1(tx, authority.authority, target,
            mismatch => failure("staleAuthority", mismatch)),
          catch: cause => cause instanceof TrustedWorkflowEventEligibilityError ? cause : failure("storeFailure", cause) });
          const pins = yield* requireLiveTrustedWorkflowInterpreterSubject(tx, subject, authority.authority);
          if (!bytesEqualFullScan(pins.bindingSha256, authority.binding.sha256)) return yield* failure("invalidBinding");
          const identity = { scopeId: pins.scopeId, runId: pins.runId, role: selection.role, occurrence: selection.occurrence };
          const groupId = `task-${yield* digest({ codec: "flarex.task-event-group.v1", ...identity })}`;
          const ownerIdentity = yield* digest({ codec: "flarex.task-event-group-owner.v1", ...identity,
            bindingSha256: encodeBytesToLowercaseHex(pins.bindingSha256), policy: role });
          // Open locks the exact existing group too, so the final live check
          // precedes the decision without a later blocking group acquisition.
          const group = yield* openCommitEventEligibilityGroupInTransaction(tx, scopePins,
            { groupId, ownerIdentity, policyRevision: role.policyRevision, maximumCommits: role.maximumCommits });
          yield* requireLiveTrustedWorkflowInterpreterSubject(tx, subject, authority.authority);
          const result = yield* work(tx, scopePins, group);
          yield* requireLiveTrustedWorkflowInterpreterSubject(tx, subject, authority.authority);
          return result;
        }), cause => failure(cause.reason, cause));
      }));
    const open = Effect.fn("TrustedWorkflowEligibility.open")((subject: TrustedWorkflowInterpreterSubject, selection: unknown) =>
      transact(subject, selection, (_tx, _pins, group) => Effect.succeed(group)));
    const inspect = Effect.fn("TrustedWorkflowEligibility.inspect")((subject: TrustedWorkflowInterpreterSubject, selection: unknown) =>
      transact(subject, selection, (tx, pins, group) => inspectCommitEventEligibilityGroupInTransaction(tx, pins, group)));
    const decide = Effect.fn("TrustedWorkflowEligibility.decide")((subject: TrustedWorkflowInterpreterSubject, selection: unknown, decision: "released" | "cleared") =>
      decision !== "released" && decision !== "cleared" ? Effect.fail(eventError("invalidInput")) :
        transact(subject, selection, (tx, pins, group) => readCommitEventScopeTimeInTransaction(tx, pins)
          .pipe(Effect.flatMap(now => decideCommitEventEligibilityGroupInTransaction(tx, pins, now, group, decision)))));
    return Object.freeze({ open, inspect, decide });
  });
