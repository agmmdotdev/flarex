import { Cause, Effect, Exit, Result } from "effect";
import { getCoLocatedReadInstallationReferencesResult } from "../../src/installation/installationLifecycle";
import { prepareProtectedMetadata } from "../../src/execution/preparation/preparedMetadataEpoch";
import { expect, it, vi } from "vitest";
import { NodePgSession } from "drizzle-orm/node-postgres";
import { PgliteSession } from "drizzle-orm/pglite";
import * as drizzleUtils from "drizzle-orm/utils";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, createActivationServingFileScopedPostgresFixture,
  createCoLocatedReadInstallationFixture, postgresUrl } from "../support/postgresHelpers";
import { createPostgresLocatedPointMutationSessionActivationTargetV1 } from "../../src/database/postgres";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "../../src/database/locatedTransactionIdentity";
import { finiteApplicationMetadataScenario } from "../application/finiteApplicationMetadataScenario";
import * as finiteStorageCapture from "../../src/execution/finiteStorageCapture";
import type { FiniteStorageCaptureOperation, FiniteStorageCaptureProfile } from "../../src/execution/finiteStorageCapture";
import type {
  ExactRunningAttemptKernelInputV1,
} from "../../src/execution/session/kernelContracts";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import type { ScopePhysicalLocator } from "../../src/scope/scopeMetadataTypes";
import { runEffect } from "../support/effectTestRuntime";

/** Compare the private plan with pinned Drizzle on the same real driver rows.
 * This observes mapping only; genuine entry, SQL acceptance and driver execution
 * still belong to the connected scenario. */
function observeCaptureProjectionParity() {
  let onCapturePrepare: ((args: Parameters<typeof PgliteSession.prototype.prepareQuery>) => void) | undefined;
  const reference: unknown = Reflect.get(drizzleUtils, "mapResultRow");
  if (typeof reference !== "function") throw new Error("Pinned Drizzle result mapper is missing");
  let mappedCaptureRows = 0;
  const originalPglite = PgliteSession.prototype.prepareQuery;
  const originalPostgres = NodePgSession.prototype.prepareQuery;
  const compare = (args: Parameters<typeof originalPglite>) => {
    const fields = args[1];
    const mapper = args[4];
    if (mapper === undefined || fields === undefined) return;
    args[4] = rows => {
      const actual: unknown = mapper(rows);
      if (actual !== null && typeof actual === "object" && Reflect.get(actual, "layoutFailure") !== undefined)
        return actual;
      const expected: unknown[] = rows.map(row => Reflect.apply(reference, drizzleUtils, [fields, row]));
      if (args[2]?.startsWith("fx_finite_")) {
        const first = expected[0];
        if (first === null || typeof first !== "object") throw new Error("Missing reference finite header");
        const consumesFrontier = Reflect.get(first, "reason") === "attemptReplaced";
        const header = Object.fromEntries(Object.entries(first).filter(([name]) => name !== "raw" && name !== "storagePresent"
          && (name !== "frontier" || consumesFrontier)));
        if (!consumesFrontier) {
          if (actual === null || typeof actual !== "object") throw new Error("Missing mapped finite capture");
          const actualHeader: unknown = Reflect.get(actual, "header");
          if (actualHeader === null || typeof actualHeader !== "object") throw new Error("Missing mapped finite header");
          expect(Object.hasOwn(actualHeader, "frontier")).toBe(false);
        }
        const bodies = expected.flatMap(row => {
          if (row === null || typeof row !== "object") throw new Error("Invalid reference finite row");
          return Reflect.get(row, "storagePresent") === true ? [Reflect.get(row, "raw")] : [];
        });
        expect(actual).toEqual({ header, rawRows: bodies, layoutFailure: undefined });
      } else expect(actual).toEqual(expected);
      mappedCaptureRows += rows.length;
      return actual;
    };
  };
  const pglite = vi.spyOn(PgliteSession.prototype, "prepareQuery").mockImplementation(function (
    this: typeof PgliteSession.prototype, ...args
  ) { compare(args); onCapturePrepare?.(args); return originalPglite.apply(this, args); });
  const postgres = vi.spyOn(NodePgSession.prototype, "prepareQuery").mockImplementation(function (
    this: typeof NodePgSession.prototype, ...args
  ) { compare(args); onCapturePrepare?.(args); return originalPostgres.apply(this, args); });
  return {
    verify: () => expect(mappedCaptureRows).toBeGreaterThan(0),
    observeCapture: (observe: typeof onCapturePrepare) => { onCapturePrepare = observe; },
    restore: () => { pglite.mockRestore(); postgres.mockRestore(); },
  };
}

type BoundCaptureOwner = Result.Result.Success<ReturnType<typeof finiteStorageCapture.bindFiniteStorageCaptureOwner>>;
interface ObservedOwnershipCapture {
  readonly owner: BoundCaptureOwner;
  readonly database: FlarexMetadataDatabase;
  readonly locator: ScopePhysicalLocator;
  readonly profile: FiniteStorageCaptureProfile;
  readonly input: ExactRunningAttemptKernelInputV1;
  readonly operation: Extract<FiniteStorageCaptureOperation, { kind: "ownership" }>;
}

