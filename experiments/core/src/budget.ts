import { Result } from "effect";
import { CoreError } from "./errors.ts";
import { applicationLimits } from "./query.ts";

/** One root's logical retained data budget, shared by borrowed table roots.
 * Detached document/event bytes are charged once per retained representation.
 * Equality acquisition additionally charges examined key/identity work bytes,
 * including invisible historical entries and fingerprint collisions. This is
 * neither wire/heap size nor all PostgreSQL physical work. */
export function createBudget() {
  let reads = 0; let pending = 0; let events = 0;
  let dependencies = 0; let dependencyBytes = 0;
  let readBytes = 0; let pendingBytes = 0; let eventBytes = 0;
  const bytes = () => readBytes + pendingBytes + eventBytes + dependencyBytes;
  const allowed = (delta: number, entries: number, count: number) =>
    Number.isSafeInteger(delta) && Number.isSafeInteger(entries) && bytes() + delta <= applicationLimits.bytes &&
    count + entries >= 0 && count + entries <= applicationLimits.rows;
  return {
    remainingBytes: () => applicationLimits.bytes - bytes(),
    remainingReads: () => applicationLimits.rows - reads,
    read: (size: number, entries: number) => {
      if (size < 0 || entries < 0 || !allowed(size, entries, reads)) return Result.fail(new CoreError({ reason: "limit" }));
      readBytes += size; reads += entries; return Result.succeed(undefined);
    },
    replacePending: (deltaBytes: number, newEntry: boolean) => {
      if (pendingBytes + deltaBytes < 0 || !allowed(deltaBytes, newEntry ? 1 : 0, pending)) return Result.fail(new CoreError({ reason: "limit" }));
      pendingBytes += deltaBytes; if (newEntry) pending++; return Result.succeed(undefined);
    },
    event: (size: number) => {
      if (size < 0 || !allowed(size, 1, events)) return Result.fail(new CoreError({ reason: "limit" }));
      eventBytes += size; events++; return Result.succeed(undefined);
    },
    dependency: (size: number) => {
      if (size < 0 || !allowed(size, 1, dependencies)) return Result.fail(new CoreError({ reason: "limit" }));
      dependencyBytes += size; dependencies++; return Result.succeed(undefined);
    },
    diagnostics: () => ({ reads, pending, events, dependencies, readBytes, pendingBytes, eventBytes, dependencyBytes, bytes: bytes() }),
  };
}
export type RootBudget = ReturnType<typeof createBudget>;
