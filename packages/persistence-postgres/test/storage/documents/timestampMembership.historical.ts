import { Effect } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { JsonObject } from "flarex-protocol/json";
import { prepareNeutralLogicalFixture } from "../relationalSchema/neutralLogicalFixture";
import { prepareLogicalRelationalAdmission, requireLogicalRelationalAdmission } from "../../../src/storage/documents/logicalDocuments/relationalAdmission";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../../src/scope/scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../../../src/scope/scopeClock";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { makeBoundedRequestLifetime } from "../../../src/execution/preparation/boundedRequestLifetime";
import { makeLogicalDocumentWorkingSet } from "../../../src/storage/documents/logicalDocuments/workingSet";

/** Choose a genuine earlier committed clock, then invoke the existing source
 * admission, indexed history and pending working-set owners unchanged. The
 * harness supplies no row decoding, candidate selection or predicate verdict. */
export function readTimestampMembershipAtSnapshot(fixture: Awaited<ReturnType<typeof prepareNeutralLogicalFixture>>,
  source: unknown, snapshotCommitSeq: CommitSeq, query: JsonObject) {
  return Effect.gen(function* () {
    const error = (reason: string, cause?: unknown) => new Error(reason, { cause });
    const prepared = yield* prepareLogicalRelationalAdmission(fixture.hostInput.logicalStorage.ports,
      fixture.hostInput.logicalStorage.unique, { deploymentId: fixture.application.deploymentId,
        scopeId: fixture.application.authority.scopeId, schemaVersionId: fixture.schemaVersionId }, source, { kind: "standalone" });
    const active = yield* fixture.application.activation.readActive();
    const resolved = yield* resolveLocatedTrustedScopeAuthorityEffect(fixture.application.deploymentId, fixture.application.authorityPorts);
    const read = (tx: FlarexMetadataTransaction) => Effect.scoped(Effect.gen(function* () {
      const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, fixture.application.authority.scopeId);
      return yield* prepared.withReadAdmission(active.selection, tx, resolved.authority, clock, admission => Effect.gen(function* () {
        const state = yield* requireLogicalRelationalAdmission(admission, tx);
        const mechanics = state.writeMechanics;
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(error,
          { calls: 16, commandBytes: 1_048_576, commandMs: 10_000 }, {}, {}, "timestamp-membership-history", "read"), owner => owner.close);
        const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId: state.authority.scopeId, clock, snapshotCommitSeq, lifetime,
          tables: mechanics.tables, writeMechanics: mechanics,
          ...(mechanics.relationalCapabilities === undefined ? {} : { relationalCapabilities: mechanics.relationalCapabilities }),
          searchDefinitions: mechanics.searchDefinitions, readReadiness: { kind: "full" },
          requireAdmission: requireLogicalRelationalAdmission(admission, tx).pipe(Effect.asVoid, Effect.mapError(cause => error("invalidAuthority", cause))),
          validateDocument: () => Effect.fail(error("readOnly")), error, uniqueConflict: () => error("readOnly"),
          limits: { pageRows: 32, identities: 256, documentBytes: 65_536 },
        }, AppCreationTimeV1Schema.make(1), mechanics.unique, mechanics.indexes);
        const id = yield* lifetime.begin(lifetime.context), store = yield* working.relationalTable(lifetime.context, id, "entry");
        const rows = yield* store.find(lifetime.context, query);
        yield* lifetime.seal;
        const activity = yield* working.close();
        return { rows, indexReads: activity.indexReads, dependencies: activity.dependencies };
      }));
    }));
    return yield* runEffectTransaction<Effect.Success<ReturnType<typeof read>>, Effect.Error<ReturnType<typeof read>>,
      Error, FlarexMetadataTransaction>(callback => fixture.persistence.drizzle.transaction(callback),
      "Timestamp historical read rolled back", read, cause => error("resourceFailure", cause));
  });
}
