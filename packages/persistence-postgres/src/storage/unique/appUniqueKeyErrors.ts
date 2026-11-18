import type { AppUniqueConstraintIdV1 } from "./appUniqueKeyContract";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";

export class AppUniqueKeyConflictError extends Error {
  readonly _tag = "AppUniqueKeyConflictError" as const;

  constructor(
    readonly constraintId: AppUniqueConstraintIdV1,
    readonly localeKey: string,
    readonly ownerTableId: CatalogTableId,
    readonly ownerRowId: AppRowIdHexV1,
  ) {
    super(
      `App unique key is already owned by ${ownerTableId}/${ownerRowId} ` +
        `for constraint ${constraintId}/${localeKey || "<default>"}.`,
    );
    this.name = "AppUniqueKeyConflictError";
  }
}

export class CanonicalAppUniqueKeyHashCollisionError extends Error {
  readonly _tag = "CanonicalAppUniqueKeyHashCollisionError" as const;

  constructor(
    readonly constraintId: AppUniqueConstraintIdV1,
    readonly localeKey: string,
  ) {
    super(
      `Canonical app unique keys have equal SHA-256 but unequal bytes for ` +
        `${constraintId}/${localeKey || "<default>"}.`,
    );
    this.name = "CanonicalAppUniqueKeyHashCollisionError";
  }
}

export class AppUniqueKeyHashError extends Error {
  readonly _tag = "AppUniqueKeyHashError" as const;

  constructor(readonly cause: unknown) {
    super("App unique-key SHA-256 failed.", { cause });
    this.name = "AppUniqueKeyHashError";
  }
}

export class AppUniqueKeyPersistenceError extends Error {
  readonly _tag = "AppUniqueKeyPersistenceError" as const;

  constructor(readonly cause: unknown) {
    super("App unique-key persistence operation failed.", { cause });
    this.name = "AppUniqueKeyPersistenceError";
  }
}