/** Retain only the genuine owner-issued input while its scenario root is live. */
function observeGenuineOwnershipCapture(installedOnly = true) {
  let selected: ObservedOwnershipCapture | undefined;
  const bind = finiteStorageCapture.bindFiniteStorageCaptureOwner;
  const binding = vi.spyOn(finiteStorageCapture, "bindFiniteStorageCaptureOwner").mockImplementation((database, locator, profile) =>
    Result.map(bind(database, locator, profile), owner => {
      if (installedOnly && profile.kind !== "installed") return owner;
      const observe = (input: ExactRunningAttemptKernelInputV1, operation: FiniteStorageCaptureOperation) => {
        if (operation.kind === "ownership") selected = { owner, database, locator, profile, input, operation };
      };
      const capture: typeof owner.capture = (input, operation) => {
        observe(input, operation);
        return owner.capture(input, operation);
      };
      return Object.freeze({ capture });
    }));
  return {
    read: () => {
      if (selected === undefined) throw new Error("Missing genuine installed ownership capture");
      return selected;
    },
    restore: () => binding.mockRestore(),
  };
}

/** Replays genuine owner-issued demand while its original scenario root is live.
 * Only driver-returned positional values change; authority/claim/SQL and the
 * existing transaction owner still run on every refusal witness. */
async function verifyCaptureLayoutFailureOrder(capture: ObservedOwnershipCapture,
  projection: ReturnType<typeof observeCaptureProjectionParity>) {
  type Mutation = (rows: unknown[][], index: (path: readonly string[]) => number) => void;
  const malformedMarker: Mutation = (rows, index) => { rows[0]![index(["storagePresent"])] = "true"; };
  const cases: ReadonlyArray<Readonly<{ mutate: Mutation; reason: string; retirement?: true; frontier?: true; native?: true;
    unreadHeader?: string; defect?: true }>> = [
    { mutate: rows => { rows[0]!.push(null); }, reason: "storedCorruption" },
    { mutate: malformedMarker, reason: "storedCorruption" },
    { mutate: (rows, index) => { rows[0]![index(["storagePresent"])] = false; }, reason: "storedCorruption" },
    { mutate: (rows, index) => {
      if (rows.length < 2) throw new Error("Expected genuine ownership history rows");
      rows[1]![index(["reason"])] = "accepted";
    }, reason: "storedCorruption" },
    { mutate: (rows, index) => {
      if (rows.length < 2) throw new Error("Expected genuine ownership history rows");
      rows[1]![index(["targetMetadataEpoch"])] = "changed";
    }, reason: "storedCorruption" },
    { mutate: (rows, index) => { malformedMarker(rows, index); rows[0]![index(["reason"])] = "expired"; }, reason: "expired" },
    { mutate: (rows, index) => { rows[0]![index(["reason"])] = "unknown refusal"; },
      reason: "storedCorruption", unreadHeader: "databaseNow" },
    { mutate: (rows, index) => { rows[0]![index(["reason"])] = "expired"; },
      reason: "expired", unreadHeader: "databaseNow" },
    { mutate: (rows, index) => { malformedMarker(rows, index); rows[0]![index(["databaseNow"])] = "corrupt time"; },
      reason: "storedCorruption", unreadHeader: "servingCommitSeq" },
    { mutate: (rows, index) => { malformedMarker(rows, index); rows[0]![index(["servingCommitSeq"])] = "corrupt sequence"; },
      reason: "storedCorruption", unreadHeader: "retainedFloor" },
    { mutate: (rows, index) => {
      rows[0]![index(["servingCommitSeq"])] = "1";
      rows[0]![index(["retainedFloor"])] = "2";
    }, reason: "storedCorruption", unreadHeader: "targetMetadataEpoch" },
    { mutate: (rows, index) => { rows[0]![index(["reason"])] = "expired"; },
      reason: "retired", retirement: true, unreadHeader: "databaseNow" },
    { mutate: () => undefined, reason: "defect", unreadHeader: "databaseNow", defect: true },
    { mutate: (rows, index) => { malformedMarker(rows, index); rows[0]![index(["reason"])] = "expired"; },
      reason: "retired", retirement: true },
    { mutate: (rows, index) => { malformedMarker(rows, index); rows[0]![index(["reason"])] = "attemptReplaced"; },
      reason: "storedCorruption", retirement: true, frontier: true },
    { mutate: (rows, index) => {
      malformedMarker(rows, index);
      rows[0]![index(["reason"])] = "expired";
      rows[0]![index(["frontier", "attemptFence"])] = "invalid native bigint";
    }, reason: "resourceFailure", native: true },
  ];
  for (const witness of cases) {
    let captures = 0;
    const laterHeaderDefect = new Error("Later finite capture header read");
    projection.observeCapture(args => {
      if (!args[2]?.startsWith("fx_finite_")) return;
      captures++;
      const fields = args[1];
      const mapper = args[4];
      if (fields === undefined || mapper === undefined) throw new Error("Missing genuine capture descriptor");
      args[4] = rows => {
        const changed = rows.map(row => [...row]);
        witness.mutate(changed, path => {
          const index = fields.findIndex(field => field.path.length === path.length && field.path.every((name, offset) => name === path[offset]));
          if (index < 0) throw new Error("Missing genuine capture field: " + path.join("."));
          return index;
        });
        const mapped: unknown = mapper(changed);
        if (witness.unreadHeader !== undefined) {
          if (mapped === null || typeof mapped !== "object") throw new Error("Missing mapped capture");
          const header: unknown = Reflect.get(mapped, "header");
          if (header === null || typeof header !== "object") throw new Error("Missing mapped capture header");
          Object.defineProperty(header, witness.unreadHeader, { get: () => { throw laterHeaderDefect; } });
        }
        return mapped;
      };
    });
    try {
      const operation = witness.retirement ? { kind: "retirement" as const, selector: capture.input.selector,
        executionClaim: capture.input.executionClaim } : capture.operation;
      const exit = await runEffect(Effect.exit(capture.owner.capture(capture.input, operation)));
      expect(captures).toBe(1);
      if (witness.defect) {
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) expect(exit.cause.reasons).toEqual([expect.objectContaining({ _tag: "Die", defect: laterHeaderDefect })]);
      } else if (witness.reason === "retired") expect(exit).toMatchObject({ _tag: "Success", value: { kind: "retirement", retired: true } });
      else {
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failures = exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
          expect(failures).toEqual([expect.objectContaining({ _tag: "FiniteStorageCaptureError", reason: witness.reason })]);
          if (witness.frontier) expect(failures[0]).toMatchObject({ cause: { _tag: "FiniteAttemptAnchorError" } });
          if (witness.native) expect(failures[0]).toMatchObject({ cause: expect.any(SyntaxError) });
        }
      }
    } finally { projection.observeCapture(undefined); }
  }
}

