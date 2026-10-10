import {
  Effect,
  Result,
} from "effect";
import {
  canonicalizeApplicationRuntimeColdReceiptV1,
  type CanonicalApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  encodeBytesToLowercaseHex,
  copyBytes,
  bytesEqualFullScan,
} from "@flarex/utils/bytes";
import {
  type StoredBundle,
  requireExactAuthority,
} from "./bundle";
import type { ApplicationReadinessColdMaterializationPort } from "./contracts";
import {
  type ApplicationReadinessError,
  readinessFailure,
  readinessFailureValue,
} from "./errors";
import {
  validRuntimeHostIdentity,
  validCompatibilityDate,
  UTF8_FATAL,
} from "./limits";
import {
  sha256,
  decodeSha256,
  digestCanonicalJson,
} from "./frames";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  type ScopeClockRecord,
  type LockScopeClockForShareError,
  lockScopeClockForShareInTransactionEffect,
} from "../../scope/scopeClock";
import {
  fxSystemApplicationReadinessV1,
  fxSystemApplicationReadinessFunctionsV1,
  type fxSystemApplicationFunctionsV1,
} from "../../database/schema";
import {
  and,
  eq,
} from "drizzle-orm";
import { query } from "./databaseBoundary";
import type { ApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import {
  type CanonicalApplicationRuntimeTargetV1,
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";

export interface ColdEvidence {
  readonly functionPath: string;
  readonly runtimeTargetSha256: Uint8Array;
  readonly coldReceiptSha256: Uint8Array;
  readonly coldReceiptBytes: Uint8Array;
}

export interface PreparedColdEvidence {
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly entries: ReadonlyArray<ColdEvidence>;
}

export const materializeFunctions = Effect.fn(function* <Failure>(
  bundle: StoredBundle,
  port: ApplicationReadinessColdMaterializationPort<Failure>,
): Effect.fn.Return<PreparedColdEvidence, ApplicationReadinessError | Failure> {
    const runtimeHostIdentity = port.runtimeHostIdentity;
    const compatibilityDate = port.compatibilityDate;
    const materialize = port.materialize;
    if (!validRuntimeHostIdentity(runtimeHostIdentity) ||
      !validCompatibilityDate(compatibilityDate) ||
      typeof materialize !== "function" ||
      runtimeHostIdentity !== bundle.task.runtimeHostIdentity ||
      compatibilityDate !== bundle.task.compatibilityDate) {
      return yield* readinessFailure("coldMaterialization");
    }
    const output: ColdEvidence[] = [];
    for (let index = 0; index < bundle.manifest.functions.length; index += 1) {
      const fn = bundle.manifest.functions[index];
      const stored = bundle.functions[index];
      if (fn === undefined || stored === undefined || stored.functionPath !== fn.path) {
        return yield* readinessFailure("storedState");
      }
      const target = yield* prepareRuntimeTarget(bundle, fn, stored);
      const received = yield* materialize({
        target: target.target,
        manifest: bundle.manifest,
      });
      const canonical = yield* Effect.fromResult(
        canonicalizeApplicationRuntimeColdReceiptV1(received.receipt).pipe(
          Result.mapError(cause => readinessFailureValue(
            "coldMaterialization",
            false,
            cause,
          )),
        ),
      );
      if (canonical.receipt.runtimeHostIdentity !== runtimeHostIdentity ||
        canonical.receipt.compatibilityDate !== compatibilityDate ||
        canonical.receipt.functionPath !== fn.path ||
        canonical.receipt.functionKind !== fn.kind ||
        canonical.receipt.visibility !== fn.visibility ||
        canonical.receipt.sourceArtifactRootSha256 !==
          encodeBytesToLowercaseHex(bundle.revision.sourceArtifactRootSha256) ||
        canonical.receipt.manifestSha256 !==
          encodeBytesToLowercaseHex(bundle.revision.manifestSha256) ||
        canonical.receipt.runtimeTargetSha256 !==
          encodeBytesToLowercaseHex(yield* sha256(target.canonicalBytes)) ||
        canonical.receipt.publicationSha256 !==
          encodeBytesToLowercaseHex(bundle.publication.publicationSha256)) {
        return yield* readinessFailure("coldMaterialization");
      }
      output.push(Object.freeze({
        functionPath: fn.path,
        runtimeTargetSha256: decodeSha256(
          canonical.receipt.runtimeTargetSha256,
        ),
        coldReceiptSha256: yield* sha256(canonical.canonicalBytes),
        coldReceiptBytes: copyBytes(canonical.canonicalBytes),
      }));
    }
    return Object.freeze({
      runtimeHostIdentity,
      compatibilityDate,
      entries: Object.freeze(output),
    });
  });

export const loadStoredColdEvidence = Effect.fn("ApplicationReadiness.loadStoredColdEvidence")(function* <Failure>(
  tx: AppRowTransaction,
  bundle: StoredBundle,
  port: ApplicationReadinessColdMaterializationPort<Failure>,
  lockedClock?: ScopeClockRecord,
): Effect.fn.Return<PreparedColdEvidence | null, ApplicationReadinessError |
  LockScopeClockForShareError> {
    const runtimeHostIdentity = port.runtimeHostIdentity;
    const compatibilityDate = port.compatibilityDate;
    if (!validRuntimeHostIdentity(runtimeHostIdentity) ||
      !validCompatibilityDate(compatibilityDate) ||
      typeof port.materialize !== "function" ||
      runtimeHostIdentity !== bundle.task.runtimeHostIdentity ||
      compatibilityDate !== bundle.task.compatibilityDate) {
      return yield* readinessFailure("coldMaterialization");
    }
    const clock = lockedClock ?? (yield* lockScopeClockForShareInTransactionEffect(tx, bundle.authority.scopeId));
    yield* requireExactAuthority(bundle.authority, clock);
    const readinessRows = yield* query(
      tx.select().from(fxSystemApplicationReadinessV1).where(and(
        eq(fxSystemApplicationReadinessV1.scopeId, bundle.authority.scopeId),
        eq(fxSystemApplicationReadinessV1.revisionId, bundle.revision.revisionId),
      )).limit(1).for("share"),
    );
    const readiness = readinessRows[0];
    if (readiness === undefined) return null;
    if (readiness.runtimeHostIdentity !== runtimeHostIdentity ||
      readiness.compatibilityDate !== compatibilityDate) {
      return yield* readinessFailure("conflictingReplay");
    }
    const children = yield* query(
      tx.select().from(fxSystemApplicationReadinessFunctionsV1).where(and(
        eq(
          fxSystemApplicationReadinessFunctionsV1.scopeId,
          bundle.authority.scopeId,
        ),
        eq(
          fxSystemApplicationReadinessFunctionsV1.revisionId,
          bundle.revision.revisionId,
        ),
      )).for("share"),
    );
    return yield* authenticateStoredColdEvidence(bundle, port, readiness, children);
});

export const authenticateStoredColdEvidence = Effect.fn('ApplicationReadiness.authenticateStoredColdEvidence')(
function* <Failure>(bundle: StoredBundle, port: ApplicationReadinessColdMaterializationPort<Failure>,
  readiness: typeof fxSystemApplicationReadinessV1.$inferSelect,
  children: ReadonlyArray<typeof fxSystemApplicationReadinessFunctionsV1.$inferSelect>) {
    const runtimeHostIdentity = port.runtimeHostIdentity;
    const compatibilityDate = port.compatibilityDate;
    if (!validRuntimeHostIdentity(runtimeHostIdentity) || !validCompatibilityDate(compatibilityDate) ||
      typeof port.materialize !== 'function' || runtimeHostIdentity !== bundle.task.runtimeHostIdentity ||
      compatibilityDate !== bundle.task.compatibilityDate) return yield* readinessFailure('coldMaterialization');
    if (readiness.runtimeHostIdentity !== runtimeHostIdentity || readiness.compatibilityDate !== compatibilityDate)
      return yield* readinessFailure('conflictingReplay');
    if (children.length !== bundle.manifest.functions.length) {
      return yield* readinessFailure("conflictingReplay");
    }
    const childrenByPath = new Map(
      children.map(child => [child.functionPath, child] as const),
    );
    if (childrenByPath.size !== children.length) {
      return yield* readinessFailure("conflictingReplay");
    }
    const entries: ColdEvidence[] = [];
    for (let index = 0; index < bundle.manifest.functions.length; index += 1) {
      const fn = bundle.manifest.functions[index];
      const storedFunction = bundle.functions[index];
      const child = fn === undefined ? undefined : childrenByPath.get(fn.path);
      if (fn === undefined || storedFunction === undefined ||
        child === undefined || child.functionPath !== fn.path ||
        storedFunction.functionPath !== fn.path) {
        return yield* readinessFailure("conflictingReplay");
      }
      const target = yield* prepareRuntimeTarget(bundle, fn, storedFunction);
      const runtimeTargetSha256 = yield* sha256(target.canonicalBytes);
      const canonical = yield* decodeStoredColdReceipt(child.coldReceiptBytes);
      if (!bytesEqualFullScan(child.readinessSha256, readiness.readinessSha256) ||
        !bytesEqualFullScan(child.runtimeTargetSha256, runtimeTargetSha256) ||
        !bytesEqualFullScan(
          child.coldReceiptSha256,
          yield* sha256(canonical.canonicalBytes),
        ) || canonical.receipt.runtimeHostIdentity !== runtimeHostIdentity ||
        canonical.receipt.compatibilityDate !== compatibilityDate ||
        canonical.receipt.functionPath !== fn.path ||
        canonical.receipt.functionKind !== fn.kind ||
        canonical.receipt.visibility !== fn.visibility ||
        canonical.receipt.sourceArtifactRootSha256 !==
          encodeBytesToLowercaseHex(bundle.revision.sourceArtifactRootSha256) ||
        canonical.receipt.manifestSha256 !==
          encodeBytesToLowercaseHex(bundle.revision.manifestSha256) ||
        canonical.receipt.publicationSha256 !==
          encodeBytesToLowercaseHex(bundle.publication.publicationSha256) ||
        canonical.receipt.runtimeTargetSha256 !==
          encodeBytesToLowercaseHex(runtimeTargetSha256)) {
        return yield* readinessFailure("conflictingReplay");
      }
      entries.push(Object.freeze({
        functionPath: fn.path,
        runtimeTargetSha256: copyBytes(runtimeTargetSha256),
        coldReceiptSha256: copyBytes(child.coldReceiptSha256),
        coldReceiptBytes: copyBytes(canonical.canonicalBytes),
      }));
    }
    return Object.freeze({
      runtimeHostIdentity,
      compatibilityDate,
      entries: Object.freeze(entries),
    });
});

export function digestColdReceiptSet(
  cold: PreparedColdEvidence,
): Effect.Effect<Uint8Array> {
  return digestCanonicalJson({
    format: "flarex.application-cold-receipt-set",
    version: 1,
    runtimeHostIdentity: cold.runtimeHostIdentity,
    compatibilityDate: cold.compatibilityDate,
    entries: cold.entries.map(entry => ({
      functionPath: entry.functionPath,
      runtimeTargetSha256:
        encodeBytesToLowercaseHex(entry.runtimeTargetSha256),
      coldReceiptSha256: encodeBytesToLowercaseHex(entry.coldReceiptSha256),
    })),
  });
}

function prepareRuntimeTarget(
  bundle: StoredBundle,
  fn: ApplicationManifestV1["functions"][number],
  stored: typeof fxSystemApplicationFunctionsV1.$inferSelect,
): Effect.Effect<CanonicalApplicationRuntimeTargetV1, ApplicationReadinessError> {
  return Effect.fromResult(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: bundle.revision.scopeId,
    revisionId: bundle.revision.revisionId,
    candidateId: bundle.revision.candidateId,
    analysisId: bundle.revision.analysisId,
    sourceArtifactRootSha256:
      encodeBytesToLowercaseHex(bundle.revision.sourceArtifactRootSha256),
    manifestSha256: encodeBytesToLowercaseHex(bundle.revision.manifestSha256),
    schemaSha256: encodeBytesToLowercaseHex(bundle.publication.schemaSha256),
    functionCatalogSha256:
      encodeBytesToLowercaseHex(bundle.publication.functionCatalogSha256),
    publicationSha256:
      encodeBytesToLowercaseHex(bundle.publication.publicationSha256),
    executionModulePath: bundle.manifest.sourceArtifact.executionModulePath,
    function: {
      ...fn,
      entrySha256: encodeBytesToLowercaseHex(stored.entrySha256),
    },
  }).pipe(Result.mapError(cause => readinessFailureValue(
    "storedState",
    false,
    cause,
  ))));
}

const decodeStoredColdReceipt = Effect.fn(
  "ApplicationReadiness.decodeStoredColdReceipt",
)(function* (
  bytes: Uint8Array,
): Effect.fn.Return<
  CanonicalApplicationRuntimeColdReceiptV1,
  ApplicationReadinessError
> {
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(bytes)),
    catch: cause => readinessFailureValue("conflictingReplay", false, cause),
  });
  const canonical = yield* Effect.fromResult(
    canonicalizeApplicationRuntimeColdReceiptV1(parsed).pipe(
      Result.mapError(cause => readinessFailureValue(
        "conflictingReplay",
        false,
        cause,
      )),
    ),
  );
  return bytesEqualFullScan(bytes, canonical.canonicalBytes)
    ? canonical
    : yield* readinessFailure("conflictingReplay");
});
