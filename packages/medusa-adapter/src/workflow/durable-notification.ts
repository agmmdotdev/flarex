import { Effect, Result, Schema, type Cause } from "effect";
import type { NotificationTypes } from "@medusajs/types";
import { commerceCommandIdentity, defineAtomicCommerceCommand, defineAtomicCommerceParticipant, defineCommerceEventContract,
  type AtomicCommerceEvents, type AtomicCommerceParticipantInput, type TaskAtomicCommerceHost } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeTrustedWorkflowCallbackJournal, TrustedWorkflowCallbackDefinitionSchema,
  type TrustedWorkflowCallbackOutcome } from "@flarex/persistence-postgres/internal/trusted-workflow-callback";
import { makeTrustedWorkflowEventEligibilityStore } from "@flarex/persistence-postgres/internal/trusted-workflow-event-eligibility";
import { inspectTrustedWorkflowInterpreterSubject, type TrustedWorkflowInterpreterSubject, type TrustedWorkflowExecutionSubject,
  type TrustedWorkflowControlSubject } from "@flarex/persistence-postgres/internal/trusted-workflow-execution-subject";
import { prepareCommitEventEligibility } from "@flarex/persistence-postgres/internal/commit-event-eligibility";
import { jsonEqual } from "flarex-protocol/json";
import type { makeLocalNotificationCommands } from "../modules/notification/service";
import { captureCommerceInput } from "../value/input";
import { commerceDecoder } from "../value/decoder";
import { captureWorkflowPolicy, captureWorkflowRecord } from "./configuration";
import type { AtomicWorkflowExecution } from "./host";
import { isDurableNativeBoundaryFailure, type DurableNativeEffectBoundary } from "./durable-native-storage";

type NotificationRuntime = Effect.Success<ReturnType<typeof makeLocalNotificationCommands>>;
type TaskOptions = Omit<Parameters<typeof makeTrustedWorkflowEventEligibilityStore>[0], "roles">;
type LogicalStorage = Extract<AtomicCommerceParticipantInput, { readonly logicalStorage: unknown }>["logicalStorage"];
export type DurableNotificationRole = "success" | "failure";
/** Supplied by the trusted outer interpreter's one actual Effect runtime. */
export type DurableNotificationEffectBoundary = DurableNativeEffectBoundary;
export interface DurableNotificationService {
  readonly createNotifications: (input: unknown) => Promise<NotificationTypes.NotificationDTO | NotificationTypes.NotificationDTO[]>;
}
const providerResult = commerceDecoder(Schema.Struct({}), "storedCorruption");
const knownProviderFailure = commerceDecoder(Schema.Struct({ message: Schema.String.check(Schema.isMaxLength(4096)) }), "unsupportedProfile");
const callbackBudget = commerceDecoder(TrustedWorkflowCallbackDefinitionSchema.fields.maximumCallbackMs, "unsupportedProfile");
const rolePlan = Object.freeze({
  success: Object.freeze({ prepare: 2n, finalize: 3n, callback: 1n, gate: 1, allowControl: false }),
  failure: Object.freeze({ prepare: 4n, finalize: 5n, callback: 2n, gate: 2, allowControl: true }),
});

/** Native Notification's real two persistence phases and provider port under
 * one Task parent. No database transaction spans the native provider callback.
 * The parent/native engine owns final parent release or clearing and recovery. */
