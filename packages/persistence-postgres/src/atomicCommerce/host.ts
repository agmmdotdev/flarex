import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { prepareApplicationBindingSelection } from "../applicationActivation";
import { runRelationalSession } from "../relationalTransaction/session";
import { runWithRequestRecovery } from "../relationalTransaction/requestRecovery";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../transactionSessionAttemptKernel";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { lockScopeClockForUpdateInTransactionEffect } from "../scopeClock";
import { createCommittedJsonOutcomeResolver } from "../committedPointOutcome";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
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
  const configuration = yield* prepareAtomicCommerceConfiguration(input);
  const { database, session, target, deploymentId, application, authority, members } = configuration;
  const run: AtomicCommerceHost["run"] = Effect.fn("AtomicCommerce.run")(function* (requestKey, token, args) {
    const request = yield* captureAtomicCommerceRequest(
      configuration.allowed,
      configuration.limits.commandBytes,
      requestKey,
      token,
      args,
    );
    const attempt = Effect.fn("AtomicCommerce.attempt")(function* (recoverOnly: boolean) {
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority);
      if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database))
        return yield* Effect.fail(commerceError("invalidAuthority"));
      const active = yield* prepareApplicationBindingSelection(application);
      return yield* runRelationalSession(session, (tx) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* runDrizzleStatementEffect(
              tx.execute(
                sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`,
              ),
              (cause) => commerceError("statementFailure", cause),
            );
            const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, located.authority.scopeId);
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
                    located.authority,
                    clock,
                  );
                  const retained = yield* createCommittedJsonOutcomeResolver(tx)
                    .resolve(evidence.lookup)
                    .pipe(Effect.mapError(projectCommerceRequestFailure));
                  if (retained.kind === "available") return retained.successfulResult.valueJson;
                  if (retained.kind === "expired")
                    return yield* Effect.fail(commerceError("resultUnavailable"));
                  if (recoverOnly) return yield* Effect.fail(commerceError("decisionUncertain"));
                  return yield* executeAtomicCommerceRequest(configuration, request, evidence, admissions);
                }),
            );
          }),
        ),
      );
    });
    return yield* runWithRequestRecovery(attempt, {
      hasRequestKey: true,
      projectFailure: projectCommerceRequestFailure,
      isDecisionUncertain: (error) => error.reason === "decisionUncertain",
    });
  });
  return Object.freeze({ newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`, run });
});
