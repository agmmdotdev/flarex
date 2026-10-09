import type {
  AppRowTransaction,
} from "../documents/appRows";
import type {
  LocatedAppIndexDefinitionV1,
} from "../indexes/appIndexDefinitions";
import type {
  ApplicationDocumentMaterializationClock,
} from "./model";
import {
  exactScopeWriteClockObservationIdentity,
} from "../../scope/scopeClock";
import {
  Result,
} from "effect";
import {
  corruption,
} from "../../commit/point/errors";

const originalBuildLocksBrand: unique symbol = Symbol("OriginalApplicationPublicationBuildLocks");

export interface OriginalApplicationPublicationBuildLocks { readonly [originalBuildLocksBrand]: true }

interface OriginalPublicationBuildLockState {
  readonly tx: AppRowTransaction;
  readonly clockIdentity: symbol;
  readonly intrinsic: Set<LocatedAppIndexDefinitionV1>;
  readonly developer: Set<LocatedAppIndexDefinitionV1>;
}

const originalPublicationBuildLocks = new WeakMap<AppRowTransaction,OriginalPublicationBuildLockState>();

const originalPublicationBuildLockHandles = new WeakMap<OriginalApplicationPublicationBuildLocks,OriginalPublicationBuildLockState>();

export function recordOriginalPublicationBuildLocks(tx:AppRowTransaction,clock:ApplicationDocumentMaterializationClock,
  family:"intrinsic"|"developer",definitions:readonly LocatedAppIndexDefinitionV1[]) {
  const clockIdentity=exactScopeWriteClockObservationIdentity(tx,clock.record.scopeId);
  if (clockIdentity===undefined) return;
  const previous=originalPublicationBuildLocks.get(tx);
  const state=previous?.clockIdentity===clockIdentity ? previous : {tx,clockIdentity,intrinsic:new Set<LocatedAppIndexDefinitionV1>(),developer:new Set<LocatedAppIndexDefinitionV1>()};
  for (const definition of definitions) state[family].add(definition);
  originalPublicationBuildLocks.set(tx,state);
}

export function captureOriginalApplicationPublicationBuildLocks(tx:AppRowTransaction,clock:ApplicationDocumentMaterializationClock,
  intrinsic:readonly LocatedAppIndexDefinitionV1[],developer:readonly LocatedAppIndexDefinitionV1[]) {
  const state=originalPublicationBuildLocks.get(tx);
  if (state===undefined || state.clockIdentity!==exactScopeWriteClockObservationIdentity(tx,clock.record.scopeId) ||
    intrinsic.some(definition=>!state.intrinsic.has(definition)) || developer.some(definition=>!state.developer.has(definition)))
    return Result.fail(corruption("developerIndexBuildInvalid"));
  const handle=Object.freeze({[originalBuildLocksBrand]:true as const});
  originalPublicationBuildLockHandles.set(handle,state);
  return Result.succeed(handle);
}

export function acceptOriginalApplicationPublicationBuildLocks(tx:AppRowTransaction,clock:ApplicationDocumentMaterializationClock,
  handle:OriginalApplicationPublicationBuildLocks,intrinsic:readonly LocatedAppIndexDefinitionV1[],developer:readonly LocatedAppIndexDefinitionV1[]) {
  const state=originalPublicationBuildLockHandles.get(handle);
  return state?.tx===tx && state.clockIdentity===exactScopeWriteClockObservationIdentity(tx,clock.record.scopeId) &&
    intrinsic.every(definition=>state.intrinsic.has(definition)) && developer.every(definition=>state.developer.has(definition))
    ? Result.succeed(undefined) : Result.fail(corruption("developerIndexBuildInvalid"));
}
