import { Schema } from "effect";
import { ApiKeyId, ApiKeyIds } from "./contracts";

/** The lifecycle profile selects an explicit bounded identity cohort. Native
 * internal revocation and deletion queries add their own type/time predicates. */
export const ApiKeySelector = Schema.Struct({ id: Schema.Union([ApiKeyId, ApiKeyIds]) });
export const ApiKeyTitleUpdate = Schema.Struct({ title: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))) });
export const ApiKeyUpdateInput = Schema.Struct({ selector: ApiKeySelector, update: ApiKeyTitleUpdate });
export const ApiKeyRevokeData = Schema.Struct({
  revoked_by: Schema.String.check(Schema.isMaxLength(256)),
  revoke_in: Schema.optionalKey(Schema.Number.check(Schema.isFinite())),
});
export const ApiKeyRevokeInput = Schema.Struct({ selector: ApiKeySelector, revoke: ApiKeyRevokeData });
export const ApiKeyRetainedTitles = Schema.Array(Schema.Struct({ id: ApiKeyId,
  title: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))) })).check(Schema.isMaxLength(4));
export const ApiKeyPreimageConfig = Schema.Struct({
  select: Schema.Array(Schema.Literals(["id", "title"])).pipe(Schema.mutable).check(Schema.isMaxLength(2)),
  relations: Schema.Array(Schema.Never).pipe(Schema.mutable),
});
export const ApiKeyPreimageInput = Schema.Struct({ filters: ApiKeySelector, config: ApiKeyPreimageConfig });
