import { observeExecution, withExecutionDiagnosticDefaults } from "../../execution/diagnostics/operation";
import { Cause, Effect } from "effect";
import { retainPreparedHost, chargeHostPreparation } from "../../execution/preparation/preparedHostRuntime";
import { sql } from "drizzle-orm";
import {
  prepareCurrentApplicationBinding,
} from "../../application/activation/currentBinding";
import { runRelationalSession, readRelationalSessionCoLocatedInstallation, startRelationalRequestDeadline,
  boundRelationalRequestDeadline } from "../../database/relationalTransaction/session";
import { runWithRequestRecovery } from "../../database/relationalTransaction/requestRecovery";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { enterCommercePublication } from "../commerceTransaction/admission";
import { createCommittedJsonOutcomeResolver } from "../../commit/committedPointOutcome";
import { commerceError, commerceLimits, type CommerceTransactionError } from "../commerceTransaction/model";
import {
  lockCommerceRequest,
  projectCommerceRequestFailure as projectCommerceFailure,
} from "../commerceTransaction/request";
import { PhysicalSessionDeadlineIssue } from "../../database/physicalSession/errors";
import type { AtomicCommerceHost, TaskAtomicCommerceHost } from "./commands";
import { withAtomicCommerceAdmissions } from "./admission";
import {
  captureAtomicCommerceConfiguration,
  prepareAtomicCommerceConfiguration,
  type AtomicCommerceHostInput,
} from "./configuration";
import type { RequestLimits } from "../../execution/preparation/boundedRequestLifetime";
import { captureAtomicCommerceRequest, prepareAtomicCommerceRequestEvidence } from "./request";
import { executeAtomicCommerceRequest } from "./execution";
import { captureAtomicCommerceTaskChild, lockAtomicCommerceTaskChild, prepareAtomicCommerceTaskChild,
  requireAtomicCommerceTaskChildOutcome, requireAtomicCommerceTaskChildSettlement,
  type CapturedAtomicCommerceTaskChild } from "./taskChild";

export type { AtomicCommerceHostInput } from "./configuration";
const projectCommerceRequestFailure = (cause: unknown) => cause instanceof PhysicalSessionDeadlineIssue ? commerceError("deadlineExceeded", cause) :
  projectCommerceFailure(cause);

/** A dynamic deployment/binding composition. Owns no pool, scheduler or singleton
 * service. Each invocation enters the existing bounded relational owner once. */
