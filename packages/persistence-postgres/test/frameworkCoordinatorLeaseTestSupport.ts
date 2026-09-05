import { setTimeout as delay } from "node:timers/promises";
import type { FlarexPersistence } from "../src/index";

/** Wait for actual database-clock expiry without mutating evidence or clocks. */
export async function waitForFrameworkLeaseExpiry(
  persistence: Pick<FlarexPersistence, "query">,
  attemptId: string,
): Promise<void> {
  const deadline = performance.now() + 120_000;
  while (performance.now() < deadline) {
    const result = await persistence.query<{ remaining_milliseconds: number }>(`
      select ceil(greatest(0, extract(epoch from
        (current_lease_expires_at - clock_timestamp())) * 1000))::integer
        as remaining_milliseconds
      from fx_system_framework_migration_collision_head
      where current_attempt_id = $1 and current_lease_expires_at is not null
    `, [attemptId]);
    const remaining = result.rows[0]?.remaining_milliseconds;
    if (result.rows.length !== 1 || typeof remaining !== "number" ||
      !Number.isSafeInteger(remaining) || remaining < 0) {
      throw new Error("Expected one live fixture lease with a finite expiry");
    }
    if (remaining === 0) return;
    await delay(Math.min(remaining + 10, Math.max(1, deadline - performance.now())));
  }
  throw new Error("Fixture lease did not expire within its wait budget");
}
