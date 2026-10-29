import { Effect, Option } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema, canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import type { privatePermissionFixture } from "../../application/ownership/privatePermissionFixture";
import type { ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import { inspectPrivateReferencePermissionEvidence } from "../../../src/execution/journal/privatePermissionEvidence";
import { revokeFiniteApplicationScope } from "./finiteApplicationAdmissionScenario";
import { fxSystemCommits, fxSystemIdempotency } from "../../../src/database/schema";

type Fixture = Awaited<ReturnType<typeof privatePermissionFixture>>;
const sequence = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);

/** The existing fixture produces, analyzes and publishes the protected audit
 * table's application-command policy. The ordinary users table is ineligible. */
export const seedFinitePrivateAdmissionPermissions = Effect.fn("FinitePrivateApplicationAdmission.seed")(
  function* (fixture: Fixture) {
    const root = yield* Effect.tryPromise(() => fixture.open());
    const permissions = { format: "flarex.private-reference-permissions", version: 1, principal: root.principal,
      collection: "articles", relation: "featuredProduct", source: { create: true, update: true, delete: false },
      assign: ["product-one"], retain: ["product-one"] };
    const command = yield* fixture.store.preparePrivateApplicationCommandEffect(root.attempt, "audit");
    const inserted = yield* command.run({ kind: "insert", syscallSequence: sequence(1n), fields: { policy: permissions } }, root.validator);
    if (inserted.kind !== "completed" || inserted.outcome.kind !== "inserted") throw new Error("Missing genuine private permission document");
    expect(yield* Effect.tryPromise(() => root.publish())).toMatchObject({ kind: "published" });
    return inserted.outcome.documentId;
  },
);

export const finitePrivateApplicationAdmissionScenario = Effect.fn("FinitePrivateApplicationAdmission.scenario")(
  function* (fixture: Fixture, persistence: ApplicationNativeMutationPersistence) {
    const documentId = yield* seedFinitePrivateAdmissionPermissions(fixture);
    const reader = yield* Effect.tryPromise(() => fixture.open());
    const read = (root: typeof reader, seq = 1n) => fixture.store.readPrivateReferencePermissionsEffect(root.attempt,
      { tableName: "audit", documentId, syscallSequence: sequence(seq), principal: root.principal }, root.validator);
    const evidence = yield* read(reader);
    if (Option.isNone(evidence)) throw new Error("Eligible private permission control returned absence");
    expect(inspectPrivateReferencePermissionEvidence(evidence.value, reader.attempt, reader.principal)).toBeDefined();
    expect(Option.isSome(yield* read(reader))).toBe(true);
    const control = yield* Effect.tryPromise(() => fixture.open());
    const liveCommand = yield* fixture.store.preparePrivateApplicationCommandEffect(control.attempt, "audit");
    expect(yield* liveCommand.run({ kind: "get", documentId, syscallSequence: sequence(1n) }, control.validator))
      .toMatchObject({ kind: "completed", outcome: { kind: "present" } });
    const writer = yield* Effect.tryPromise(() => fixture.open());
    const command = yield* fixture.store.preparePrivateApplicationCommandEffect(writer.attempt, "audit");
    // Sequence one makes this genuine reader locally ineligible to mint a
    // command. Fresh revocation must still win before that eligibility verdict.
    const ineligible = yield* Effect.tryPromise(() => fixture.open());
    expect(Option.isSome(yield* read(ineligible))).toBe(true);
    const publicationState = () => Promise.all([
      persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq),
      persistence.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.commitSeq),
    ]);
    const beforePublication = yield* Effect.tryPromise(publicationState);
    yield* revokeFiniteApplicationScope({ target: persistence, authority: fixture.application.authority });
    expect(yield* Effect.flip(fixture.store.preparePrivateApplicationCommandEffect(ineligible.attempt, "audit")))
      .toMatchObject({ _tag: "SessionJournalAttemptUnavailableV1Error", issue: { reason: "authorizationRevocationEpochChanged" } });
    const operations: readonly Effect.Effect<void, Effect.Error<ReturnType<typeof read>> | Effect.Error<ReturnType<typeof command.run>>, never>[] = [
      read(reader).pipe(Effect.asVoid), command.run({ kind: "get", documentId, syscallSequence: sequence(1n) }, writer.validator).pipe(Effect.asVoid),
    ];
    for (const operation of operations) {
      expect(yield* Effect.flip(operation)).toMatchObject({ _tag: "SessionJournalAttemptUnavailableV1Error",
        issue: { reason: "authorizationRevocationEpochChanged" } });
    }
    expect(inspectPrivateReferencePermissionEvidence(evidence.value, reader.attempt, reader.principal)).toBeUndefined();
    for (const root of [reader, writer, ineligible]) expect(yield* Effect.flip(fixture.store.freezeFiniteRootEffect(root.attempt,
      yield* canonicalizeSuccessfulResultV1Effect(null)))).toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
    expect(yield* Effect.tryPromise(publicationState)).toEqual(beforePublication);
  },
);