export const makeAtomicCommerceHost = Effect.fn("AtomicCommerce.makeHost")(function* <Failure>(
  input: AtomicCommerceHostInput<Failure>,
): Effect.fn.Return<TaskAtomicCommerceHost, CommerceTransactionError> {
  const retained = yield* retainPreparedHost(input.hostRuntime, composeAtomicCommerceHost(input)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  return Object.freeze({ close: retained.close, newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`,
    run: (key, command, args) => withExecutionDiagnosticDefaults(retained.use(host => host.run(key, command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))))),
    runTaskChild: (subject, occurrence, command, args, eligibility) => withExecutionDiagnosticDefaults(
      retained.use(host => host.runTaskChild(subject, occurrence, command, args, eligibility))
        .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))))),
  } satisfies TaskAtomicCommerceHost);
});

const composeAtomicCommerceHost = Effect.fn("AtomicCommerce.composeHost")(function* <Failure>(
  input: AtomicCommerceHostInput<Failure>,
): Effect.fn.Return<Omit<TaskAtomicCommerceHost, "close">, CommerceTransactionError> {
  const captured = yield* captureAtomicCommerceConfiguration(input);
  const { database, session, target, application } = captured;
  let initialLimits: RequestLimits | undefined;
  let constructingInitial = true;
  const preparation = yield* prepareCurrentApplicationBinding(application, database, (binding, context) =>
    prepareAtomicCommerceConfiguration(captured, binding, context.authority).pipe(Effect.tap(configuration => Effect.sync(() => {
      if (constructingInitial) initialLimits = configuration.limits;
    }))), {
    selection: { deploymentId: captured.deploymentId, scopeId: captured.scopeId },
    installation: yield* Effect.fromResult(readRelationalSessionCoLocatedInstallation(session, database)).pipe(Effect.mapError(projectCommerceRequestFailure)) })
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  constructingInitial = false;
  if (initialLimits === undefined) return yield* Effect.die(new Error("Atomic commerce initial generation did not supply request limits"));
  // Only input-derived scalar policy escapes the initial generation. Storage
  // members, installations and catalogs are borrowed anew for every attempt.
  const limits = Object.freeze({ ...initialLimits });
  initialLimits = undefined;
  yield* chargeHostPreparation(limits).pipe(Effect.mapError(projectCommerceRequestFailure));
  const runRequest = Effect.fnUntraced(function* (requestKey: string, token: Parameters<AtomicCommerceHost["run"]>[1],
    args: Parameters<AtomicCommerceHost["run"]>[2], taskChild?: CapturedAtomicCommerceTaskChild) {
    const capturedRequest = yield* captureAtomicCommerceRequest(
      captured.allowed,
      limits.commandBytes,
      requestKey,
      token,
      args,
    );
    if (taskChild === undefined && capturedRequest.key.startsWith("commerce/atomic/task/"))
      return yield* commerceError("invalidInput");
    const request = taskChild === undefined ? capturedRequest : { ...capturedRequest, taskChild };
    const deadline = yield* startRelationalRequestDeadline(limits.commandMs).pipe(Effect.mapError(projectCommerceRequestFailure));
    const attempt = Effect.fnUntraced(function* (recoverOnly: boolean) {
      let lockedChild: Effect.Success<ReturnType<typeof lockAtomicCommerceTaskChild>> | undefined;
      return yield* preparation.withEntry(({ binding: active, payload: configuration }, enter) => runRelationalSession(session, "command", {
        enter: (tx, requireInstallation) => enter(tx, requireInstallation, Effect.gen(function* () {
            yield* runDrizzleStatementEffect(
              tx.execute(
                sql`select set_config('statement_timeout', ${`${commerceLimits.statementMs}ms`}, true), set_config('lock_timeout', ${`${commerceLimits.lockMs}ms`}, true)`,
              ),
              (cause) => commerceError("statementFailure", cause),
            );
            if (request.taskChild === undefined) yield* lockCommerceRequest(tx, captured.scopeId, request.key);
          }), ({ clock, authority: entryAuthority, checked }) => Effect.scoped(Effect.gen(function* () {
            if (request.taskChild !== undefined) {
              if (configuration.executionIsolation !== "scopeExclusive" || configuration.taskBindingSha256 === undefined)
                return yield* commerceError("unsupportedProfile");
              if (configuration.taskBindingSha256 !== request.taskChild.identity.bindingSha256)
                return yield* commerceError("invalidAuthority");
              lockedChild = yield* lockAtomicCommerceTaskChild(tx, request.taskChild, entryAuthority, limits.commandMs);
              yield* lockCommerceRequest(tx, captured.scopeId, request.key);
            }
            return yield* withAtomicCommerceAdmissions(
              configuration.members,
              target,
              active,
              tx,
              entryAuthority,
              clock,
              (admissions) =>
                Effect.gen(function* () {
                  const first = admissions[0];
                  if (first === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
                  const evidence = yield* prepareAtomicCommerceRequestEvidence(
                    configuration,
                    request,
                    first,
                    tx,
                    entryAuthority,
                    clock,
                  );
                  const physical = admissions.flatMap(member => member.kind === "physical" ? [member.admission] : []);
                  if (physical.length > 0) yield* enterCommercePublication(physical);
                  const retained = yield* createCommittedJsonOutcomeResolver(tx)
                    .resolve(evidence.lookup)
                    .pipe(Effect.mapError(projectCommerceRequestFailure));
                  const existingChild = request.taskChild === undefined ? undefined :
                    lockedChild === undefined ? yield* Effect.die(new Error("Task child did not enter the run lock")) :
                      yield* prepareAtomicCommerceTaskChild(tx, request.taskChild, lockedChild, evidence,
                        request.definition.name, request.args);
                  if (retained.kind === "available") {
                    if (request.taskChild !== undefined) {
                      yield* requireAtomicCommerceTaskChildOutcome(existingChild, retained.successfulResult.sha256);
                      yield* requireAtomicCommerceTaskChildSettlement(tx, request.taskChild, entryAuthority);
                    }
                    return retained.successfulResult.valueJson;
                  }
                  if (retained.kind === "expired")
                    return yield* Effect.fail(commerceError("resultUnavailable"));
                  if (recoverOnly) return yield* Effect.fail(commerceError("decisionUncertain"));
                  if (existingChild !== undefined) return yield* commerceError("storedCorruption");
                  return yield* executeAtomicCommerceRequest(configuration, request, evidence, admissions, tx, entryAuthority);
                }), checked,
            );
          })), configuration.executionIsolation === "scopeExclusive" ? "ordinaryWrite" : undefined),
      }, deadline));
    }, work => observeExecution("AtomicCommerce.attempt", work, "caller"));
    return yield* boundRelationalRequestDeadline(deadline, runWithRequestRecovery(attempt, {
      hasRequestKey: true,
      projectFailure: projectCommerceRequestFailure,
      isDecisionUncertain: (error) => error.reason === "decisionUncertain",
    })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  }, work => observeExecution("AtomicCommerce.run", work, "caller"));
  const run: AtomicCommerceHost["run"] = (key, command, args) => runRequest(key, command, args);
  const runTaskChild: TaskAtomicCommerceHost["runTaskChild"] = Effect.fn("AtomicCommerce.runTaskChild")(
    function* (subject, occurrence, command, args, eligibility) {
      const child = yield* captureAtomicCommerceTaskChild(subject, occurrence, eligibility);
      return yield* runRequest(child.key, command, args, child);
    });
  return Object.freeze({ newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`, run, runTaskChild });
});
