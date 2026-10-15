import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defaultCommerceResources } from "../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const origin = { kind: "synthetic", sourceId: "atomic-commerce-link-probe" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "atomic-commerce-link-probe", capabilities: [], tables: [{
  tableId: "link_probe", origin, columns: ["id", "a", "b", "deleted_at"].map(columnId => ({ columnId, type: "text",
    nullable: columnId === "deleted_at", default: { kind: "none" }, origin })),
  keys: [{ keyId: "endpoints", kind: "primary", columns: ["a", "b"], origin }],
  indexes: [
    { indexId: "id", kind: "btree", columns: ["id"], predicate: null, origin },
    ...["a", "b"].map(columnId => ({ indexId: columnId, kind: "uniqueBtree", columns: [columnId],
      predicate: { kind: "isNull", columnId: "deleted_at" }, origin })),
    { indexId: "deleted", kind: "btree", columns: ["deleted_at"], predicate: null, origin },
    { indexId: "active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
  ], constraints: [], relationships: [],
}] }));
const evidence = { kind: "synthetic", sourceId: "atomic-commerce-link-probe" };
const resources = { ...defaultCommerceResources, catalogRows: 128, queryRows: 128, writeBatchRows: 128, facts: 128, eventIds: 128 };
const Row = Schema.Struct({ id: Schema.String, a: Schema.String, b: Schema.String, deleted_at: Schema.Null });
const decodeRows = Schema.decodeUnknownResult(Schema.Array(Row).check(Schema.isLengthBetween(1, 8)), { onExcessProperty: "error" });
const participant = defineAtomicCommerceParticipant("link_probe");
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let storage: Awaited<ReturnType<typeof makeStorage>>;
let reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
const rows = () => fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const commits = () => fixture.persistence.drizzle.select().from(fxSystemCommits);
const find = defineCommerceCommand("neutralLinkProbeFind", "read", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table("link_probe");
  return [...yield* table.find(ctx.manager, input)];
}));
const insert = defineCommerceCommand("neutralLinkProbeInsert", "write", Effect.fn(function* (ctx, input) {
  const selected = yield* Effect.fromResult(decodeRows(input)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  const table = yield* ctx.table("link_probe");
  return [...yield* table.write(ctx.manager, "insert", selected.map(row => ({ ...row })))];
}));

async function makeStorage() {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid neutral Link dataset"), hashFailure: cause => new Error("Neutral Link dataset hash", { cause }) }));
  return { ...fixture.hostInput.logicalStorage,
    source: { sourceKey: "medusa.link-probe", writeProfile: "medusa.link-probe", schema, evidence },
    initialization: { stepId: "link-probe-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 },
  };
}

const background = Array.from({ length: 144 }, (_, index) => ({ id: "background-" + index,
  a: "background-a-" + String(index).padStart(3, "0"), b: "background-b-" + index, deleted_at: null }));
const fields = ["id", "a", "b", "deleted_at"];
const member = (column: string, value: string) => ({ kind: "and", children: [{ kind: "in", column, values: [value] }] });
const uniquenessProbe = (a: string, b: string) => ({ fields, take: 1, order: { column: "a", direction: "asc" },
  predicate: { kind: "and", children: [
    { kind: "and", children: [{ kind: "or", children: [{ kind: "and", children: [{ kind: "or", children: [
      member("a", a), member("b", b),
    ] }] }] }] }, { kind: "isNull", column: "deleted_at" },
  ] } });

describe("native-shaped Link uniqueness probes on neutral shared storage", () => {
  beforeAll(async () => {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.link-probe", owner: "medusa", writeProfile: "medusa.link-probe",
      evidence, definition: { kind: "relational", schema },
      bindings: [{ kind: "definition", localName: "link_probe", table: { namespace: "medusa", logicalName: "atomic-commerce-link-probe/link_probe" } }],
    }));
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    storage = await makeStorage();
    reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [find], logicalResources: resources }));
    cleanup.push(() => Effect.runPromise(reader.close));
    await Effect.runPromise(reader.initialize([]));
    const seed = defineAtomicCommerceCommand("neutralLinkProbeSeed", (ctx, input) => ctx.call(participant, insert, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      participants: [{ participant, logicalStorage: storage, logicalResources: resources, commands: [insert] }], commands: [seed],
    }));
    try {
      // The dataset exceeds a single participant's identity allowance, while
      // every ordinary seed commit remains inside that unchanged allowance.
      for (let offset = 0; offset < background.length; offset += 8)
        await Effect.runPromise(host.run(host.newRequestKey(), seed, background.slice(offset, offset + 8)));
    } finally { await Effect.runPromise(host.close); }
  }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("preserves declared conditional scalar anchors during a standalone read", async () => {
    const before = await rows(), beforeCommits = await commits();
    const exit = await Effect.runPromiseExit(reader.read(find, uniquenessProbe("standalone-new-a", "standalone-new-b")));
    if (exit._tag === "Failure") throw new Error("Neutral Link probe stage: standalone read", { cause: exit.cause });
    expect(exit.value).toEqual([]);
    expect(await rows()).toEqual(before); expect(await commits()).toEqual(beforeCommits);
  });

  it.each([0, 80])("keeps an indexed OR probe bounded after %s unrelated identities were observed", async preload => {
    const intended = { id: "intended-" + preload, a: "new-a-" + preload, b: "new-b-" + preload, deleted_at: null };
    let stage = "root preparation";
    const run = async <A, E>(work: Effect.Effect<A, E>): Promise<A> => {
      const exit = await Effect.runPromiseExit(work);
      if (exit._tag === "Failure") {
        throw new Error("Neutral Link probe stage: " + stage, { cause: exit.cause });
      }
      return exit.value;
    };
    const probe = defineAtomicCommerceCommand("neutralLinkProbeRoot", Effect.fn(function* (ctx) {
      if (preload > 0) {
        stage = "preload";
        const prior = yield* ctx.call(participant, find, { fields, take: 80, order: { column: "a", direction: "asc" },
          predicate: { kind: "and", children: [{ kind: "in", column: "a", values: background.slice(0, preload).map(row => row.a) },
            { kind: "isNull", column: "deleted_at" }] } });
        expect(prior).toHaveLength(preload);
      }
      stage = "probe";
      const selected = yield* ctx.call(participant, find, uniquenessProbe(intended.a, intended.b));
      expect(selected).toEqual([]);
      stage = "insert";
      yield* ctx.call(participant, insert, [intended]);
      return selected;
    }));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      participants: [{ participant, logicalStorage: storage, logicalResources: resources, commands: [find, insert] }], commands: [probe],
    }));
    const before = await rows(), beforeCommits = await commits();
    try {
      expect(resources.catalogRows).toBe(128);
      expect(await run(host.run(host.newRequestKey(), probe, null))).toEqual([]);
      const after = await rows();
      expect(after).toHaveLength(before.length + 1); expect(after).toEqual(expect.arrayContaining(before));
      expect((await commits()).length - beforeCommits.length).toBe(1);
      stage = "verification";
      expect(await run(reader.read(find, { fields, take: 1, order: { column: "a", direction: "asc" },
        predicate: { kind: "and", children: [{ kind: "in", column: "a", values: [intended.a] },
          { kind: "isNull", column: "deleted_at" }] } }))).toEqual([intended]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
