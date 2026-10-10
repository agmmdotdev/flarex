import {
  captureHostPreparationCharge,
  captureHostPreparationLifetime,
} from "../../execution/preparation/preparedHostRuntime";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../scope/scopeAuthorityResolution";
import { prepareApplicationActiveHeadStructure } from "../activeHead/identity";
import { prepareApplicationReadinessActivation } from "../readiness/activationTarget";
import {
  hasApplicationReadinessComposition,
  readApplicationReadinessControlDatabase,
  readApplicationReadinessTargetProtection,
} from "../readiness/identity";
import {
  prepareApplicationRelationReadinessActivation,
  withApplicationActivationCatalogLock,
} from "../relations/applicationRelationReadinessFold";
import {
  activateLegacyInTransaction,
  activateRelationInTransaction,
  tryReplayStoredActivation,
} from "./activationPersistence";
import {
  loadActiveRevisionHint,
  loadRevisionReadinessKindInTransaction,
  readActiveLegacyInTransaction,
  readActiveRelationInTransaction,
} from "./activeRead";
import {
  hasExactCompositeApplicationActivationComposition,
  loadReadyForActiveRead,
  loadRelationReadyForActiveRead,
  makeActivePreparationReader,
  makeCompositeBindingPreparationReader,
  makeLegacyBindingPreparationReader,
} from "./bindingPreparation";
import { captureCasToken } from "./capture";
import type {
  ApplicationActivationContext,
  ApplicationRelationActivationContext,
} from "./constructionContracts";
import type {
  ApplicationActivationRepository,
  ApplicationActiveCasToken,
  ApplicationRelationActivationRepository,
} from "./contracts";
import { runLocatedTransaction } from "./databaseBoundary";
import { activationFailure } from "./errors";
import { makeFiniteActivePreparationReader } from "./finitePreparation";
import { validIdentity } from "./limits";
import {
  registerApplicationActivationRepository,
  registerApplicationBindingPreparationReader,
  registerFiniteActivePreparationReader,
  registerStandaloneApplicationBindingPreparationReader,
} from "./repositoryIdentity";
import {
  issueLegacyActiveSelection,
  issueRelationActiveSelection,
  registerApplicationBindingHeadPreparation,
} from "./selectionIdentity";
import { makeLegacyStandaloneBindingPreparationReader } from "./standaloneBinding";
import { Effect, Result } from "effect";

