/** Explicit application activation boundary. */
export type {
  ApplicationActiveSelection,
  ApplicationActiveSelectionBasis,
  CoherentActiveApplication,
  CoherentActiveRelationApplication,
  ApplicationActivationRepository,
  ApplicationRelationActivationRepository,
} from "./activation/contracts";

export {
  ApplicationActivationError,
} from "./activation/errors";

export {
  claimApplicationActiveSelection,
} from "./activation/selectionIdentity";
