import { Cause, Effect } from "effect";
import { retainPreparedHost } from "../preparedHostRuntime";
import { sql } from "drizzle-orm";
import { prepareApplicationBindingSelection } from "../applicationActivation";
import { runRelationalSession } from "../relationalTransaction/session";
import { runWithRequestRecovery } from "../relationalTransaction/requestRecovery";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../transactionSessionAttemptKernel";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../scopeClock";
import { enterCommercePublication } from "../commerceTransaction/admission";
import { createCommittedJsonOutcomeResolver } from "../committedPointOutcome";
import { commerceError, commerceLimits, type CommerceTransactionError } from "../commerceTransaction/model";
import { lockCommerceRequest, projectCommerceRequestFailure } from "../commerceTransaction/request";
import type { AtomicCommerceHost } from "./commands";
import { withAtomicCommerceAdmissions } from "./admission";
import { prepareAtomicCommerceConfiguration, type AtomicCommerceHostInput } from "./configuration";
import { captureAtomicCommerceRequest, prepareAtomicCommerceRequestEvidence } from "./request";
import { executeAtomicCommerceRequest } from "./execution";

export type { AtomicCommerceHostInput } from "./configuration";

/** A dynamic deployment/binding composition. Owns no pool, scheduler or singleton
 * service. Each invocation enters the existing bounded relational owner once. */
export const makeAtomicCommerceHost = Effect.fn("AtomicCommerce.makeHost")(function* <Failure>(
  input: AtomicCommerceHostInput<Failure>,
): Effect.fn.Return<AtomicCommerceHost, CommerceTransactionError> {
  const retained = yield* retainPreparedHost(input.hostRuntime, composeAtomicCommerceHost(input)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  return Object.freeze({ close: retained.close, newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`,
    run: (key, command, args) => retained.use(host => host.run(key, command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure)))),
  } satisfies AtomicCommerceHost);
});

const composeAtomicCommerceHost = Effect.fn("AtomicCommerce.composeHost")(function* <Failure>(
  input: AtomicCommerceHostInput<Failure>,
): Effect.fn.Return<Omit<AtomicCommerceHost, "close">, CommerceTransactionError> {
  const configuration = yield* prepareAtomicCommerceConfiguration(input);
  const { database, session, target, deploymentId, scopeId, application, authority, members } = configuration;
  const run: AtomicCommerceHost["run"] = Effect.fn("AtomicCommerce.run")(function* (requestKey, token, args) {
    const request = yield* captureAtomicCommerceRequest(
      configuration.allowed,
      configuration.limits.commandBytes,
      requestKey,
      token,
      args,
    );
    const attempt = Effect.fn("AtomicCommerce.attempt")(function* (recoverOnly: boolean) {
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId }, authority);
      if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database))
        return yield* Effect.fail(commerceError("invalidAuthority"));
      const active = yield* prepareApplicationBindingSelection(application);
      return yield* runRelationalSession(session, "command", (tx) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* runDrizzleStatementEffect(
              tx.execute(
                sql`select set_config('statement_timeout', ${`${commerceLimits.statementMs}ms`}, true), set_config('lock_timeout', ${`${commerceLimits.lockMs}ms`}, true)`,
              ),
              (cause) => commerceError("statementFailure", cause),
            );
            yield* lockCommerceRequest(tx, located.authority.scopeId, request.key);
            const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, located.authority.scopeId);
            return yield* withAtomicCommerceAdmissions(
              members,
              target,
              active,
              tx,
              located.authority,
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
                    located.authority,
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
                }),
            );
          }),
        ),
      configuration.limits.commandMs);
    });
    return yield* runWithRequestRecovery(attempt, {
      hasRequestKey: true,
      projectFailure: projectCommerceRequestFailure,
      isDecisionUncertain: (error) => error.reason === "decisionUncertain",
    });
  });
  return Object.freeze({ newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`, run });
});
