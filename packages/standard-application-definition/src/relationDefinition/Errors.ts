import { Data } from "effect";
import type {
  RelationDeclarationV1Error,
} from "flarex-protocol/internal/relation-declaration-v1";

export class StandardApplicationRelationDefinitionError
  extends Data.TaggedError("StandardApplicationRelationDefinitionError")<{
    readonly operation: "prepare";
    readonly reason: "duplicateDeclaration";
    readonly path: string;
    readonly conflictsWithPath: string;
  }> {}

export type PrepareStandardApplicationRelationsError =
  | RelationDeclarationV1Error
  | StandardApplicationRelationDefinitionError;
