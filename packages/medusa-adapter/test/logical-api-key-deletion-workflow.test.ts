import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { LinkService, linkPairRevisionId, LinkPairRevisionRecordSchema } from "@medusajs/link-modules";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { LINKS } from "@medusajs/framework/utils/portable";
import { prepareApiKeyDeletionWorkflow } from "../src/workflows/api-key/delete";
import { apiKeyFailureMessages } from "./support/core-api-key-fixture";
import { prepareCoreApiKeyDeletion } from "./support/core-api-key-deletion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let base: Awaited<ReturnType<typeof prepareCoreApiKeyDeletion>>;
const scenario = () => prepareCoreApiKeyDeletion(driver, close => cleanup.push(close), { physical: base.fixture.physical });
beforeAll(async () => { base = await prepareCoreApiKeyDeletion(driver, close => cleanup.push(close)); }, 240_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

describe("bounded native API Key deletion and irreversible Link cleanup", { concurrent: false }, () => {
  it("deletes four revoked keys and only their active associations", async () => {
    const connected = await scenario(), kept = await connected.seed("Keep");
    const selected = await Promise.all(Array.from({ length: 4 }, (_, index) => connected.seed(`Delete-${index}`)));
    for (const row of selected) await connected.attachNewChannel(row.id, row.channel + "-second");
    const beforeKept = await connected.readLinks([kept.id]);
    const host = await connected.prepareDelete();
    // Exercise selector order opposite to the DAL's ascending ID order.
    const ids = selected.map(row => row.id).sort().reverse();
    let enteredCalls = 0;
    const diagnostics: ExecutionDiagnosticPolicy = {
      observe: (name, work) => name === "BoundedRequest.enter"
        ? Effect.sync(() => { enteredCalls++; }).pipe(Effect.andThen(work)) : work,
    };
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }).pipe(
      Effect.provideService(ExecutionDiagnostics, diagnostics),
    ))).toBeNull();
    // The bounded lifetime charges its initial request before these entries.
    expect(enteredCalls + 1).toBe(65);
    expect((await connected.read()).map(row => row.id)).toEqual([kept.id]);
    expect(await connected.readLinks([kept.id])).toEqual(beforeKept);
    const links = await connected.readLinks(selected.map(row => row.id));
    expect(links).toHaveLength(8);
    expect(links.every(row => typeof row.deleted_at === "string")).toBe(true);
    expect(Object.keys(connected.links.workflow.methods)).not.toContain("restore");
  }, 240_000);

  it("refuses the complete deletion under the ordinary call budget and rolls back the root", async () => {
    const connected = await scenario();
    const selected = await Promise.all(Array.from({ length: 4 }, (_, index) => connected.seed(`Default budget-${index}`)));
    for (const row of selected) await connected.attachNewChannel(row.id, row.channel + "-second");
    const host = await connected.prepareDefaultDeletion(), before = await connected.snapshot();
    const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: selected.map(row => row.id) }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) &&
      reason.error.reason === "limitExceeded")).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("refuses a ninth association and rolls back the preceding key deletion", async () => {
    const connected = await scenario(), selected = await connected.seed("Over limit");
    for (let index = 1; index < 9; index++) await connected.attachNewChannel(selected.id, selected.channel + "-" + index);
    const host = await connected.prepareDelete(), before = await connected.snapshot();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: [selected.id] })))).toBe(true);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("preserves all keys, associations and publication when one key is unrevoked", async () => {
    const connected = await scenario(), revoked = await connected.seed("Revoked"), active = await connected.seed("Active", false);
    const host = await connected.prepareDelete(), before = await connected.snapshot();
    const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: [revoked.id, active.id] }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(apiKeyFailureMessages(result.cause).some(message => message.includes("Cannot delete api keys that are not revoked"))).toBe(true);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("replays deletion and explicitly retries a missing key without restoring its Link", async () => {
    const connected = await scenario(), selected = await connected.seed("Replay"), host = await connected.prepareDelete(), request = host.newRequestKey();
    const remove = vi.spyOn(LinkService.prototype, "softDelete");
    try {
      const fault = connected.fixture.loseNextNativeRootAcknowledgement();
      expect(await Effect.runPromise(host.run(request, { ids: [selected.id] }))).toBeNull();
      expect(fault.armed).toBe(false); expect(fault.failures).toBe(1); expect(fault.evidence).toBeDefined();
      expect(remove).toHaveBeenCalledTimes(1);
      const before = await connected.snapshot(), beforeRows = await connected.readRows(), beforeLinks = await connected.readLinks([selected.id]);
      expect(beforeLinks).toHaveLength(1);
      const recovered = await connected.prepareDelete(), changed = await connected.prepareDefaultDeletion();
      expect(await Effect.runPromise(recovered.run(request, { ids: [selected.id] }))).toBeNull();
      await expect(Effect.runPromise(changed.run(request, { ids: [selected.id] }))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(remove).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(before);
      const headId = await linkPairRevisionId(LINKS.PublishableApiKeySalesChannel, { primary: selected.id, foreign: selected.channel });
      const decodeHead = Schema.decodeUnknownSync(LinkPairRevisionRecordSchema);
      const previousHead = decodeHead(beforeRows.find(row => row.id === headId));
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [selected.id] }))).toBeNull();
      const after = await connected.snapshot(), afterRows = await connected.readRows();
      const currentHead = decodeHead(afterRows.find(row => row.id === headId));
      expect(currentHead.revision).not.toBe(previousHead.revision);
      expect(currentHead).toMatchObject({ id: headId, service_name: previousHead.service_name,
        primary_value: selected.id, foreign_value: selected.channel });
      expect(afterRows.filter(row => row.id !== headId)).toEqual(beforeRows.filter(row => row.id !== headId));
      expect(after.events).toEqual(before.events);
      expect(after.revisions).toHaveLength(before.revisions.length + 1);
      expect(after.revisions).toEqual(expect.arrayContaining([...before.revisions]));
      const added = after.revisions.filter(row => !before.revisions.some(previous =>
        row.table === previous.table && row.timestamp === previous.timestamp && row.id === previous.id));
      expect(added).toHaveLength(1);
      const revision = added[0];
      if (revision === undefined) throw new Error("Missing inactive Link fence revision");
      expect(revision.deleted).toBe(false);
      expect(revision.value).toMatchObject({ id: headId, revision: currentHead.revision });
      const isHead = (row: (typeof before.rows)[number]) => row.table === revision.table && row.value.id === headId;
      expect(after.rows.filter(row => !isHead(row))).toEqual(before.rows.filter(row => !isHead(row)));
      expect(await connected.readLinks([selected.id])).toEqual(beforeLinks);
    } finally { remove.mockRestore(); }
  }, 240_000);

  it("rolls back both native sources and events after a proven late parent failure", async () => {
    const connected = await scenario(), selected = await connected.seed("Rollback"), host = await connected.prepareLateDeleteFailure();
    const before = await connected.snapshot(), result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: [selected.id] }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(apiKeyFailureMessages(result.cause)).toContain("Late parent failure after API Key and Link deletion");
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("keeps another shop's key and Link unchanged", async () => {
    const first = await scenario(), second = await scenario(), selected = await first.seed("First shop");
    const secondHost = await second.prepareDelete(), before = await first.snapshot();
    expect(await Effect.runPromise(secondHost.run(secondHost.newRequestKey(), { ids: [selected.id] }))).toBeNull();
    const after = await first.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
    expect((await first.readLinks([selected.id]))[0]?.deleted_at).toBeNull();
  }, 240_000);

  it("refuses extra capabilities and oversized or managed input before data changes", async () => {
    const connected = await scenario(), selected = await connected.seed("Confinement"), host = await connected.prepareDelete();
    const before = await connected.snapshot();
    for (const options of [{ ...connected.options, hooks: {} }, { ...connected.options, workflow: {} }, { ...connected.options, requestCallLimit: 256 },
      { ...connected.options, modules: { ...connected.options.modules, extra: connected.options.modules.api_key } }])
      expect(Exit.isFailure(await Effect.runPromiseExit(prepareApiKeyDeletionWorkflow(options)))).toBe(true);
    for (const input of [{ ids: Array.from({ length: 5 }, () => selected.id) }, { ids: [selected.id], force: true }]) {
      expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), input)))).toBe(true);
    }
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
  }, 240_000);
});
