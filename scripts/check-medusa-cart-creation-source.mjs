// @ts-check
import { createHash } from "node:crypto";
export const cartCreationAuthoredTargets = Object.freeze([
  "packages/medusa-cart/src/creation/contracts.ts", "packages/medusa-cart/src/creation/index.ts",
  "packages/medusa-cart/src/creation/models.ts", "packages/medusa-cart/src/creation/postgres.ts",
  "packages/medusa-cart/src/creation/presentation.ts", "packages/medusa-cart/src/creation/snapshot.ts",
  "packages/medusa-cart/src/creation/store.ts", "packages/medusa-types/src/cart/creation.ts",
]);

const imports = `import type { CartCreationResult, CartCreationHandle, CartCreationCompensation } from "@medusajs/types/cart/creation"
import type { CartCreationStore } from "../creation/store"
import { prepareCartCreationAddresses, cartCreationSnapshot } from "../creation/snapshot"
import { presentCartCreation } from "../creation/presentation"
`;
const methods = `  @InjectManager()
  @EmitEvents()
  async createCartsWithOwnership(
    data: CartTypes.CreateCartDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<CartCreationResult> {
    return await this.createCartsWithOwnership_(data, sharedContext)
  }

  @InjectTransactionManager()
  protected async createCartsWithOwnership_(
    data: CartTypes.CreateCartDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<CartCreationResult> {
    if (this.cartCreationStore_ === undefined) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cart creation ownership is not enabled")
    const plan = prepareCartCreationAddresses(data)
    const carts = await this.baseRepository_.serialize<CartTypes.CartDTO[]>(await this.createCarts_(data, sharedContext))
    if (carts.length === 0) return { carts }
    const receipt = await this.cartCreationStore_.record(cartCreationSnapshot(carts, plan), sharedContext)
    return { carts: presentCartCreation(carts), receipt }
  }

  @InjectManager()
  @EmitEvents()
  async compensateCartsCreation(
    receipt: CartCreationHandle,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<CartCreationCompensation> {
    return await this.compensateCartsCreation_(receipt, sharedContext)
  }

  @InjectTransactionManager()
  protected async compensateCartsCreation_(
    receipt: CartCreationHandle,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<CartCreationCompensation> {
    if (this.cartCreationStore_ === undefined) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cart creation ownership is not enabled")
    return await this.cartCreationStore_.compensate(receipt, sharedContext, {
      carts: (ids, context) => this.cartService_.delete(ids, context),
      addresses: (ids, context) => this.addressService_.delete(ids, context),
    })
  }

`;

/** Exact approved native extension; the existing guard still compares every
 * original method against the pinned program and total-selector extraction.
 * @param {string} original */
export function extendNativeCartCreationSource(original) {
  return original.replace('import { includeCartTotals } from "../utils/totals-selection"\n',
    'import { includeCartTotals } from "../utils/totals-selection"\n' + imports)
    .replace("protected readonly moduleDeclaration: InternalModuleDeclaration\n", "protected readonly moduleDeclaration: InternalModuleDeclaration,\n    protected readonly cartCreationStore_?: CartCreationStore\n")
    .replace("  // @ts-expect-error\n  async updateCarts(", methods + "  // @ts-expect-error\n  async updateCarts(");
}


export const cartCreationStepSourcePair = Object.freeze({ source: "third_party/medusa/upstream/packages/core/core-flows/src/cart/steps/create-carts.ts", target: "packages/medusa-core-flows/src/cart/steps/create-carts.ts", classification: "workflowFork" });
/** Exact native ownership-capability correction; default Cart IDs alone do
 * not grant the new generation-authenticated inverse. No adjacent step gains
 * fork permission. @param {string} source @param {string} target */
export function verifyCartCreationStepSource(source, target) {
  const digest = /** @param {string} text */ text => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
  if (digest(source) !== "bebe7a7e8986213786d9dbe02f9a64aad3c5c1cb603937486f45c5e27d3c5a04" || digest(target) !== "737ccebc877c1ad5e1e42b1b7dbaeea43c76d294cb4e471c3424d2a89ac97202") throw new Error("Changed native Cart creation step source");
}