export const prepareDurableNotification = Effect.fn("Notification.prepareDurable")(
  function* (input: {
    readonly execution: AtomicWorkflowExecution<TaskAtomicCommerceHost>;
    readonly logicalStorage: LogicalStorage;
    readonly runtime: NotificationRuntime;
    readonly revision: string;
    readonly subscribers: AtomicCommerceEvents["subscribers"];
    readonly task: TaskOptions;
    readonly maximumCallbackMs: number;
  }) {
    const options = yield* Effect.fromResult(captureWorkflowRecord(input));
    const execution = yield* Effect.fromResult(captureWorkflowRecord(options.execution));
    const runtime = yield* Effect.fromResult(captureWorkflowRecord(options.runtime));
    const task = yield* Effect.fromResult(captureWorkflowRecord(options.task));
    const maximumCallbackMs = yield* Effect.fromResult(callbackBudget(options.maximumCallbackMs));
    if (!/^[0-9a-f]{64}$/.test(options.revision) || typeof execution.prepare !== "function")
      return yield* commerceError("unsupportedProfile");
    const commandIdentities = [commerceCommandIdentity(runtime.prepare), commerceCommandIdentity(runtime.finalize)];
    if (commandIdentities[0]?.name !== "notificationPrepare" || commandIdentities[1]?.name !== "notificationFinalize" ||
      commandIdentities.some(identity => identity?.mode !== "write")) return yield* commerceError("invalidAuthority");
    const eligibility = yield* makeTrustedWorkflowEventEligibilityStore({ ...task, roles: [
      { role: "parent", policyRevision: options.revision, maximumCommits: 5, maximumOccurrences: 1 },
      { role: "notification", policyRevision: options.revision, maximumCommits: 2, maximumOccurrences: 2 },
    ] });
    const participant = defineAtomicCommerceParticipant("notification");
    const prepare = defineAtomicCommerceCommand("durableNotificationPrepare", (ctx, args) => ctx.call(participant, runtime.prepare, args));
    const finalize = defineAtomicCommerceCommand("durableNotificationFinalize", (ctx, args) => ctx.call(participant, runtime.finalize, args));
    const policy = runtime.logicalEventPolicy();
    const eventDefinitions = ["created", "updated"].map(action => ({ name: `notification.notification.${action}`,
      token: defineCommerceEventContract({ name: `notification.notification.${action}`, revision: options.revision, internal: true, decode: policy.capture }) }));
    const contracts = eventDefinitions.map(event => event.token);
    const identityAndAccessPolicy = yield* Effect.fromResult(captureWorkflowPolicy({
      profile: "native.notification.local-feed.task", revision: options.revision, execution: execution.identityAndAccessPolicy,
      module: runtime.source, commands: commandIdentities,
      events: eventDefinitions.map(event => event.name), eventPolicy: "native.Notification.original-phase-messages",
      phases: { success: { prepare: "2", finalize: "3", callback: "1", gate: 1 }, failure: { prepare: "4", finalize: "5", callback: "2", gate: 2 } },
      maximumCallbackMs,
    }));
    const composition = { participants: [{ participant, logicalStorage: options.logicalStorage,
      commands: [runtime.prepare, runtime.finalize], validateLogicalCall: policy.validateLogicalCall,
      events: { contracts, select: (message: Json) => {
        const selected = eventDefinitions.find(event => isJsonObject(message) && message.name === event.name);
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selected.token);
      } } }], commands: [prepare, finalize], taskControlCommands: [prepare, finalize],
      identityAndAccessPolicy, executionIsolation: "scopeExclusive" as const,
      events: { producerRevision: options.revision, contracts, subscribers: options.subscribers,
        validate: (events: Parameters<AtomicCommerceEvents["validate"]>[0]) => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    };
    const host = yield* execution.prepare(composition);
    const parentFor = (subject: TrustedWorkflowInterpreterSubject) => eligibility.open(subject, { role: "parent", occurrence: 1 });
    const decideParent = (subject: TrustedWorkflowInterpreterSubject, decision: "released" | "cleared") =>
      eligibility.decide(subject, { role: "parent", occurrence: 1 }, decision);
    const gateSelection = (role: DurableNotificationRole) => ({ role: "notification", occurrence: rolePlan[role].gate });
    const clearRole = (subject: TrustedWorkflowInterpreterSubject, role: DurableNotificationRole) => eligibility.decide(subject, gateSelection(role), "cleared");
    const sticky = new WeakMap<TrustedWorkflowInterpreterSubject, Cause.Cause<unknown>>();

    const serviceFor = (role: DurableNotificationRole, subject: TrustedWorkflowInterpreterSubject,
      boundary: DurableNotificationEffectBoundary): DurableNotificationService => {
      const pins = Result.getOrThrow(inspectTrustedWorkflowInterpreterSubject(subject));
      if ((role !== "success" && role !== "failure") || (pins.executionMode === "control" && role !== "failure"))
        throw commerceError("invalidAuthority");
      const plan = rolePlan[role];
      let prepared: ReturnType<NotificationRuntime["decodePreparedPacket"]> | undefined;
      let finalized: ReturnType<NotificationRuntime["decodeFinalizedPacket"]> | undefined;
      const run = <A, E>(effect: Effect.Effect<A, E>) => boundary(Effect.suspend(() => {
        const previous = sticky.get(subject);
        return previous === undefined ? effect : Effect.failCause(previous);
      }).pipe(Effect.tapCause(cause => Effect.sync(() => { if (!sticky.has(subject)) sticky.set(subject, cause); }))));
      const childEligibility = Effect.gen(function* () {
        const parent = yield* parentFor(subject);
        const gate = yield* eligibility.open(subject, gateSelection(role));
        return yield* Effect.fromResult(prepareCommitEventEligibility([parent, gate]));
      });
      const dispatch = (occurrence: bigint, command: typeof prepare, value: Json) => Effect.gen(function* () {
        const groups = yield* childEligibility;
        if (pins.executionMode === "control") {
          // SAFETY: the genuine issuer inspection proved this exact opaque
          // subject's mode. The core repeats live control authentication.
          return yield* host.runControlChild(subject as TrustedWorkflowControlSubject, occurrence, command, value, groups);
        }
        // SAFETY: same authentic mode correlation; no structural cast admits a
        // subject and the core rechecks the live workflow attempt and lease.
        return yield* host.runTaskChild(subject as TrustedWorkflowExecutionSubject, occurrence, command, value, groups);
      });
      return runtime.createService({
        prepare: async value => await run(dispatch(plan.prepare, prepare, value).pipe(Effect.flatMap(packet => Effect.gen(function* () {
          prepared = runtime.decodePreparedPacket(packet);
          yield* Effect.fromResult(prepared);
          return packet;
        })))),
        finalize: async value => await run(dispatch(plan.finalize, finalize, value).pipe(Effect.flatMap(packet => Effect.gen(function* () {
          finalized = runtime.decodeFinalizedPacket(packet);
          yield* Effect.fromResult(finalized);
          return packet;
        })))),
        deliver: async (value, send) => {
          const outcome = await run(Effect.gen(function* () {
            const invoke = (): Effect.Effect<TrustedWorkflowCallbackOutcome, unknown> => Effect.gen(function* () {
              const result = yield* Effect.tryPromise({ try: send, catch: (cause): unknown => cause }).pipe(
                Effect.map(value => ({ kind: "returned" as const, value })),
                // This boundary owns only the actual local provider Promise. A
                // bounded own Error.message is native provider failure data;
                // everything else, including core Causes, remains a failure.
                Effect.catch(cause => {
                  if (isDurableNativeBoundaryFailure(cause) || !(cause instanceof Error)) return Effect.fail(cause);
                  const descriptor = Object.getOwnPropertyDescriptor(cause, "message");
                  if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string") return Effect.fail(cause);
                  const decoded = knownProviderFailure({ message: descriptor.value });
                  return Result.isFailure(decoded) ? Effect.fail(cause) : Effect.succeed({ kind: "failed" as const, error: decoded.success });
                }),
              );
              // Validation belongs after the narrow foreign failure adapter;
              // a bad provider result cannot become a known provider failure.
              if (result.kind === "failed") return result;
              const captured = yield* Effect.fromResult(captureCommerceInput(result.value));
              return { kind: "returned", value: yield* Effect.fromResult(providerResult(captured)) };
            });
            const journal = yield* makeTrustedWorkflowCallbackJournal({ ...task, definition: {
              id: `medusa.notification.local.${role}`, revision: options.revision, allowControl: plan.allowControl,
              inputCodecRevision: "medusa.notification.local-input.v1", outcomeCodecRevision: "medusa.notification.local-outcome.v1",
              maximumCallbackMs,
            } }, invoke);
            const recorded = yield* journal.run(subject, plan.callback, value);
            return recorded.kind === "returned"
              ? { kind: "returned" as const, value: yield* Effect.fromResult(providerResult(recorded.value)) }
              : { kind: "failed" as const, error: yield* Effect.fromResult(knownProviderFailure(recorded.error)) };
          }));
          // Native delivery wraps this genuine provider failure and performs
          // its real failure status update. Core failure never reaches here.
          if (outcome.kind === "failed") throw new Error(outcome.error.message);
          return outcome.value;
        },
        emit: async messages => { await run(Effect.gen(function* () {
          if (prepared === undefined || finalized === undefined) return yield* commerceError("receiptMismatch");
          const first = yield* Effect.fromResult(prepared), last = yield* Effect.fromResult(finalized);
          const expected = yield* Effect.fromResult(captureCommerceInput([...first.messages, ...last.messages]));
          if (!jsonEqual(messages, expected)) return yield* commerceError("receiptMismatch");
          yield* eligibility.decide(subject, gateSelection(role), "released");
        })); },
      });
    };
    return Object.freeze({ parentFor, decideParent, clearRole, serviceFor, close: host.close });
  });
