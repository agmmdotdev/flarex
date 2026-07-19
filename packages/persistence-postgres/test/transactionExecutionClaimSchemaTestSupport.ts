import type { FlarexSqlClient } from "../src";
import {
  SESSION_TEST_SCOPE_UUID,
  transactionSessionIdAt,
} from "./sessionAuthorityTestSupport";

export const EXECUTION_CLAIM_TEST_OWNER =
  "61000000-0000-4000-8000-000000000101";

export async function insertExecutionClaimFixture(
  persistence: Pick<FlarexSqlClient, "query">,
  overrides: Readonly<{
    sessionId?: string;
    attemptFence?: string;
    claimFence?: string;
    claimOwner?: string;
    claimedAt?: string;
    claimExpiresAt?: string;
  }> = {},
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_tx_execution_claim
        (scope_uuid, session_id, attempt_fence, claim_fence, claim_owner,
         claimed_at, claim_expires_at)
      values ($1::uuid, $2::uuid, $3, $4, $5::uuid,
              $6::timestamptz, $7::timestamptz)
    `,
    [
      SESSION_TEST_SCOPE_UUID,
      overrides.sessionId ?? transactionSessionIdAt(322),
      overrides.attemptFence ?? "1",
      overrides.claimFence ?? "1",
      overrides.claimOwner ?? EXECUTION_CLAIM_TEST_OWNER,
      overrides.claimedAt ?? "2030-01-01T00:00:00.000Z",
      overrides.claimExpiresAt ?? "2030-01-01T00:01:00.000Z",
    ],
  );
}
