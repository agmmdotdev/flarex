import { eq, sql } from "drizzle-orm";
import type { Database } from "./persistence.ts";
import type { GroupCandidate } from "./group-storage.ts";
import { CoreError } from "./errors.ts";
import { writeConflict } from "./write-conflicts.ts";
import { equalityConflict } from "./equality-storage.ts";
import { applicationConflict } from "./application-conflicts.ts";
import * as tables from "./schema.ts";

/** One bounded observation after the scope clock and deadline check. Leaf
 * owners lower their own evidence. COALESCE preserves the former first-failure
 * order and short-circuits later probes. Framework CAS/equality remain distinct
 * from the additional Application point/range OCC profile. */
export async function checkGroupDependencies(transaction: Database, scope: string, sequence: number,
  candidates: readonly GroupCandidate[], profile: "framework" | "mixed") {
  const write = writeConflict(transaction, scope, candidates);
  const equality = equalityConflict(transaction, scope, sequence, candidates);
  const application = profile === "mixed" ? applicationConflict(transaction, scope, sequence, candidates) : undefined;
  if (write === undefined && equality === undefined && application === undefined) return;
  const [row] = await transaction.select({ reason: sql<"conflict" | "invalid" | null>`coalesce(${write ?? sql`null::text`}, ${equality ?? sql`null::text`}, ${application ?? sql`null::text`})` })
    .from(tables.installation).where(eq(tables.installation.singleton, true));
  if (row === undefined) throw new CoreError({ reason: "storage" });
  if (row.reason !== null) throw new CoreError({ reason: row.reason });
}
