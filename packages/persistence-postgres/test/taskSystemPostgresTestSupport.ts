import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect } from "effect";

import {
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  TASK_LOCATOR,
  type TaskSystemRunAttemptParentV1,
} from "./taskSystemRunAttemptStoreTestSupport";

/** Installs the real application-revision parent used by Task System PG tests. */
export async function seedRegisteredTaskSystemParentV1(
  persistence: PostgresFlarexPersistence,
  idempotencyKey: string,
): Promise<TaskSystemRunAttemptParentV1> {
  const registrationTarget =
    createPostgresLocatedApplicationRevisionRegistrationTargetV1(
      persistence,
      TASK_LOCATOR,
    );
  const registrationFixtureState = globalThis as typeof globalThis & {
    __flarexRegistrationFixtureOnlyV1?: boolean;
  };
  registrationFixtureState.__flarexRegistrationFixtureOnlyV1 = true;
  const { authenticatedRegistrationFixtureForPersistence } =
    await import("./applicationRevisionRegistrationV1.test");
  return runEffect(Effect.scoped(Effect.gen(function* () {
    const fixture = yield* authenticatedRegistrationFixtureForPersistence(
      persistence,
      registrationTarget,
    );
    const registration = yield* fixture.context.register(
      fixture.analysis,
      idempotencyKey,
    );
    return Object.freeze({
      scopeId: "scope_61000000-0000-0000-0000-000000000001",
      deploymentId: "deployment_registration_v1",
      applicationRevisionId: registration.revisionId,
      candidateSha256Hex: encodeBytesToLowercaseHex(
        fixture.preparation.candidateSha256,
      ),
    });
  })));
}
