import { withExecutionDiagnosticDefaults } from "../executionDiagnostics/operation";
import { Cause, Effect } from "effect";
import { retainPreparedHost, chargeHostPreparation } from "../preparedHostRuntime";
import { sql } from "drizzle-orm";
import { prepareCurrentApplicationBinding } from "../applicationActivation";
import { runRelationalSession, readRelationalSessionCoLocatedInstallation, startRelationalRequestDeadline,
  boundRelationalRequestDeadline } from "../relationalTransaction/session";
import { runWithRequestRecovery } from "../relationalTransaction/requestRecovery";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { enterCommercePublication } from "../commerceTransaction/admission";
import { createCommittedJsonOutcomeResolver } from "../committedPointOutcome";
import { commerceError, commerceLimits, type CommerceTransactionError } from "../commerceTransaction/model";
import { lockCommerceRequest, projectCommerceRequestFailure as projectCommerceFailure } from "../commerceTransaction/request";
import { PhysicalSessionDeadlineIssue } from "../physicalSession/errors";
import type { AtomicCommerceHost } from "./commands";
import { withAtomicCommerceAdmissions } from "./admission";
import { captureAtomicCommerceConfiguration, prepareAtomicCommerceConfiguration, type AtomicCommerceHostInput } from "./configuration";
import type { RequestLimits } from "../boundedRequestLifetime";
import { captureAtomicCommerceRequest, prepareAtomicCommerceRequestEvidence } from "./request";
import { executeAtomicCommerceRequest } from "./execution";

export type { AtomicCommerceHostInput } from "./configuration";
const projectCommerceRequestFailure = (cause: unknown) => cause instanceof PhysicalSessionDeadlineIssue ? commerceError("deadlineExceeded", cause) :
  projectCommerceFailure(cause);

/** A dynamic deployment/binding composition. Owns no pool, scheduler or singleton
 * service. Each invocation enters the existing bounded relational owner once. */
export const makeAtomicCommerceHost = Effect.fn("AtomicCommerce.makeHost")(function* <Failure>(
  input: AtomicCommerceHostInput<Failure>,
): Effect.fn.Return<AtomicCommerceHost, CommerceTransactionError> {
  const retained = yield* retainPreparedHost(input.hostRuntime, composeAtomicCommerceHost(input)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  return Object.freeze({ close: retained.close, newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`,
    run: (key, command, args) => withExecutionDiagnosticDefaults(retained.use(host => host.run(key, command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))))),
  } satisfies AtomicCommerceHost);
});

const composeAtomicCommerceHost = Effect.fn("AtomicCommerce.composeHost")(function* <Failure>(
  input: AtomicCommerceHostInput<Failure>,
): Effect.fn.Return<Omit<AtomicCommerceHost, "close">, CommerceTransactionError> {
  const captured = yield* captureAtomicCommerceConfiguration(input);
  const { database, session, target, application } = captured;
  let initialLimits: RequestLimits | undefined;
  let constructingInitial = true;
  const preparation = yield* prepareCurrentApplicationBinding(application, database, (binding, context) =>
    prepareAtomicCommerceConfiguration(captured, binding, context.authority).pipe(Effect.tap(configuration => Effect.sync(() => {
      if (constructingInitial) initialLimits = configuration.limits;
    }))), {
    installation: yield* Effect.fromResult(readRelationalSessionCoLocatedInstallation(session, database)).pipe(Effect.mapError(projectCommerceRequestFailure)) })
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  constructingInitial = false;
  if (initialLimits === undefined) return yield* Effect.die(new Error("Atomic commerce initial generation did not supply request limits"));
  // Only input-derived scalar policy escapes the initial generation. Storage
  // members, installations and catalogs are borrowed anew for every attempt.
  const limits = Object.freeze({ ...initialLimits });
  initialLimits = undefined;
  yield* chargeHostPreparation(limits).pipe(Effect.mapError(projectCommerceRequestFailure));
  const run: AtomicCommerceHost["run"] = Effect.fn("AtomicCommerce.run")(function* (requestKey, token, args) {
    const request = yield* captureAtomicCommerceRequest(
      captured.allowed,
      limits.commandBytes,
      requestKey,
      token,
      args,
    );
    const deadline = yield* startRelationalRequestDeadline(limits.commandMs).pipe(Effect.mapError(projectCommerceRequestFailure));
    const attempt = Effect.fn("AtomicCommerce.attempt")(function* (recoverOnly: boolean) {
      return yield* preparation.withEntry(({ binding: active, payload: configuration }, enter) => runRelationalSession(session, "command", {
        enter: (tx, requireInstallation) => enter(tx, requireInstallation, Effect.gen(function* () {
            yield* runDrizzleStatementEffect(
              tx.execute(
                sql`select set_config('statement_timeout', ${`${commerceLimits.statementMs}ms`}, true), set_config('lock_timeout', ${`${commerceLimits.lockMs}ms`}, true)`,
              ),
              (cause) => commerceError("statementFailure", cause),
            );
            yield* lockCommerceRequest(tx, captured.scopeId, request.key);
          }), ({ clock, authority: entryAuthority, checked }) => Effect.scoped(Effect.gen(function* () {
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
                  if (retained.kind === "available") return retained.successfulResult.valueJson;
                  if (retained.kind === "expired")
                    return yield* Effect.fail(commerceError("resultUnavailable"));
                  if (recoverOnly) return yield* Effect.fail(commerceError("decisionUncertain"));
                  return yield* executeAtomicCommerceRequest(configuration, request, evidence, admissions, tx);
                }), checked,
            );
          }),
        )),
      }, deadline));
    });
    return yield* boundRelationalRequestDeadline(deadline, runWithRequestRecovery(attempt, {
      hasRequestKey: true,
      projectFailure: projectCommerceRequestFailure,
      isDecisionUncertain: (error) => error.reason === "decisionUncertain",
    })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  });
  return Object.freeze({ newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`, run });
});
