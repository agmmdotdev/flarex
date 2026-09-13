import { Effect } from "effect";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import type { TrustedScopeAuthority } from "../../scopeAuthorityResolution";
import type { FrameworkSchemaTarget } from "../target";
import type {
  DataBindingSetFrame,
  DataBindingHeadToken,
  InstallationBindingReference,
} from "./model";
import { bindingError, type DataBindingError } from "./errors";

declare const selectionBrand: unique symbol;
declare const syntheticBrand: unique symbol;
export interface AdmittedDataBinding {
  readonly [selectionBrand]: true;
}
export interface SyntheticTestSelection {
  readonly [syntheticBrand]: true;
}
interface SelectionState {
  readonly transaction: FlarexMetadataTransaction;
  readonly target: FrameworkSchemaTarget;
  readonly authority: TrustedScopeAuthority;
  readonly value: Readonly<{
    frame: DataBindingSetFrame;
    head: DataBindingHeadToken;
  }>;
  active: boolean;
}
interface SyntheticState {
  readonly transaction: FlarexMetadataTransaction;
  readonly target: FrameworkSchemaTarget;
  readonly authority: TrustedScopeAuthority;
  readonly reference: InstallationBindingReference;
  active: boolean;
}
const selections = new WeakMap<object, SelectionState>();
const syntheticSelections = new WeakMap<object, SyntheticState>();

/** Private issuer called only after accepting-transaction validation. No database escapes. */
export const withAdmittedDataBinding = Effect.fn(
  "DataBindingSelection.withAdmitted",
)(function* <Value, Failure>(
  transaction: FlarexMetadataTransaction,
  target: FrameworkSchemaTarget,
  authority: TrustedScopeAuthority,
  frame: DataBindingSetFrame,
  head: DataBindingHeadToken,
  work: (selection: AdmittedDataBinding) => Effect.Effect<Value, Failure>,
) {
  // SAFETY: the empty token is authenticated solely by this module's WeakMap.
  const selection = Object.freeze({}) as AdmittedDataBinding;
  const state: SelectionState = {
    transaction,
    target,
    authority,
    value: Object.freeze({ frame, head }),
    active: true,
  };
  selections.set(selection, state);
  return yield* Effect.suspend(() => work(selection)).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        state.active = false;
        selections.delete(selection);
      }),
    ),
  );
});
export const readAdmittedDataBinding = Effect.fn("DataBindingSelection.read")(
  function* (
    selection: AdmittedDataBinding,
  ): Effect.fn.Return<SelectionState["value"], DataBindingError> {
    const state = selections.get(selection);
    return state?.active
      ? state.value
      : yield* Effect.fail(bindingError("invalidAuthority"));
  },
);
export const claimAdmittedDataBindingInTransaction = Effect.fn(
  "DataBindingSelection.claimInTransaction",
)(function* (
  selection: AdmittedDataBinding,
  transaction: FlarexMetadataTransaction,
  target: FrameworkSchemaTarget,
) {
  const state = selections.get(selection);
  if (
    state?.active !== true ||
    state.transaction !== transaction ||
    state.target !== target
  )
    return yield* Effect.fail(bindingError("invalidAuthority"));
  return state.value;
});
export const withSyntheticTestSelection = Effect.fn(
  "DataBindingSelection.withSyntheticTest",
)(function* <Value, Failure>(
  transaction: FlarexMetadataTransaction,
  target: FrameworkSchemaTarget,
  authority: TrustedScopeAuthority,
  reference: InstallationBindingReference,
  work: (selection: SyntheticTestSelection) => Effect.Effect<Value, Failure>,
) {
  // SAFETY: a separate WeakMap prevents synthetic authority from satisfying serving admission.
  const selection = Object.freeze({}) as SyntheticTestSelection;
  const state: SyntheticState = {
    transaction,
    target,
    authority,
    reference,
    active: true,
  };
  syntheticSelections.set(selection, state);
  return yield* Effect.suspend(() => work(selection)).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        state.active = false;
        syntheticSelections.delete(selection);
      }),
    ),
  );
});
export const claimSyntheticTestSelectionInTransaction = Effect.fn(
  "DataBindingSelection.claimSyntheticTest",
)(function* (
  selection: SyntheticTestSelection,
  transaction: FlarexMetadataTransaction,
  target: FrameworkSchemaTarget,
) {
  const state = syntheticSelections.get(selection);
  if (
    state?.active !== true ||
    state.transaction !== transaction ||
    state.target !== target
  )
    return yield* Effect.fail(bindingError("invalidAuthority"));
  return Object.freeze({
    reference: state.reference,
    authority: state.authority,
  });
});
export const readSyntheticTestSelection = Effect.fn(
  "DataBindingSelection.readSyntheticTest",
)(function* (selection: SyntheticTestSelection) {
  const state = syntheticSelections.get(selection);
  if (state?.active !== true)
    return yield* Effect.fail(bindingError("invalidAuthority"));
  return Object.freeze({
    reference: state.reference,
    authority: state.authority,
  });
});
