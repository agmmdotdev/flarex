import SystemTaxService from "@medusajs/tax/providers/system";

/** Workerd fixture fault after genuine Tax calculation, when the workflow has
 * already created a pending Shipping Method. The dedicated Address selects it. */
export function installStoreCartShippingTaxFailure() {
  const nativeTaxLines = SystemTaxService.prototype.getTaxLines;
  SystemTaxService.prototype.getTaxLines = async function (...args) {
    const result = await Reflect.apply(nativeTaxLines, this, args);
    if (args[1].length > 0 && args[2].address.city === "Workerd Shipping failure") {
      throw new Error("late-workerd-shipping-tax");
    }
    return result;
  };
}
