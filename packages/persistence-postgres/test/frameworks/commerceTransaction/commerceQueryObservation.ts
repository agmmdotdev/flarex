import { QueryPromise } from "drizzle-orm";
import { vi } from "vitest";

// Resolve the persistence owner's installed Drizzle peer instance. A root-level
// import can observe a different pnpm instance and incorrectly report zero SQL.
export const observeCommerceQueries = () => vi.spyOn(QueryPromise.prototype, "then");
