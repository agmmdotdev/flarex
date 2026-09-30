import { Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeEpochSchema,
  ScopeIdSchema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { makeBoundedRequestLifetime, type RequestFailureReason } from "../src/boundedRequestLifetime";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import type { SessionJournalAttempt } from "../src/sessionJournalStore";
import { makeLogicalDocumentRootEvaluator } from "../src/logicalDocuments/rootEvaluator";
import { makeLogicalDocumentWorkingSet } from "../src/logicalDocuments/workingSet";
import { runEffect } from "./effectTestRuntime";

const tableId = CatalogTableIdSchema.make(1);
const scopeId = ScopeIdSchema.make("scope_91000000-0000-4000-8000-000000000001");
const snapshotCommitSeq = CommitSeqSchema.make(1n);
// SAFETY: the root issuer authenticates this opaque handle by object identity;
// this local working-set fixture does not invoke the journal issuer.
const attempt = Object.freeze({}) as SessionJournalAttempt;
const attemptFence = "1";
const missingId = appDocumentIdV1FromRowIdentity({ tableId,
  rowId: decodeAppRowIdHexV1("ffffffffffffffffffffffffffffffff") });

const make = (read: () => Effect.Effect<never, Error> = () => Effect.fail(new Error("unexpected database read")),
  calls = 32) =>
  Effect.gen(function* () {
    let readCalls = 0;
    const lifetime = yield* makeBoundedRequestLifetime(
      (reason: RequestFailureReason) => new Error(reason),
      { calls, commandBytes: 128_000, commandMs: 30_000 },
      attempt, Object.freeze({}), "finite-local-request", "write", "require");
    const id = yield* lifetime.begin(lifetime.context);
    const root = makeLogicalDocumentRootEvaluator({ attempt, scopeId, snapshotCommitSeq, attemptFence },
      { identities: 64, workingBytes: 128_000 });
    const working = yield* makeLogicalDocumentWorkingSet({
      readTransaction: () => Effect.sync(() => { readCalls++; }).pipe(Effect.andThen(read())),
      requireAdmission: Effect.void,
      scopeId, clock: { scopeId, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(1n), lastCommitSeq: snapshotCommitSeq,
        oldestAvailableCommitSeq: CommitSeqSchema.make(0n), epoch: ScopeEpochSchema.make("test_epoch"),
        updatedAt: new Date(0) },
      snapshotCommitSeq, rootEvaluator: root, rootAttempt: attempt, rootAttemptFence: attemptFence,
      lifetime, tables: [{ tableId, logicalName: "items" }], limits: {
        pageRows: 32, identities: 64, documentBytes: 16_000,
      }, validateDocument: () => Effect.void,
      error: reason => new Error(reason), uniqueConflict: () => new Error("uniqueConflict"),
    }, AppCreationTimeV1Schema.make(1), [], [], undefined, {} as FlarexMetadataTransaction);
    return { root, lifetime, id, working, readCalls: () => readCalls };
  });

it("evaluates a finite root's pending writes, cached reads, and close without admission SQL", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working, readCalls } = yield* make();
    const inserted = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada" });
    const documentId = inserted._id;
    if (typeof documentId !== "string") throw new Error("Missing inserted document ID");
    expect(yield* working.documents.get(lifetime.context, id, documentId, "items"))
      .toMatchObject({ name: "Ada" });
    expect(yield* working.documents.getMany(lifetime.context, id, "items", [documentId]))
      .toEqual([expect.objectContaining({ name: "Ada" })]);
    expect(readCalls()).toBe(0);
    yield* lifetime.seal;
    const changes = yield* working.close();
    expect(changes.attempts).toHaveLength(1);
    expect(readCalls()).toBe(0);
    yield* lifetime.close;
    root.close();
  })));

it("checks live authority on the next uncached read after tentative local work", () =>
  runEffect(Effect.gen(function* () {
    const revoked = new Error("revoked at checked read");
    const { root, lifetime, id, working, readCalls } = yield* make(() => Effect.fail(revoked));
    const inserted = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada" });
    if (typeof inserted._id !== "string") throw new Error("Missing inserted document ID");
    expect(yield* working.documents.get(lifetime.context, id, inserted._id, "items"))
      .toMatchObject({ name: "Ada" });
    expect(readCalls()).toBe(0);
    const refusal = yield* Effect.result(working.documents.get(lifetime.context, id, missingId, "items"));
    expect(refusal).toMatchObject({ _tag: "Failure", failure: revoked });
    expect(readCalls()).toBe(1);
    expect(Exit.isFailure(yield* Effect.exit(lifetime.seal))).toBe(true);
    yield* lifetime.close;
    root.close();
  })));

it("rejects a cancelled finite root before capturing foreign write input", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working, readCalls } = yield* make();
    let captures = 0;
    const input = new Proxy({}, { ownKeys: () => { captures++; throw new Error("foreign capture"); } });
    root.close();
    const refusal = yield* Effect.result(working.documents.insert(lifetime.context, id, "items", input));
    expect(refusal).toMatchObject({ _tag: "Failure", failure: new Error("closed") });
    expect(captures).toBe(0);
    expect(readCalls()).toBe(0);
    yield* lifetime.close;
  })));

it("refuses wrong-context and exhausted-call writes before Proxy capture", () =>
  runEffect(Effect.gen(function* () {
    let captures = 0;
    const input = new Proxy({}, { ownKeys: () => { captures++; throw new Error("foreign capture"); } });
    const scoped = yield* make();
    const foreign = yield* make();
    const wrongContext = yield* Effect.result(scoped.working.documents.insert(
      foreign.lifetime.context, scoped.id, "items", input));
    expect(wrongContext).toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
    expect(captures).toBe(0);
    expect(scoped.readCalls()).toBe(0);
    yield* scoped.lifetime.close;
    yield* foreign.lifetime.close;
    scoped.root.close();
    foreign.root.close();

    const limited = yield* make(undefined, 2);
    const overBudget = yield* Effect.result(limited.working.documents.insert(
      limited.lifetime.context, limited.id, "items", input));
    expect(overBudget).toMatchObject({ _tag: "Failure", failure: new Error("limitExceeded") });
    expect(captures).toBe(0);
    expect(limited.readCalls()).toBe(0);
    yield* limited.lifetime.close;
    limited.root.close();
  })));