it("accepts retained ownership successor catalogs from the original separate control owner before allowing original unmanaged writes in PGlite", async () => {
  const projection = observeCaptureProjectionParity();
  const observed = observeGenuineOwnershipCapture(false);
  try {
    await finiteApplicationMetadataScenario(await createMigratedPGlitePersistence(undefined, "finiteCapture"), {
      ownershipSuccessor: true, observeOwnershipOperation: async (phase, work) => {
        await work();
        if (phase === "accepted") await verifyCaptureLayoutFailureOrder(observed.read(), projection);
      },
    });
    projection.verify();
  } finally { observed.restore(); projection.restore(); }
}, 240_000);
it.skipIf(postgresUrl === null)("accepts retained ownership successor catalogs from the original separate control owner before allowing original unmanaged writes in PostgreSQL", async () => {
  const projection = observeCaptureProjectionParity();
  const observed = observeGenuineOwnershipCapture(false);
  try {
    const fixture = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try { await finiteApplicationMetadataScenario(fixture.persistence, { ownershipSuccessor: true,
      observeOwnershipOperation: async (phase, work) => {
        await work();
        if (phase === "accepted") await verifyCaptureLayoutFailureOrder(observed.read(), projection);
      },
    }); projection.verify(); }
    finally { await fixture.dispose(); }
  } finally { observed.restore(); projection.restore(); }
}, 240_000);

it.skipIf(postgresUrl === null)("accepts retained ownership successor catalogs through the restricted installed control reader before allowing original unmanaged writes", async () => {
  const projection = observeCaptureProjectionParity();
  try {
    const targetOwner = await createFileScopedPostgresFixture();
    try {
      const controlOwner = await createFileScopedPostgresFixture();
      try {
        const dual = await createActivationServingFileScopedPostgresFixture(targetOwner, "finiteCapture");
        try {
          const target = dual.serving;
          const control = await createProtectedFileScopedPostgresFixture("managed", controlOwner);
          try {
            const pair = await createCoLocatedReadInstallationFixture({ target, control, controlOwner });
            const refs = Result.getOrThrow(getCoLocatedReadInstallationReferencesResult(pair.installation, target.persistence.drizzle));
            const controlProtection = await Effect.runPromise(prepareProtectedMetadata(target.persistence.drizzle, refs.controlInstallation));
            const activationTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(dual.activation.persistence,
              { kind: "database_per_scope", databaseKey: "finite_metadata_target", schemaName: target.schemaName },
              { directInstallation: dual.activation.installation });
            if (!isLocatedReadCommittedAttemptTargetV1(activationTarget)) throw new Error("Missing genuine activation runner");
            await finiteApplicationMetadataScenario(target.persistence, { ownershipSuccessor: true, controlPersistence: control.persistence,
              activationProfile: { kind: "installed", installation: dual.pair, target: activationTarget },
              sessionTargetOptions: { managedInstallation: { installation: pair.installation, controlProtection } } });
            projection.verify();
          } finally { await control.dispose(); }
        } finally { await dual.dispose(); }
      } finally { await controlOwner.dispose(); }
    } finally { await targetOwner.dispose(); }
  } finally { projection.restore(); }
}, 240_000);
