import { Cause, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { MedusaError } from "@medusajs/utils/common/errors";
import { MedusaError as FrameworkMedusaError } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { runProductRequestPromise } from "../src/http/product-request";

it.each([{ name: "utility", constructor: MedusaError }, { name: "framework", constructor: FrameworkMedusaError }])(
  "presents the actual $name native refusal and retains its complete rollback Cause", async ({ constructor }) => {
    const native = new constructor(MedusaError.Types.NOT_FOUND, "Missing native entity");
    const cause = Cause.combine(Cause.fail(commerceError("adapterFailure", native)), Cause.fail(commerceError("rollbackOnly")));
    await expect(runProductRequestPromise(Effect.failCause(cause))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND, message: native.message, cause,
    });
  },
);

it("preserves mixed, defective, interrupted and forged failures without native status projection", async () => {
  const native = new FrameworkMedusaError(MedusaError.Types.NOT_FOUND, "Missing native entity");
  const business = Cause.fail(commerceError("adapterFailure", native));
  const interrupted = await Effect.runPromiseExit(Effect.interrupt);
  if (Exit.isSuccess(interrupted)) throw new Error("Interruption completed successfully");
  const causes = [Cause.combine(business, Cause.fail(commerceError("resourceFailure"))),
    Cause.combine(business, Cause.fail(commerceError("adapterFailure", new FrameworkMedusaError(native.type, native.message)))),
    Cause.die(native), interrupted.cause,
    Cause.fail(commerceError("adapterFailure", { __isMedusaError: true, type: native.type, message: native.message }))];
  for (const cause of causes) {
    await expect(runProductRequestPromise(Effect.failCause(cause))).rejects.toMatchObject({ message: "Product request execution failed", cause });
  }
});
