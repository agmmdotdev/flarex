import { Effect, Option } from "effect";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { captureFrameworkSchemaAvailabilityHead, captureFrameworkSchemaAvailabilityHistory } from "../src/frameworkSchema/installation/canonical";
import { readFrameworkSchemaAvailabilityHeadInTransactionEffect, compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect } from "../src/frameworkSchema/installation/availabilityHeadRepository";
import { appendFrameworkSchemaAvailabilityHistoryInTransactionEffect } from "../src/frameworkSchema/installation/availabilityHistoryRepository";
import type { RestoredFrameworkSchemaInstallation } from "../src/frameworkSchema/installation/storedMetadataRestoration";

export const prepareBaseAvailabilityChange = Effect.fn("AdditiveFixture.prepareAvailability")(
  function* (tx: FlarexMetadataTransaction, installation: RestoredFrameworkSchemaInstallation,
    status: "ready" | "withdrawn" | "quarantined" | "superseded") {
    const current = Option.getOrThrow(yield* readFrameworkSchemaAvailabilityHeadInTransactionEffect(tx, installation));
    const history = yield* captureFrameworkSchemaAvailabilityHistory({ readiness: current.history.readiness.readiness,
      previous: current.history.history, status, reasonSha256: status === "ready" ? null : "aa".repeat(32),
      recordedAt: new Date(Date.parse(current.history.history.frame.recordedAt) + 1).toISOString(),
    });
    const stored = yield* appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(tx, current.history.readiness, current.history, history);
    return { current, stored, head: yield* captureFrameworkSchemaAvailabilityHead(stored.history) };
  },
);

export const changeBaseAvailability = Effect.fn("AdditiveFixture.changeAvailability")(
  function* (tx: FlarexMetadataTransaction, installation: RestoredFrameworkSchemaInstallation,
    status: "ready" | "withdrawn" | "quarantined" | "superseded") {
    const prepared = yield* prepareBaseAvailabilityChange(tx, installation, status);
    return yield* compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(tx, prepared.current, prepared.stored, prepared.head);
  },
);
