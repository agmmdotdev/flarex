import type {
  ApplicationActiveSelection,
  CoherentActiveRelationApplication,
} from "@flarex/persistence-postgres/internal/application-activation";
import {
  ApplicationActivationError,
} from "@flarex/persistence-postgres/internal/application-activation";
import { ScopeExecutionLive } from
  "@flarex/persistence-postgres/internal/scope-execution";
import { Effect, Result } from "effect";
import { decodeAppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  open: vi.fn(),
  read: vi.fn(),
  readWithSyncReceipt: vi.fn(),
}));

vi.mock(
  "@flarex/persistence-postgres/internal/application-query-snapshot",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    openApplicationRelationQuerySnapshot: operations.open,
    readApplicationRelationQueryIncomingSources: operations.read,
    readApplicationRelationQueryIncomingSourcesWithSyncReceipt:
      operations.readWithSyncReceipt,
  }),
);

import {
  decodeTakeIncomingRelationSourcesInput,
  makeApplicationRelationQuerySystemLayer,
  makeApplicationSelectionRelationQueryPort,
  takeIncomingRelationSources,
  type ApplicationRelationQuerySystemLive,
} from "../src/ApplicationRelationQuerySystem";

const TARGET_DOCUMENT_ID = decodeAppDocumentIdV1(
  "2:00000000-0000-0000-0000-000000000001",
);
const SOURCE_DOCUMENT_ID = decodeAppDocumentIdV1(
  "1:00000000-0000-0000-0000-000000000002",
);
const SELECTION = Object.freeze({}) as ApplicationActiveSelection;
const ACTIVE = Object.freeze({
  selection: SELECTION,
}) as CoherentActiveRelationApplication;
const SNAPSHOT = Object.freeze({});
const PAGE = Object.freeze({
  sources: Object.freeze([Object.freeze({
    sourceDocumentId: SOURCE_DOCUMENT_ID,
    duplicateOrdinal: 0 as const,
    position: null,
  })]),
  exhausted: true,
});
const PAGE_WITH_SYNC_RECEIPT = Object.freeze({
  page: PAGE,
  receipt: Object.freeze({
    snapshotToken: Object.freeze({
      scopeId: "00000000-0000-0000-0000-000000000003",
      epoch: "00000000-0000-0000-0000-000000000004",
      commitSeq: 7n,
    }),
    dependency: Object.freeze({
      kind: "appRelationIncoming",
      edgeDefinitionId: "00000000-0000-0000-0000-000000000005",
      targetRowId: "00000000000000000000000000000001",
      observedAdjacencyVersion: 6n,
      activationSequence: 2n,
      activeHeadSha256Hex: "11".repeat(32),
    }),
  }),
});

