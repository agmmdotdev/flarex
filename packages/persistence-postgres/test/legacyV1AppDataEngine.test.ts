import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { LegacyV1StorageGeneration } from "flarex-protocol/storage-authority";
import type { DocumentRevisionRecord } from "../src/documents";
import type { InvokeSessionDocumentReadRecord } from "../src/invokeSessionReads";
import {
  createLegacyV1AppDataEngine,
  type LegacyV1AppDataEngine,
  type LegacyV1AppDataStore,
} from "../src/legacyV1AppDataEngine";

const engineKeys = [
  "commitInvokeSessionWrites",
  "getDocumentRevisionAtTs",
  "insertInvokeSessionDocumentRead",
  "insertInvokeSessionIndexRead",
  "insertInvokeSessionTableRead",
  "listDocumentsInIndexAtTs",
  "listDocumentsInTableAtTs",
  "listInvokeSessionDocumentReads",
  "listInvokeSessionDocumentWrites",
  "listInvokeSessionIndexReads",
  "listInvokeSessionTableReads",
  "stageInvokeSessionDocumentWrite",
  "storageGeneration",
] as const;

describe("legacy_v1 app-data engine", () => {
  it("exposes only the named legacy app-data compatibility surface", () => {
    const engine = createLegacyV1AppDataEngine(mockStore());

    expect(engine.storageGeneration).toBe("legacy_v1");
    expect(Object.keys(engine).sort()).toEqual([...engineKeys].sort());
    expectTypeOf(engine.storageGeneration)
      .toEqualTypeOf<LegacyV1StorageGeneration>();
    expectTypeOf<keyof LegacyV1AppDataEngine>()
      .toEqualTypeOf<(typeof engineKeys)[number]>();
  });

  it("forwards snapshot, journal, and atomic commit behavior unchanged", async () => {
    const store = mockStore();
    const engine = createLegacyV1AppDataEngine(store);
    const document = {
      deploymentId: "deployment_a",
      id: "1:document_a",
      tableId: 1,
      documentId: "document_a",
      ts: 7,
      value: { title: "A" },
      deleted: false,
      prevTs: null,
    } satisfies DocumentRevisionRecord;
    const read = {
      deploymentId: "deployment_a",
      sessionId: "session_a",
      tableId: 1,
      documentId: "1:document_a",
      observedTs: 7,
      readAt: new Date("2026-07-10T00:00:00.000Z"),
    } satisfies InvokeSessionDocumentReadRecord;
    const commitError = new Error("legacy commit failed");

    store.getDocumentRevisionAtTs.mockResolvedValue(document);
    store.insertInvokeSessionDocumentRead.mockResolvedValue(read);
    store.commitInvokeSessionWrites.mockRejectedValue(commitError);

    await expect(
      engine.getDocumentRevisionAtTs("deployment_a", "1:document_a", 9),
    ).resolves.toBe(document);
    expect(store.getDocumentRevisionAtTs)
      .toHaveBeenCalledWith("deployment_a", "1:document_a", 9);

    await expect(
      engine.insertInvokeSessionDocumentRead({
        deploymentId: "deployment_a",
        sessionId: "session_a",
        tableId: 1,
        documentId: "1:document_a",
        observedTs: 7,
      }),
    ).resolves.toBe(read);
    expect(store.insertInvokeSessionDocumentRead).toHaveBeenCalledOnce();

    await expect(
      engine.commitInvokeSessionWrites({
        deploymentId: "deployment_a",
        sessionId: "session_a",
        source: "invoke:messages:update",
        finishedAt: new Date("2026-07-10T00:00:00.000Z"),
        minimumTs: 9,
      }),
    ).rejects.toBe(commitError);
  });
});

function mockStore() {
  return {
    getDocumentRevisionAtTs:
      vi.fn<LegacyV1AppDataStore["getDocumentRevisionAtTs"]>(),
    listDocumentsInTableAtTs:
      vi.fn<LegacyV1AppDataStore["listDocumentsInTableAtTs"]>(),
    listDocumentsInIndexAtTs:
      vi.fn<LegacyV1AppDataStore["listDocumentsInIndexAtTs"]>(),
    insertInvokeSessionDocumentRead:
      vi.fn<LegacyV1AppDataStore["insertInvokeSessionDocumentRead"]>(),
    listInvokeSessionDocumentReads:
      vi.fn<LegacyV1AppDataStore["listInvokeSessionDocumentReads"]>(),
    insertInvokeSessionTableRead:
      vi.fn<LegacyV1AppDataStore["insertInvokeSessionTableRead"]>(),
    listInvokeSessionTableReads:
      vi.fn<LegacyV1AppDataStore["listInvokeSessionTableReads"]>(),
    insertInvokeSessionIndexRead:
      vi.fn<LegacyV1AppDataStore["insertInvokeSessionIndexRead"]>(),
    listInvokeSessionIndexReads:
      vi.fn<LegacyV1AppDataStore["listInvokeSessionIndexReads"]>(),
    stageInvokeSessionDocumentWrite:
      vi.fn<LegacyV1AppDataStore["stageInvokeSessionDocumentWrite"]>(),
    listInvokeSessionDocumentWrites:
      vi.fn<LegacyV1AppDataStore["listInvokeSessionDocumentWrites"]>(),
    commitInvokeSessionWrites:
      vi.fn<LegacyV1AppDataStore["commitInvokeSessionWrites"]>(),
  } satisfies LegacyV1AppDataStore;
}
