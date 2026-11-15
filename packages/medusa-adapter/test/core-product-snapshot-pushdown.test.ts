import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { CorePersistence, CorePersistenceSnapshot } from "../../persistence-postgres/src/core/contracts";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareProductReadInput } from "../src/modules/product/service-input";
import { createCoreProductFixture, type CoreProductFixture } from "./support/core-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid native Product snapshot pushdown driver");

/** `complete` withholds the statement, so the same host serves the same read through the complete captured path. */
const probe = { statements: 0, complete: false };
const wrapPersistence = (inner: CorePersistence): CorePersistence => ({ ...inner,
  readSnapshot: (at, retention) => Effect.map(inner.readSnapshot(at, retention), (snapshot): CorePersistenceSnapshot => {
    const { filter, ...rest } = snapshot;
    return filter === undefined || probe.complete ? rest
      : { ...rest, filter: request => Effect.suspend(() => { probe.statements++; return filter(request); }) };
  }) });

const TITLES = ["Needle", "NEEDLE in hay", "needle", "Haystack", "Back\\slash", "Ångström needle", "ÅNGSTRÖM", "ångström", "100% wool", "under_score",
  "💵 needle note", "မြန်မာ", "nee dle", "Kneedle", "", "x"];

describe(`native Product snapshot predicate pushdown on Core ${driver}`, () => {
  let fixture: CoreProductFixture;
  beforeAll(async () => {
    fixture = await createCoreProductFixture(driver, { wrapPersistence });
    for (let start = 0; start < 48; start += 16) await fixture.run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.create,
      Array.from({ length: 16 }, (_, offset) => {
        const ordinal = start + offset, id = `push_${String(ordinal).padStart(2, "0")}`;
        return { id, title: `${TITLES[ordinal % TITLES.length] ?? ""} ${ordinal % 3}`, handle: id.replace("_", "-"),
          subtitle: ordinal % 5 === 0 ? "Needle subtitle" : null };
      })));
    await fixture.run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.softDelete, ["push_00", "push_17", "push_33"]));
  }, 240_000);
  afterAll(async () => { if (fixture !== undefined) await fixture.close(); }, 180_000);

  const input = (filters: Json, config: Json) => Result.getOrThrow(prepareProductReadInput({ filters, config }));
  /** One read through each path on one host: the statement must be used exactly when expected. */
  const both = async (host: Pick<CoreProductFixture["host"], "read">, command: Parameters<CoreProductFixture["host"]["read"]>[0],
    args: Json, statements: number) => {
    probe.complete = false;
    const before = probe.statements;
    const pushed = await fixture.run(Effect.result(host.read(command, args)));
    expect(probe.statements - before, JSON.stringify(args)).toBe(statements);
    probe.complete = true;
    try { return { pushed, complete: await fixture.run(Effect.result(host.read(command, args))) }; }
    finally { probe.complete = false; }
  };

  it("serves Product search and list through one statement with the complete read's rows, order, window and total", async () => {
    const host = await fixture.run(fixture.openReadHost());
    try {
      const { list, count, internalProductList } = fixture.runtime.commands;
      for (const q of ["needle", "NEEDLE", "nee_le", "nee%le", "back\\sl", "å", "Å", "100%", "_score", "💵", "မြန်", "zzz-none", "subtitle"])
        for (const config of [{ take: 20 }, { take: 5, skip: 3 }, { take: 4, order: { id: "DESC" } }, { take: 3, skip: 2, order: { created_at: "DESC" } }] satisfies Json[]) {
          const search = await both(host, list, input({ q }, { select: ["id", "title"], ...config }), 1);
          expect(Result.isSuccess(search.pushed), `${q} ${JSON.stringify(config)}`).toBe(true);
          expect(search.pushed, `${q} ${JSON.stringify(config)}`).toEqual(search.complete);
          // The rows and the total are two reads, hence two statements.
          const counted = await both(host, count, input({ q }, { select: ["id"], ...config }), 2);
          expect(Result.isSuccess(counted.pushed), `count ${q}`).toBe(true);
          expect(counted.pushed, `count ${q} ${JSON.stringify(config)}`).toEqual(counted.complete);
        }
      const needle = await fixture.run(host.read(internalProductList, { filters: { q: "needle" }, config: { select: ["id"], take: 20 } }));
      expect(Array.isArray(needle) && needle.length).toBeGreaterThan(5);
      expect(needle).not.toContainEqual({ id: "push_00" });
      // Deleted rows are part of the same statement's predicate, not a second read.
      const deleted = await both(host, internalProductList, { filters: { q: "needle" }, config: { select: ["id"], withDeleted: true } }, 1);
      expect(deleted.pushed).toEqual(deleted.complete);
      expect(Result.getOrThrow(deleted.pushed)).toContainEqual({ id: "push_00" });
      for (const config of [{ take: 20 }, { take: 7, skip: 40 }, { take: 10, skip: 5, order: { id: "DESC" } }, { take: 10, order: { created_at: "DESC" } }] satisfies Json[]) {
        const listed = await both(host, count, input({}, { select: ["id", "handle"], ...config }), 2);
        expect(Result.isSuccess(listed.pushed), JSON.stringify(config)).toBe(true);
        expect(listed.pushed, JSON.stringify(config)).toEqual(listed.complete);
      }
      // Default projections populate relations through indexed selections, which stay complete.
      const populated = await both(host, list, input({ q: "needle" }, { take: 5, relations: ["variants", "images"] }), 1);
      expect(Result.isSuccess(populated.pushed)).toBe(true);
      expect(populated.pushed).toEqual(populated.complete);
    } finally { await fixture.run(host.close); }
  }, 600_000);

  it("keeps identity selections and write requests on the complete read", async () => {
    const host = await fixture.run(fixture.openReadHost());
    try {
      const selected = await both(host, fixture.runtime.commands.internalProductList,
        { filters: { id: ["push_01", "push_02"] }, config: { select: ["id"] } }, 0);
      expect(selected.pushed).toEqual(selected.complete);
      expect(Result.getOrThrow(selected.pushed)).toEqual([{ id: "push_01" }, { id: "push_02" }]);
      const before = probe.statements;
      await fixture.run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.create,
        { id: "push_write", title: "Written needle", handle: "push-write" }));
      expect(probe.statements).toBe(before);
    } finally { await fixture.run(host.close); }
  }, 240_000);

  it("serves a search whose table exceeds the complete read's identity budget", async () => {
    // Sixteen identities cannot hold the forty-nine-row cohort; a four-row window fits.
    const host = await fixture.run(fixture.openReadHost({ nativeLimits: { maxIdentities: 16, maxDocumentBytes: 65_536 } }));
    try {
      const search = await both(host, fixture.runtime.commands.internalProductList,
        { filters: { q: "needle" }, config: { select: ["id"], take: 4 } }, 1);
      expect(Result.getOrThrow(search.pushed)).toHaveLength(4);
      expect(search.complete).toMatchObject({ _tag: "Failure" });
      // More returned rows than identities is still refused, never truncated.
      probe.complete = false;
      expect(await fixture.run(Effect.result(host.read(fixture.runtime.commands.internalProductList,
        { filters: { q: "needle" }, config: { select: ["id"], take: 20 } })))).toMatchObject({ _tag: "Failure" });
    } finally { await fixture.run(host.close); }
  }, 240_000);
});
