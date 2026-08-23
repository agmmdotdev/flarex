import type {
  CanonicalRelationDeclarationV1,
} from "flarex-protocol/internal/relation-declaration-v1";

/**
 * Owned, canonical relation declarations ready to be embedded in the one
 * executable Standard Application schema module.
 *
 * These values remain inert definition evidence. They are not analyzed
 * relation ordinals, stable catalog identities, or physical edge bindings.
 */
export interface PreparedStandardApplicationRelations {
  readonly declarations: ReadonlyArray<CanonicalRelationDeclarationV1>;
}