describe("Application relation query system", () => {
  beforeEach(() => {
    operations.open.mockReset();
    operations.read.mockReset();
    operations.readWithSyncReceipt.mockReset();
    operations.open.mockReturnValue(Effect.succeed(Object.freeze({
      snapshot: SNAPSHOT,
    })));
    operations.read.mockReturnValue(Effect.succeed(PAGE));
    operations.readWithSyncReceipt.mockReturnValue(
      Effect.succeed(PAGE_WITH_SYNC_RECEIPT),
    );
  });

  it("strictly captures the logical request and forwards one active relation read", async () => {
    const readActive = vi.fn(() => Effect.succeed(ACTIVE));
    let sourceAccesses = 0;
    let hostAccesses = 0;
    const liveWithForbiddenWorkerCapabilities = Object.defineProperties({
      activation: { readActive },
      snapshot: Object.freeze({}) as ApplicationRelationQuerySystemLive["snapshot"],
    }, {
      source: {
        get: () => {
          sourceAccesses += 1;
          throw new Error("relation query must not load a Source Artifact");
        },
      },
      host: {
        get: () => {
          hostAccesses += 1;
          throw new Error("relation query must not invoke a Worker host");
        },
      },
    }) as ApplicationRelationQuerySystemLive;

    const result = await Effect.runPromise(
      takeIncomingRelationSources(validInput()).pipe(
        Effect.provide(
          makeApplicationRelationQuerySystemLayer(
            liveWithForbiddenWorkerCapabilities,
          ),
        ),
      ),
    );

    expect(result).toBe(PAGE);
    expect(readActive).toHaveBeenCalledOnce();
    expect(operations.open).toHaveBeenCalledOnce();
    expect(operations.open).toHaveBeenCalledWith(
      SELECTION,
      {
        source: {
          table: "posts",
          path: [{ kind: "field", name: "author" }],
        },
      },
      liveWithForbiddenWorkerCapabilities.snapshot,
    );
    expect(operations.read).toHaveBeenCalledWith(
      SNAPSHOT,
      TARGET_DOCUMENT_ID,
      2,
    );
    expect(sourceAccesses).toBe(0);
    expect(hostAccesses).toBe(0);
  });

  it("offers the same scoped operation against one supplied opaque selection", async () => {
    const decoded = Result.getOrThrow(
      decodeTakeIncomingRelationSourcesInput(validInput()),
    );
    const snapshot = Object.freeze({}) as
      ApplicationRelationQuerySystemLive["snapshot"];

    const result = await Effect.runPromise(
      makeApplicationSelectionRelationQueryPort({ snapshot }).pipe(
        Effect.flatMap(port => port.takeIncomingRelationSources(
          SELECTION,
          decoded,
        )),
        Effect.provide(ScopeExecutionLive),
      ),
    );

    expect(result).toBe(PAGE);
    expect(operations.open).toHaveBeenCalledWith(
      SELECTION,
      decoded.relation,
      snapshot,
    );
    expect(operations.read).toHaveBeenCalledWith(
      SNAPSHOT,
      decoded.target,
      decoded.limit,
    );
  });

  it("offers one private receipt from the same supplied selection read", async () => {
    const decoded = Result.getOrThrow(
      decodeTakeIncomingRelationSourcesInput(validInput()),
    );
    const snapshot = Object.freeze({}) as
      ApplicationRelationQuerySystemLive["snapshot"];

    const result = await Effect.runPromise(
      makeApplicationSelectionRelationQueryPort({ snapshot }).pipe(
        Effect.flatMap(port =>
          port.takeIncomingRelationSourcesWithSyncReceipt(
            SELECTION,
            decoded,
          )
        ),
        Effect.provide(ScopeExecutionLive),
      ),
    );

    expect(result).toBe(PAGE_WITH_SYNC_RECEIPT);
    expect(operations.open).toHaveBeenCalledWith(
      SELECTION,
      decoded.relation,
      snapshot,
    );
    expect(operations.readWithSyncReceipt).toHaveBeenCalledWith(
      SNAPSHOT,
      decoded.target,
      decoded.limit,
    );
    expect(operations.read).not.toHaveBeenCalled();
  });

  it.each([
    ["primitive", null],
    ["missing target", {
      relation: validInput().relation,
      limit: 2,
    }],
    ["malformed source path", {
      ...validInput(),
      relation: { source: { table: "posts", path: [] } },
    }],
    ["populated", { ...validInput(), populate: true }],
    ["cursor", { ...validInput(), cursor: "next" }],
    ["filter", { ...validInput(), filter: { published: true } }],
    ["graph", { ...validInput(), graph: { depth: 2 } }],
    ["oversized", { ...validInput(), limit: 129 }],
  ])("rejects %s input before active authority", async (_name, input) => {
    const readActive = vi.fn(() => Effect.die("must not read active authority"));
    const outcome = await Effect.runPromise(Effect.result(
      takeIncomingRelationSources(input).pipe(
        Effect.provide(makeApplicationRelationQuerySystemLayer(live(readActive))),
      ),
    ));

    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure).toMatchObject({
        _tag: "ApplicationRelationQueryInputError",
        operation: "takeIncomingRelationSources",
        reason: "invalidInput",
      });
    }
    expect(readActive).not.toHaveBeenCalled();
    expect(operations.open).not.toHaveBeenCalled();
    expect(operations.read).not.toHaveBeenCalled();
  });

  it("rejects accessors without invoking caller code or active authority", async () => {
    let targetGetterCalls = 0;
    const input = {
      relation: validInput().relation,
      limit: 2,
    } as Record<string, unknown>;
    Object.defineProperty(input, "target", {
      enumerable: true,
      get: () => {
        targetGetterCalls += 1;
        throw new Error("must not invoke the target getter");
      },
    });
    const readActive = vi.fn(() => Effect.die("must not read active authority"));

    const outcome = await Effect.runPromise(Effect.result(
      takeIncomingRelationSources(input).pipe(
        Effect.provide(makeApplicationRelationQuerySystemLayer(live(readActive))),
      ),
    ));

    expect(Result.isFailure(outcome)).toBe(true);
    expect(targetGetterCalls).toBe(0);
    expect(readActive).not.toHaveBeenCalled();
    expect(operations.open).not.toHaveBeenCalled();
    expect(operations.read).not.toHaveBeenCalled();
  });

  it("rejects reflection traps before active authority", async () => {
    const reflectionFailure = new Error("hostile ownKeys trap");
    const input = new Proxy(validInput(), {
      ownKeys: () => {
        throw reflectionFailure;
      },
    });
    const readActive = vi.fn(() => Effect.die("must not read active authority"));

    const outcome = await Effect.runPromise(Effect.result(
      takeIncomingRelationSources(input).pipe(
        Effect.provide(makeApplicationRelationQuerySystemLayer(live(readActive))),
      ),
    ));

    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure).toMatchObject({
        _tag: "ApplicationRelationQueryInputError",
        cause: reflectionFailure,
      });
    }
    expect(readActive).not.toHaveBeenCalled();
    expect(operations.open).not.toHaveBeenCalled();
    expect(operations.read).not.toHaveBeenCalled();
  });

  it("propagates active-authority failures without opening a snapshot", async () => {
    const failure = new ApplicationActivationError({
      operation: "read",
      reason: "activeMissing",
      retryable: false,
    });
    const readActive = vi.fn(() => Effect.fail(failure));

    const outcome = await Effect.runPromise(Effect.result(
      takeIncomingRelationSources(validInput()).pipe(
        Effect.provide(makeApplicationRelationQuerySystemLayer(live(readActive))),
      ),
    ));

    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) expect(outcome.failure).toBe(failure);
    expect(operations.open).not.toHaveBeenCalled();
    expect(operations.read).not.toHaveBeenCalled();
  });

  it("propagates snapshot-open failures without reading", async () => {
    const failure = Object.freeze({ _tag: "OpenRelationSnapshotFailure" });
    operations.open.mockReturnValue(Effect.fail(failure));
    const readActive = vi.fn(() => Effect.succeed(ACTIVE));

    const outcome = await Effect.runPromise(Effect.result(
      takeIncomingRelationSources(validInput()).pipe(
        Effect.provide(makeApplicationRelationQuerySystemLayer(live(readActive))),
      ),
    ));

    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) expect(outcome.failure).toBe(failure);
    expect(readActive).toHaveBeenCalledOnce();
    expect(operations.open).toHaveBeenCalledOnce();
    expect(operations.read).not.toHaveBeenCalled();
  });

  it("propagates relation-read failures unchanged", async () => {
    const failure = Object.freeze({ _tag: "RelationSnapshotReadFailure" });
    operations.read.mockReturnValue(Effect.fail(failure));
    const readActive = vi.fn(() => Effect.succeed(ACTIVE));

    const outcome = await Effect.runPromise(Effect.result(
      takeIncomingRelationSources(validInput()).pipe(
        Effect.provide(makeApplicationRelationQuerySystemLayer(live(readActive))),
      ),
    ));

    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) expect(outcome.failure).toBe(failure);
    expect(readActive).toHaveBeenCalledOnce();
    expect(operations.open).toHaveBeenCalledOnce();
    expect(operations.read).toHaveBeenCalledOnce();
  });
});

function validInput() {
  return {
    relation: {
      source: {
        table: "posts",
        path: [{ kind: "field", name: "author" }],
      },
    },
    target: TARGET_DOCUMENT_ID,
    limit: 2,
  };
}

function live(
  readActive: ApplicationRelationQuerySystemLive["activation"]["readActive"],
): ApplicationRelationQuerySystemLive {
  return {
    activation: { readActive },
    snapshot: Object.freeze({}) as ApplicationRelationQuerySystemLive["snapshot"],
  };
}