export function makeApplicationActivationRepository<SchemaFailure, ColdFailure>(
  context: ApplicationRelationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationRelationActivationRepository<SchemaFailure, ColdFailure>;

export function makeApplicationActivationRepository<SchemaFailure, ColdFailure>(
  context: ApplicationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationActivationRepository<SchemaFailure, ColdFailure>;

export function makeApplicationActivationRepository<SchemaFailure, ColdFailure>(
  context:
    | ApplicationActivationContext<SchemaFailure, ColdFailure>
    | ApplicationRelationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationActivationRepository<SchemaFailure, ColdFailure> |
  ApplicationRelationActivationRepository<SchemaFailure, ColdFailure> {
  if ("relationReadiness" in context) {
    return makeCompositeApplicationActivationRepository(context);
  }
  return makeLegacyApplicationActivationRepository(context);
}

export function makeLegacyApplicationActivationRepository<SchemaFailure, ColdFailure>(
  context: ApplicationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationActivationRepository<SchemaFailure, ColdFailure> {
  const captured = Object.freeze({
    deploymentId: context.deploymentId,
    scopeId: context.scopeId,
    readiness: context.readiness,
    authority: context.authority,
    activation: context.activation.kind === "fullProof" ? Object.freeze({ kind: "fullProof" as const }) :
      Object.freeze({ kind: "installed" as const, installation: context.activation.installation, target: context.activation.target }),
    ...(context.faultAfter === undefined ? {} : { faultAfter: context.faultAfter }),
  });

  const activate = Effect.fn("ApplicationActivation.activate")(
    function* (input: {
      readonly revisionId: string;
      readonly expectedActiveHead: ApplicationActiveCasToken | null;
    }) {
      if (!validIdentity(captured.deploymentId) || !validIdentity(input.revisionId)) {
        return yield* activationFailure("activate", "invalidInput", input.revisionId);
      }
      const expected = yield* Effect.fromResult(
        captureCasToken(input.expectedActiveHead, "activate", input.revisionId),
      );
      if (!hasApplicationReadinessComposition(
        captured.readiness,
        captured.authority,
      )) {
        return yield* activationFailure(
          "activate",
          "invalidComposition",
          input.revisionId,
        );
      }
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        captured.authority,
      );
      const replay = yield* tryReplayStoredActivation(located.target, located.authority, input.revisionId, expected, "legacy");
      if (replay !== null) return replay;
      const readiness = yield* captured.readiness.settle(Object.freeze({
        deploymentId: captured.deploymentId,
        scopeId: captured.scopeId,
        revisionId: input.revisionId,
      }));
      if (readiness.status !== "ready") {
        return yield* activationFailure("activate", "notReady", input.revisionId);
      }
      const activation = yield* prepareApplicationReadinessActivation(captured.readiness, readiness,
        captured.activation, located.target);
      return yield* runLocatedTransaction(
        activation.target,
        "activate",
        input.revisionId,
        tx => activateLegacyInTransaction(
          tx,
          activation.target,
          located.authority,
          captured.readiness,
          readiness,
          expected,
          captured.faultAfter,
          activation.preparation,
        ),
      );
    },
  );

  const readActive = Effect.fn("ApplicationActivation.readActive")(
    function* () {
      if (!validIdentity(captured.deploymentId) ||
        !hasApplicationReadinessComposition(
          captured.readiness,
          captured.authority,
        )) return yield* activationFailure("read", "invalidComposition");
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        captured.authority,
      );
      const hint = yield* runLocatedTransaction(
        located.target,
        "read",
        undefined,
        tx => loadActiveRevisionHint(tx, located.authority.scopeId, "legacy"),
      );
      const readiness = yield* loadReadyForActiveRead(
        captured.readiness,
        captured.deploymentId,
        captured.scopeId,
        hint.revisionId,
      );
      const state = yield* runLocatedTransaction(
        located.target,
        "read",
        hint.revisionId,
        tx => readActiveLegacyInTransaction(
          tx,
          located.authority,
          captured.readiness,
          readiness,
        ),
      );
      const active = yield* issueLegacyActiveSelection(state, captured.readiness, readiness, yield* captureHostPreparationLifetime());
      const protection = readApplicationReadinessTargetProtection(captured.readiness, readiness);
      if (protection !== undefined) registerApplicationBindingHeadPreparation(active.selection,
        prepareApplicationActiveHeadStructure(protection, yield* captureHostPreparationCharge(), state.basis));
      return active;
    },
  );

  const repository = Object.freeze({ activate, readActive });
  registerApplicationActivationRepository(repository, Object.freeze({
    readinessKind: "legacy",
    readiness: captured.readiness,
    deploymentId: captured.deploymentId, scopeId: captured.scopeId,
    controlDatabase: Result.getOrElse(readApplicationReadinessControlDatabase(captured.readiness), () => undefined),
    authority: captured.authority,
  }));
  const prepare = makeActivePreparationReader(captured);
  registerFiniteActivePreparationReader(repository, makeFiniteActivePreparationReader(repository, captured, prepare));
  registerApplicationBindingPreparationReader(repository, makeLegacyBindingPreparationReader(captured, prepare));
  registerStandaloneApplicationBindingPreparationReader(repository, makeLegacyStandaloneBindingPreparationReader(captured));
  return repository;
}

export function makeCompositeApplicationActivationRepository<
  SchemaFailure,
  ColdFailure,
>(
  context: ApplicationRelationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationRelationActivationRepository<SchemaFailure, ColdFailure> {
  const captured = Object.freeze({
    deploymentId: context.deploymentId,
    scopeId: context.scopeId,
    readiness: context.readiness,
    relationReadiness: context.relationReadiness,
    authority: context.authority,
    activation: context.activation.kind === "fullProof" ? Object.freeze({ kind: "fullProof" as const }) :
      Object.freeze({ kind: "installed" as const, installation: context.activation.installation, target: context.activation.target }),
    ...(context.faultAfter === undefined
      ? {}
      : { faultAfter: context.faultAfter }),
  });
  const compositionIsExact = () => hasExactCompositeApplicationActivationComposition(captured);
  const activate: ApplicationRelationActivationRepository<
    SchemaFailure,
    ColdFailure
  >["activate"] = Effect.fn("ApplicationActivation.activateDispatched")(
    function* (input) {
      if (!validIdentity(captured.deploymentId) ||
        !validIdentity(input.revisionId)) {
        return yield* activationFailure(
          "activate",
          "invalidInput",
          input.revisionId,
        );
      }
      const expected = yield* Effect.fromResult(
        captureCasToken(input.expectedActiveHead, "activate", input.revisionId),
      );
      if (!compositionIsExact()) {
        return yield* activationFailure(
          "activate",
          "invalidComposition",
          input.revisionId,
        );
      }
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        captured.authority,
      );
      const replay = yield* tryReplayStoredActivation(located.target, located.authority, input.revisionId, expected);
      if (replay !== null) return replay;
      const readinessKind = yield* runLocatedTransaction(
        located.target,
        "activate",
        input.revisionId,
        tx => loadRevisionReadinessKindInTransaction(
          tx,
          located.authority,
          input.revisionId,
        ),
      );
      if (readinessKind === "legacy") {
        const readiness = yield* captured.readiness.settle(Object.freeze({
          deploymentId: captured.deploymentId,
          scopeId: captured.scopeId,
          revisionId: input.revisionId,
        }));
        if (readiness.status !== "ready") {
          return yield* activationFailure(
            "activate",
            "notReady",
            input.revisionId,
          );
        }
        const activation = yield* prepareApplicationReadinessActivation(captured.readiness, readiness,
          captured.activation, located.target);
        return yield* runLocatedTransaction(
          activation.target,
          "activate",
          input.revisionId,
          tx => activateLegacyInTransaction(
            tx,
            activation.target,
            located.authority,
            captured.readiness,
            readiness,
            expected,
            captured.faultAfter,
            activation.preparation,
          ),
        );
      }
      const readiness = yield* captured.relationReadiness.settle(Object.freeze({
        deploymentId: captured.deploymentId,
        scopeId: captured.scopeId,
        revisionId: input.revisionId,
      }));
      if (readiness.status !== "ready") {
        const racedReplay = yield* tryReplayStoredActivation(located.target, located.authority, input.revisionId, expected);
        if (racedReplay !== null) return racedReplay;
        return yield* activationFailure(
          "activate",
          "notReady",
          input.revisionId,
        );
      }
      const activation = yield* prepareApplicationRelationReadinessActivation(captured.relationReadiness, readiness,
        captured.activation, located.target);
      return yield* withApplicationActivationCatalogLock(captured.relationReadiness, readiness,
        catalogLease => runLocatedTransaction(
          activation.target,
          "activate",
          input.revisionId,
          tx => activateRelationInTransaction(
            tx,
            activation.target,
            located.authority,
            captured.relationReadiness,
            readiness,
            expected,
            captured.faultAfter,
            catalogLease,
            activation.preparation,
          ),
        ),
      );
    },
  );

  const readActive: ApplicationRelationActivationRepository<
    SchemaFailure,
    ColdFailure
  >["readActive"] = Effect.fn("ApplicationActivation.readActiveDispatched")(
    function* () {
      if (!validIdentity(captured.deploymentId) || !compositionIsExact()) {
        return yield* activationFailure("read", "invalidComposition");
      }
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        captured.authority,
      );
      const hint = yield* runLocatedTransaction(
        located.target,
        "read",
        undefined,
        tx => loadActiveRevisionHint(tx, located.authority.scopeId),
      );
      if (hint.readinessKind === "legacy") {
        const readiness = yield* loadReadyForActiveRead(
          captured.readiness,
          captured.deploymentId,
          captured.scopeId,
          hint.revisionId,
        );
        const state = yield* runLocatedTransaction(
          located.target,
          "read",
          hint.revisionId,
          tx => readActiveLegacyInTransaction(
            tx,
            located.authority,
            captured.readiness,
            readiness,
          ),
        );
        return yield* issueLegacyActiveSelection(state, captured.readiness, readiness, yield* captureHostPreparationLifetime());
      }
      const readiness = yield* loadRelationReadyForActiveRead(
        captured.relationReadiness,
        captured.deploymentId,
        captured.scopeId,
        hint.revisionId,
      );
      const state = yield* runLocatedTransaction(
        located.target,
        "read",
        hint.revisionId,
        tx => readActiveRelationInTransaction(
          tx,
          located.authority,
          captured.relationReadiness,
          readiness,
        ),
      );
      return yield* issueRelationActiveSelection(
        state,
        captured.relationReadiness,
        readiness,
      );
    },
  );

  const repository = Object.freeze({ activate, readActive });
  registerApplicationActivationRepository(repository, Object.freeze({
    readinessKind: "composite",
    readiness: captured,
    deploymentId: captured.deploymentId, scopeId: captured.scopeId,
    controlDatabase: Result.getOrElse(readApplicationReadinessControlDatabase(captured.readiness), () => undefined),
    authority: captured.authority,
  }));
  const prepareActive = makeActivePreparationReader(captured);
  registerApplicationBindingPreparationReader(repository, makeCompositeBindingPreparationReader(captured, prepareActive));
  registerStandaloneApplicationBindingPreparationReader(repository, makeLegacyStandaloneBindingPreparationReader(captured));
  return repository;
}