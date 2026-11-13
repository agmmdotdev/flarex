import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import type { CoreDatabase, CoreNativeBindingMetadata } from "../../persistence-postgres/src/core/api";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { CommerceTransactionError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { commerceNativeRegistrations, makeCommerceNativeHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/nativeHost";
import { commerceNativeInitializationCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/nativeInitialization";
import { createCoreProductFixture } from "./support/core-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid native Product membership witness driver");

describe("native Product host selected-command membership", () => {
  it("requires exact selected modes and refreshes a warmed host's authority", async () => {
    const fixture = await createCoreProductFixture(driver);
    try {
      await fixture.run(fixture.useGeneration(({ database, hostRuntime }) => Effect.gen(function* () {
        let callbacks = 0, bindingReads = 0;
        const probe = defineCommerceCommand("membershipProbe", "read", () => Effect.sync(() => { callbacks++; return null; }));
        const extra = defineCommerceCommand("membershipExtra", "read", () => Effect.succeed(null));
        const registrations = yield* Effect.fromResult(commerceNativeRegistrations([probe, extra]));
        const binding = yield* database.bindNative({ definition: fixture.definition, commands: registrations });
        let project = (metadata: CoreNativeBindingMetadata): CoreNativeBindingMetadata => metadata;
        // Delegate every read to the real binding owner before projecting only
        // the command subset consumed by the host's membership predicate.
        const observed: CoreDatabase = { ...database, readNativeBinding: selected => database.readNativeBinding(selected).pipe(
          Effect.map(metadata => { bindingReads++; return project(metadata); })) };
        const open = () => makeCommerceNativeHost({ database: observed, binding, hostRuntime, commands: [probe],
          initialization: fixture.initialization, identityAndAccessPolicy: { profile: "membership-probe" } });
        const refused = (work: Effect.Effect<unknown, CommerceTransactionError>) => Effect.gen(function* () {
          const outcome = yield* Effect.result(work);
          expect(Result.isFailure(outcome)).toBe(true);
          if (Result.isFailure(outcome)) {
            expect(outcome.failure).toBeInstanceOf(CommerceTransactionError);
            expect(outcome.failure.reason).toBe("invalidAuthority");
          }
        });
        const withoutProbe = (metadata: CoreNativeBindingMetadata) => ({ ...metadata,
          commands: metadata.commands.filter(command => command.name !== "membershipProbe") });
        const wrongMode = (metadata: CoreNativeBindingMetadata) => ({ ...metadata,
          commands: metadata.commands.map(command => command.name === "membershipProbe" ? { ...command,
            mode: "write" as const, identity: { ...command.identity, mode: "write" as const } } : command) });

        // Extra authorized commands are valid: the host requires a subset.
        yield* Effect.acquireUseRelease(open(), host => Effect.gen(function* () {
          yield* host.read(probe, null);
          expect(callbacks).toBe(1);
          for (const projection of [withoutProbe, wrongMode]) {
            project = projection;
            const before = bindingReads;
            yield* refused(host.read(probe, null));
            expect(bindingReads).toBeGreaterThan(before);
            expect(callbacks).toBe(1);
          }
        }), host => host.close);

        for (const projection of [withoutProbe, wrongMode, (metadata: CoreNativeBindingMetadata) => ({ ...metadata,
          commands: metadata.commands.filter(command => command.name !== commerceNativeInitializationCommand.name) })]) {
          project = projection;
          yield* refused(open());
        }
        // An opposite-mode duplicate must not erase a matching pair in either
        // order. This is a host predicate witness, not core command admission.
        for (const oppositeFirst of [true, false]) {
          project = metadata => ({ ...metadata, commands: metadata.commands.flatMap(command => {
            if (command.name !== "membershipProbe") return [command];
            const opposite = { ...command, mode: "write" as const, identity: { ...command.identity, mode: "write" as const } };
            return oppositeFirst ? [opposite, command] : [command, opposite];
          }) });
          yield* Effect.acquireUseRelease(open(), () => Effect.void, host => host.close);
        }
      })));
    } finally { await fixture.close(); }
  }, 180_000);
});
