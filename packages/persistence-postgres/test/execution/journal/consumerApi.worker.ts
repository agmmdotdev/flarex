import * as journal from "@flarex/persistence-postgres/internal/session-journal";
import type { FrozenFiniteAttempt } from "@flarex/persistence-postgres/internal/session-journal";

export default {
  fetch() {
    // A process-local capability cannot be reconstructed from a look-alike.
    const forged = Object.freeze({}) as FrozenFiniteAttempt;
    return Response.json({
      exports: Object.keys(journal).sort(),
      detachedRefused: journal.readFrozenFiniteCommitValues(forged) === undefined,
      borrowedRefused: journal.borrowFrozenFiniteCommitValues(forged) === undefined,
      error: new journal.InvalidSessionJournalCapabilityV1Error({ capability: "attempt" })._tag,
    });
  },
};
