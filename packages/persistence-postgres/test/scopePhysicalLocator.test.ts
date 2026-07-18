import { describe, expect, it } from "vitest";

import type {
  ScopePhysicalLocator,
  SharedDatabaseScopePhysicalLocator,
  SplitScopePhysicalLocator,
} from "../src/scopeMetadataTypes";
import {
  captureScopePhysicalLocator,
  scopePhysicalLocatorsEqual,
} from "../src/scopePhysicalLocator";
import {
  captureSharedScopePhysicalLocator,
  UnsupportedScopeAuthorityProvisioningTopologyError,
} from "../src/scopeAuthorityProvisioning";
import {
  captureSplitScopePhysicalLocator,
  UnsupportedSplitScopeAuthorityProvisioningTopologyError,
} from "../src/scopeAuthorityProvisioningReceipt";

const sharedLocator = {
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "flarex_shared",
} satisfies ScopePhysicalLocator;

describe("scope physical locators", () => {
  it("captures every locator kind as an owned frozen snapshot", () => {
    const locators = [
      sharedLocator,
      {
        kind: "schema_per_scope",
        databaseKey: "primary",
        schemaName: "flarex_scope_a",
      },
      {
        kind: "database_per_scope",
        databaseKey: "scope-a",
        schemaName: "flarex_app",
      },
    ] satisfies ReadonlyArray<ScopePhysicalLocator>;

    for (const locator of locators) {
      const captured = captureScopePhysicalLocator(locator);
      expect(captured).toEqual(locator);
      expect(captured).not.toBe(locator);
      expect(Object.isFrozen(captured)).toBe(true);
    }
  });

  it("preserves the shared-locator subtype and detaches caller mutation", () => {
    const kind: SharedDatabaseScopePhysicalLocator["kind"] = "shared_database";
    const locator = {
      kind,
      databaseKey: "primary",
      schemaName: "flarex_shared",
      transient: "not persisted",
    };
    const captured = captureScopePhysicalLocator(locator);

    locator.databaseKey = "changed";

    expect(captured).toEqual(sharedLocator);
    expect(Object.keys(captured)).toEqual([
      "kind",
      "databaseKey",
      "schemaName",
    ]);
  });

  it("reads a generic locator discriminant only once", () => {
    let kindReads = 0;
    const unstableLocator = changingKindLocator(
      sharedLocator,
      "database_per_scope",
      () => {
        kindReads += 1;
        return kindReads;
      },
    );

    expect(captureScopePhysicalLocator(unstableLocator)).toEqual(sharedLocator);
    expect(kindReads).toBe(1);
  });

  it("validates and captures shared and split discriminants from one read", () => {
    const splitLocator = {
      kind: "schema_per_scope",
      databaseKey: "primary",
      schemaName: "flarex_scope_a",
    } satisfies SplitScopePhysicalLocator;
    let sharedKindReads = 0;
    let splitKindReads = 0;
    const unstableShared = changingKindLocator(
      sharedLocator,
      "database_per_scope",
      () => {
        sharedKindReads += 1;
        return sharedKindReads;
      },
    );
    const unstableSplit = changingKindLocator(
      splitLocator,
      "shared_database",
      () => {
        splitKindReads += 1;
        return splitKindReads;
      },
    );

    expect(captureSharedScopePhysicalLocator(unstableShared)).toEqual(
      sharedLocator,
    );
    expect(captureSplitScopePhysicalLocator(unstableSplit)).toEqual(
      splitLocator,
    );
    expect(sharedKindReads).toBe(1);
    expect(splitKindReads).toBe(1);
  });

  it("maps symbolic runtime discriminants to typed topology errors", () => {
    const symbolicKind = Symbol("unsupported");
    const invalidShared = locatorWithRuntimeKind(sharedLocator, symbolicKind);
    const splitLocator = {
      kind: "schema_per_scope",
      databaseKey: "primary",
      schemaName: "flarex_scope_a",
    } satisfies SplitScopePhysicalLocator;
    const invalidSplit = locatorWithRuntimeKind(splitLocator, symbolicKind);

    expect(() => captureSharedScopePhysicalLocator(invalidShared)).toThrowError(
      UnsupportedScopeAuthorityProvisioningTopologyError,
    );
    expect(() => captureSharedScopePhysicalLocator(invalidShared)).toThrow(
      "Symbol(unsupported)",
    );
    expect(() => captureSplitScopePhysicalLocator(invalidSplit)).toThrowError(
      UnsupportedSplitScopeAuthorityProvisioningTopologyError,
    );
    expect(() => captureSplitScopePhysicalLocator(invalidSplit)).toThrow(
      "Symbol(unsupported)",
    );
  });

  it("compares locator values rather than object identity", () => {
    expect(
      scopePhysicalLocatorsEqual(sharedLocator, { ...sharedLocator }),
    ).toBe(true);
  });

  it("compares every persisted locator identity field", () => {
    const differentLocators = [
      { ...sharedLocator, kind: "schema_per_scope" },
      { ...sharedLocator, databaseKey: "secondary" },
      { ...sharedLocator, schemaName: "flarex_other" },
    ] satisfies ReadonlyArray<ScopePhysicalLocator>;

    for (const locator of differentLocators) {
      expect(scopePhysicalLocatorsEqual(sharedLocator, locator)).toBe(false);
    }
  });
});

function changingKindLocator<Locator extends ScopePhysicalLocator>(
  locator: Locator,
  laterKind: ScopePhysicalLocator["kind"],
  nextRead: () => number,
): Locator {
  return new Proxy(locator, {
    get(target, property, receiver) {
      if (property === "kind" && nextRead() > 1) return laterKind;
      return Reflect.get(target, property, receiver);
    },
  });
}

function locatorWithRuntimeKind<Locator extends ScopePhysicalLocator>(
  locator: Locator,
  kind: unknown,
): Locator {
  return new Proxy(locator, {
    get(target, property, receiver) {
      return property === "kind"
        ? kind
        : Reflect.get(target, property, receiver);
    },
  });
}
