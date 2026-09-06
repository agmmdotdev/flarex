import { beforeAll, describe, expect, it } from "vitest";
import { Result } from "effect";
import { publicationError } from "../src/commitPublication/model";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import type { RelationalPhysicalLayout } from "../src/relationalSchema/physical/model";
import { makePublicationCollection } from "../src/commitPublication/collection";
import type {
  PublicationPins,
  PublicationSeal,
  RelationalMutationReceipt,
} from "../src/commitPublication/model";
import {
  frameworkTargetNamespace,
  syntheticSystemArtifact,
  FRAMEWORK_VALUE_LOCATOR,
} from "./frameworkMigrationValueFixtures";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

let layout: RelationalPhysicalLayout;
beforeAll(async () => {
  const artifact = await syntheticSystemArtifact();
  layout = await runEffect(
    captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace: await frameworkTargetNamespace(),
    }),
  );
});
function fixture(budget = 1_048_576) {
  const table = layout.frame.tables[0];
  if (table === undefined) throw new Error("Missing physical table");
  // SAFETY: unit fixture supplies only already-admitted identity, with no database operations.
  // The end-to-end lanes compose actual authority, transaction and restored installation.
  const pins = {
    lifetime: {},
    transaction: {},
    authority: {},
    admission: { installation: { plan: { plan: { physicalLayout: layout } } } },
  } as PublicationPins;
  let closing = false;
  let failures = 0;
  let charged = 0;
  const collection = makePublicationCollection({
    pins,
    canRecord: () => !closing,
    canSeal: () => closing,
    onFailure: () => {
      failures++;
    },
    charge: (bytes) => {
      if (charged + bytes > budget)
        return Result.fail(publicationError("limitExceeded"));
      charged += bytes;
      return Result.succeed(undefined);
    },
  });
  const seal = (marked = true) => {
    closing = true;
    return runEffect(collection.owner.seal(marked));
  };
  const issue = async (key = "a") => {
    const attempt = await runEffect(
      collection.recorder.reserve(table, "update", key),
    );
    return runEffect(collection.recorder.complete(attempt, [key]));
  };
  return {
    ...collection,
    table,
    issue,
    seal,
    failures: () => failures,
    charged: () => charged,
  };
}
describe("private publication receipts", () => {
  it("captures token arrays without invoking accessors or caller iterators", async () => {
    const f = fixture();
    const receipt = await f.issue();
    const seal = await f.seal();
    let rereads = 0;
    const candidates = new Proxy([receipt], {
      get: () => {
        rereads++;
        throw new Error("Caller get trap");
      },
    });
    expect((await runEffect(f.owner.inspect(seal, candidates))).length).toBe(1);
    expect(rereads).toBe(0);
    const malformed = [receipt];
    Object.defineProperty(malformed, "0", {
      get() {
        throw new Error("Accessor must not run");
      },
    });
    expect(
      await runEffectFailure(f.owner.admit(seal, malformed)),
    ).toMatchObject({ reason: "invalidReceiptAuthority" });
  });
  it("charges the shared command budget and evaluates diagnostic effects lazily", async () => {
    const f = fixture(0);
    expect(
      await runEffectFailure(f.recorder.reserve(f.table, "delete", "a")),
    ).toMatchObject({ reason: "limitExceeded" });
    expect(f.charged()).toBe(0);
    const live = fixture();
    const seal = await live.seal(false);
    const inspect = live.owner.inspect(seal);
    await runEffect(live.owner.close);
    expect(await runEffectFailure(inspect)).toMatchObject({
      reason: "receiptAdmissionClosed",
    });
  });
  it("authenticates actual issued evidence before rejecting its unadmitted family", async () => {
    const f = fixture();
    const first = await f.issue();
    const empty = await runEffect(
      f.recorder.reserve(f.table, "delete", "missing"),
    );
    await runEffect(f.recorder.complete(empty, []));
    const seal = await f.seal();
    expect(await runEffect(f.owner.inspect(seal))).toEqual([
      {
        ordinal: 1,
        operation: "update",
        table: f.table.identity,
        key: "a",
        affectedRows: 1,
      },
      {
        ordinal: 2,
        operation: "delete",
        table: f.table.identity,
        key: "missing",
        affectedRows: 0,
      },
    ]);
    expect(f.owner.receipts()[0]).toBe(first);
    expect(await runEffectFailure(f.owner.admit(seal))).toMatchObject({
      reason: "unadmittedFinalization",
    });
    expect(await runEffectFailure(f.owner.admit(seal))).toMatchObject({
      reason: "receiptAdmissionClosed",
    });
    await runEffect(f.owner.close);
    expect(f.owner.receipts()).toEqual([]);
  });
  it("accepts the complete empty read-only set once", async () => {
    const f = fixture();
    const seal = await f.seal(false);
    expect(await runEffect(f.owner.inspect(seal))).toEqual([]);
    await runEffect(f.owner.admit(seal));
    expect(await runEffectFailure(f.owner.seal(false))).toMatchObject({
      reason: "receiptAdmissionClosed",
    });
  });
  it.each(["missing", "duplicate", "reordered", "copied", "foreign"])(
    "rejects %s membership and latches failure",
    async (kind) => {
      const f = fixture();
      const a = await f.issue("a");
      const b = await f.issue("b");
      const other = fixture();
      const foreign = await other.issue("a");
      // SAFETY: deliberate copied-token attack, never an issuer.
      const copy = { ...a } as RelationalMutationReceipt;
      const candidates =
        kind === "missing"
          ? [a]
          : kind === "duplicate"
            ? [a, a]
            : kind === "reordered"
              ? [b, a]
              : kind === "copied"
                ? [copy, b]
                : [foreign, b];
      const seal = await f.seal();
      expect(
        await runEffectFailure(f.owner.admit(seal, candidates)),
      ).toMatchObject({
        reason:
          kind === "missing"
            ? "incompleteReceiptSet"
            : "invalidReceiptAuthority",
      });
      expect(f.failures()).toBe(1);
      expect(await runEffectFailure(f.owner.inspect(seal))).toMatchObject({
        reason: "receiptAdmissionClosed",
      });
    },
  );
  it("rejects forged or foreign seals and expired attempts", async () => {
    for (const foreign of [false, true]) {
      const f = fixture();
      await f.seal(false);
      // SAFETY: deliberate forged seal for refusal coverage.
      const seal = foreign
        ? await fixture().seal(false)
        : ({} as PublicationSeal);
      expect(await runEffectFailure(f.owner.admit(seal))).toMatchObject({
        reason: "invalidReceiptAuthority",
      });
    }
    const f = fixture();
    const attempt = await runEffect(f.recorder.reserve(f.table, "delete", "a"));
    await runEffect(f.owner.close);
    expect(
      await runEffectFailure(f.recorder.complete(attempt, [])),
    ).toMatchObject({ reason: "receiptAdmissionClosed" });
  });
  it("refuses incomplete attempts, omitted markers and markers without attempts", async () => {
    for (const kind of ["incomplete", "omitted-marker", "marker-only"]) {
      const f = fixture();
      if (kind === "incomplete")
        await runEffect(f.recorder.reserve(f.table, "delete", "a"));
      if (kind === "omitted-marker") await f.issue();
      const seal = await f.seal(kind !== "omitted-marker");
      expect(await runEffectFailure(f.owner.admit(seal))).toMatchObject({
        reason: "incompleteReceiptSet",
      });
    }
  });
  it("refuses duplicate completion, mismatched SQL keys, insert absence and copied tables", async () => {
    for (const kind of ["duplicate", "key", "insert", "table"]) {
      const f = fixture();
      if (kind === "table") {
        expect(
          await runEffectFailure(
            f.recorder.reserve({ ...f.table }, "delete", "a"),
          ),
        ).toMatchObject({ reason: "invalidReceiptAuthority" });
        continue;
      }
      const attempt = await runEffect(
        f.recorder.reserve(
          f.table,
          kind === "insert" ? "insert" : "update",
          "a",
        ),
      );
      if (kind === "duplicate")
        await runEffect(f.recorder.complete(attempt, ["a"]));
      expect(
        await runEffectFailure(
          f.recorder.complete(
            attempt,
            kind === "insert" ? [] : kind === "key" ? ["b"] : ["a"],
          ),
        ),
      ).toMatchObject({ reason: "invalidReceiptAuthority" });
    }
  });
  it("bounds receipt count and retained identities before the next reservation", async () => {
    const f = fixture();
    for (let n = 0; n < 64; n++) await f.issue(String(n));
    expect(
      await runEffectFailure(f.recorder.reserve(f.table, "delete", "x")),
    ).toMatchObject({ reason: "limitExceeded" });
    const large = fixture();
    for (let n = 0; n < 5; n++) await large.issue("x".repeat(50_000));
    const before = large.charged();
    expect(
      await runEffectFailure(
        large.recorder.reserve(large.table, "delete", "x".repeat(50_000)),
      ),
    ).toMatchObject({ reason: "limitExceeded" });
    expect(large.charged()).toBe(before);
  });
});
