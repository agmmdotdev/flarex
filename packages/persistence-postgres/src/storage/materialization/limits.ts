import {
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
} from "flarex-protocol/commit-protocol";

export const MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1 = 256;

/**
 * The unique owner applies bounded statement batches in the borrowed transaction.
 * Allow one constraint transition per material row at the core row ceiling;
 * additional constraints consume the same aggregate budget. A transition may
 * release one previous claim and acquire one replacement claim.
 */
export const MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1 = MAX_POINT_COMMIT_MATERIAL_ROWS_V1;

export const MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1 = 2 * MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1;
