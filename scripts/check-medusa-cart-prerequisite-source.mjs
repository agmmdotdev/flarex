// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";

const failure = "Changed native Cart prerequisite source";
const nativePrefix = "third_party/medusa/upstream/";

export const customerSelectionSourcePairs = Object.freeze([
  { source: nativePrefix + "packages/core/core-flows/src/cart/steps/find-or-create-customer.ts",
    target: "packages/medusa-core-flows/src/cart/steps/find-or-create-customer.ts", classification: "customerSelectionFork" },
  { source: nativePrefix + "packages/core/utils/src/common/is-email.ts",
    target: "packages/medusa-utils/src/common/is-email.ts", classification: "unchanged" },
  { source: nativePrefix + "packages/core/utils/src/common/__tests__/is-email.spec.ts",
    target: "packages/medusa-utils/src/common/__tests__/is-email.spec.ts", classification: "testPort" },
].map(pair => Object.freeze(pair)));

export const workflowCacheSourcePairs = Object.freeze([
  { source: nativePrefix + "packages/core/utils/src/caching/index.ts", target: "packages/medusa-utils/src/caching/index.ts", classification: "workflowCacheFork" },
  { source: nativePrefix + "packages/core/utils/src/feature-flags/flag-router.ts", target: "packages/medusa-utils/src/feature-flags/flag-router.ts", classification: "workflowCacheFork" },
  ...["common", "index"].map(name => ({ source: nativePrefix + `packages/core/types/src/feature-flag/${name}.ts`,
    target: `packages/medusa-types/src/feature-flag/${name}.ts`, classification: "unchanged" })),
].map(pair => Object.freeze(pair)));

/** Exact source preparation closure. Promotion admits models and pure calculators;
 * its ORM service, prefilter and service metadata are deliberately absent. */
export const cartPrerequisiteSourcePairs = Object.freeze([
  ...customerSelectionSourcePairs,
  ...workflowCacheSourcePairs,
  {
    "source": "third_party/medusa/upstream/LICENSE",
    "target": "packages/medusa-cart/LICENSE",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/LICENSE",
    "target": "packages/medusa-customer/LICENSE",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/address.ts",
    "target": "packages/medusa-cart/src/models/address.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/cart.ts",
    "target": "packages/medusa-cart/src/models/cart.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/credit-line.ts",
    "target": "packages/medusa-cart/src/models/credit-line.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/index.ts",
    "target": "packages/medusa-cart/src/models/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/line-item-adjustment.ts",
    "target": "packages/medusa-cart/src/models/line-item-adjustment.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/line-item-tax-line.ts",
    "target": "packages/medusa-cart/src/models/line-item-tax-line.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/line-item.ts",
    "target": "packages/medusa-cart/src/models/line-item.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/shipping-method-adjustment.ts",
    "target": "packages/medusa-cart/src/models/shipping-method-adjustment.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/shipping-method-tax-line.ts",
    "target": "packages/medusa-cart/src/models/shipping-method-tax-line.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/models/shipping-method.ts",
    "target": "packages/medusa-cart/src/models/shipping-method.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/services/index.ts",
    "target": "packages/medusa-cart/src/services/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/services/cart-module.ts",
    "target": "packages/medusa-cart/src/services/cart-module.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/static-manifest.ts",
    "target": "packages/medusa-cart/src/static-manifest.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/address.ts",
    "target": "packages/medusa-cart/src/types/address.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/cart.ts",
    "target": "packages/medusa-cart/src/types/cart.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/index.ts",
    "target": "packages/medusa-cart/src/types/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/line-item-adjustment.ts",
    "target": "packages/medusa-cart/src/types/line-item-adjustment.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/line-item-tax-line.ts",
    "target": "packages/medusa-cart/src/types/line-item-tax-line.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/line-item.ts",
    "target": "packages/medusa-cart/src/types/line-item.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/shipping-method-adjustment.ts",
    "target": "packages/medusa-cart/src/types/shipping-method-adjustment.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/shipping-method-tax-line.ts",
    "target": "packages/medusa-cart/src/types/shipping-method-tax-line.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/shipping-method.ts",
    "target": "packages/medusa-cart/src/types/shipping-method.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/cart/src/types/tax-line.ts",
    "target": "packages/medusa-cart/src/types/tax-line.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/customer/src/models/address.ts",
    "target": "packages/medusa-customer/src/models/address.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/customer/src/models/customer-group-customer.ts",
    "target": "packages/medusa-customer/src/models/customer-group-customer.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/customer/src/models/customer-group.ts",
    "target": "packages/medusa-customer/src/models/customer-group.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/customer/src/models/customer.ts",
    "target": "packages/medusa-customer/src/models/customer.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/customer/src/models/index.ts",
    "target": "packages/medusa-customer/src/models/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/customer/src/services/index.ts",
    "target": "packages/medusa-customer/src/services/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/customer/src/services/customer-module.ts",
    "target": "packages/medusa-customer/src/services/customer-module.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/customer/src/static-manifest.ts",
    "target": "packages/medusa-customer/src/static-manifest.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/customer/src/joiner-config.ts",
    "target": "packages/medusa-customer/src/joiner-config.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/models/index.ts",
    "target": "packages/medusa-tax/src/models/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/models/tax-provider.ts",
    "target": "packages/medusa-tax/src/models/tax-provider.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/models/tax-rate-rule.ts",
    "target": "packages/medusa-tax/src/models/tax-rate-rule.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/models/tax-rate.ts",
    "target": "packages/medusa-tax/src/models/tax-rate.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/models/tax-region.ts",
    "target": "packages/medusa-tax/src/models/tax-region.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/providers/system.ts",
    "target": "packages/medusa-tax/src/providers/system.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/services/index.ts",
    "target": "packages/medusa-tax/src/services/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/services/tax-module-service.ts",
    "target": "packages/medusa-tax/src/services/tax-module-service.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/services/tax-provider.ts",
    "target": "packages/medusa-tax/src/services/tax-provider.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/tax/src/static-manifest.ts",
    "target": "packages/medusa-tax/src/static-manifest.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/LICENSE",
    "target": "packages/medusa-tax/LICENSE",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/joiner-config.ts",
    "target": "packages/medusa-payment/src/joiner-config.ts",
    "classification": "paymentJoinerFork"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/models/account-holder.ts",
    "target": "packages/medusa-payment/src/models/account-holder.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/models/capture.ts",
    "target": "packages/medusa-payment/src/models/capture.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/models/index.ts",
    "target": "packages/medusa-payment/src/models/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/models/payment-collection.ts",
    "target": "packages/medusa-payment/src/models/payment-collection.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/models/payment-provider.ts",
    "target": "packages/medusa-payment/src/models/payment-provider.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/models/payment-session.ts",
    "target": "packages/medusa-payment/src/models/payment-session.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/models/payment.ts",
    "target": "packages/medusa-payment/src/models/payment.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/models/refund-reason.ts",
    "target": "packages/medusa-payment/src/models/refund-reason.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/models/refund.ts",
    "target": "packages/medusa-payment/src/models/refund.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/providers/system.ts",
    "target": "packages/medusa-payment/src/providers/system.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/services/index.ts",
    "target": "packages/medusa-payment/src/services/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/services/payment-module.ts",
    "target": "packages/medusa-payment/src/services/payment-module.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/services/payment-provider.ts",
    "target": "packages/medusa-payment/src/services/payment-provider.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/static-manifest.ts",
    "target": "packages/medusa-payment/src/static-manifest.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/payment/src/types/index.ts",
    "target": "packages/medusa-payment/src/types/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/LICENSE",
    "target": "packages/medusa-payment/LICENSE",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/models/application-method.ts",
    "target": "packages/medusa-promotion/src/models/application-method.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/models/campaign-budget-usage.ts",
    "target": "packages/medusa-promotion/src/models/campaign-budget-usage.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/models/campaign-budget.ts",
    "target": "packages/medusa-promotion/src/models/campaign-budget.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/models/campaign.ts",
    "target": "packages/medusa-promotion/src/models/campaign.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/models/index.ts",
    "target": "packages/medusa-promotion/src/models/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/models/promotion-rule-value.ts",
    "target": "packages/medusa-promotion/src/models/promotion-rule-value.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/models/promotion-rule.ts",
    "target": "packages/medusa-promotion/src/models/promotion-rule.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/models/promotion.ts",
    "target": "packages/medusa-promotion/src/models/promotion.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/types/application-method.ts",
    "target": "packages/medusa-promotion/src/types/application-method.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/types/campaign-budget.ts",
    "target": "packages/medusa-promotion/src/types/campaign-budget.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/types/campaign.ts",
    "target": "packages/medusa-promotion/src/types/campaign.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/types/index.ts",
    "target": "packages/medusa-promotion/src/types/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/types/promotion-rule-value.ts",
    "target": "packages/medusa-promotion/src/types/promotion-rule-value.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/types/promotion-rule.ts",
    "target": "packages/medusa-promotion/src/types/promotion-rule.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/types/promotion.ts",
    "target": "packages/medusa-promotion/src/types/promotion.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/compute-actions/buy-get.ts",
    "target": "packages/medusa-promotion/src/utils/compute-actions/buy-get.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/compute-actions/index.ts",
    "target": "packages/medusa-promotion/src/utils/compute-actions/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/compute-actions/line-items.ts",
    "target": "packages/medusa-promotion/src/utils/compute-actions/line-items.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/compute-actions/shipping-methods.ts",
    "target": "packages/medusa-promotion/src/utils/compute-actions/shipping-methods.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/compute-actions/sort-by-price.ts",
    "target": "packages/medusa-promotion/src/utils/compute-actions/sort-by-price.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/compute-actions/usage.ts",
    "target": "packages/medusa-promotion/src/utils/compute-actions/usage.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/index.ts",
    "target": "packages/medusa-promotion/src/utils/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/validations/application-method.ts",
    "target": "packages/medusa-promotion/src/utils/validations/application-method.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/validations/index.ts",
    "target": "packages/medusa-promotion/src/utils/validations/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/modules/promotion/src/utils/validations/promotion-rule.ts",
    "target": "packages/medusa-promotion/src/utils/validations/promotion-rule.ts",
    "classification": "importRelocation"
  },
  {
    "source": "third_party/medusa/upstream/LICENSE",
    "target": "packages/medusa-promotion/LICENSE",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/cart/index.ts",
    "target": "packages/medusa-utils/src/totals/cart/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/create-raw-properties-from-bignumber.ts",
    "target": "packages/medusa-utils/src/totals/create-raw-properties-from-bignumber.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/transform-properties-to-bignumber.ts",
    "target": "packages/medusa-utils/src/totals/transform-properties-to-bignumber.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/promotion/index.ts",
    "target": "packages/medusa-utils/src/totals/promotion/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/payment/abstract-payment-provider.ts",
    "target": "packages/medusa-utils/src/payment/abstract-payment-provider.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/payment/payment-collection.ts",
    "target": "packages/medusa-utils/src/payment/payment-collection.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/payment/payment-session.ts",
    "target": "packages/medusa-utils/src/payment/payment-session.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/payment/webhook.ts",
    "target": "packages/medusa-utils/src/payment/webhook.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/promotion/index.ts",
    "target": "packages/medusa-utils/src/promotion/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/credit-lines/index.ts",
    "target": "packages/medusa-utils/src/totals/credit-lines/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/line-item/index.ts",
    "target": "packages/medusa-utils/src/totals/line-item/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/shipping-method/index.ts",
    "target": "packages/medusa-utils/src/totals/shipping-method/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/adjustment/index.ts",
    "target": "packages/medusa-utils/src/totals/adjustment/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/tax/index.ts",
    "target": "packages/medusa-utils/src/totals/tax/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/index.ts",
    "target": "packages/medusa-utils/src/totals/index.ts",
    "classification": "unchanged"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/__tests__/totals.ts",
    "target": "packages/medusa-utils/src/totals/__tests__/totals.spec.ts",
    "classification": "testPort"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/__tests__/create-raw-properties-from-bignumber.ts",
    "target": "packages/medusa-utils/src/totals/__tests__/create-raw-properties-from-bignumber.spec.ts",
    "classification": "testPort"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/totals/__tests__/transform-properties-to-bigbumber.spec.ts",
    "target": "packages/medusa-utils/src/totals/__tests__/transform-properties-to-bigbumber.spec.ts",
    "classification": "testPort"
  }
].map(pair => Object.freeze(pair)));

/** Pin identity in both directions, including each required classification.
 * License text has existing independent package consumers; it supplies no code
 * authority. Every other selected source has exactly its declared destination.
 * @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyCartPrerequisiteSourceSelection(files) {
  for (const pair of cartPrerequisiteSourcePairs) {
    const selected = files.filter(file => file.target === pair.target);
    if (selected.length !== 1 || selected[0]?.source !== pair.source || selected[0]?.classification !== pair.classification)
      throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of files) {
    const targetPair = cartPrerequisiteSourcePairs.find(pair => pair.target === file.target);
    if (targetPair !== undefined) continue;
    if (/^packages\/medusa-(cart|customer|tax|promotion|payment)\/src\//.test(file.target))
      throw new Error(failure + ": unselected module code " + file.target);
    const sourcePairs = cartPrerequisiteSourcePairs.filter(pair => pair.source === file.source);
    if (sourcePairs.length === 0) continue;
    if (file.source === nativePrefix + "LICENSE" && /^packages\/[^/]+\/LICENSE$/.test(file.target) &&
      ["unchanged", "preserved"].includes(file.classification))
      continue;
    throw new Error(failure + ": source redirected " + file.target);
  }
}

/** Keep complete typed and emitted programs, including ordering, imports and
 * operators. Printer whitespace and comments provide no execution authority.
 * @param {string} text */
function authorityProgram(text) {
  const emitted = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
  } });
  if (emitted.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error))
    throw new Error(failure + ": syntax");
  /** @param {ts.Node} node @returns {unknown} */
  const shape = node => {
    /** @type {unknown[]} */ const children = [];
    ts.forEachChild(node, child => { children.push(shape(child)); });
    return [node.kind, ts.isIdentifier(node) || ts.isLiteralExpression(node) ? node.text : undefined,
      ts.isVariableDeclarationList(node) ? node.flags & ts.NodeFlags.BlockScoped : undefined,
      ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) ? node.operator : undefined,
      ts.isTemplateLiteralToken(node) ? node.rawText : undefined,
      ts.isMetaProperty(node) ? node.keywordToken : undefined,
      ts.isImportAttributes(node) ? node.token : undefined,
      ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isExportDeclaration(node) || ts.isExportSpecifier(node)
        ? node.isTypeOnly : undefined, children];
  };
  return JSON.stringify([
    shape(ts.createSourceFile("cart-prerequisite.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)),
    shape(ts.createSourceFile("cart-prerequisite.js", emitted.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)),
  ]);
}

/** @param {string} source @param {string} before @param {string} after */
function replaceChecked(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(failure + ": Payment adaptation anchor");
  return source.replace(before, after);
}

/** The already pinned wrapper delegates supplied models without discovery.
 * Authenticate the full existing source as well as the exact relevant import
 * and function. This does not promote its filesystem fallback into the runtime. */
function verifyNativePaymentJoinerDelegation() {
  const source = readFileSync(new URL("../third_party/medusa/upstream/packages/core/utils/src/modules-sdk/joiner-config-builder.ts", import.meta.url));
  if (createHash("sha256").update(source).digest("hex") !== "943eee5a8fe10a0377761e7adf9955adc06ead9ca92556acea080bcf4ff8cca4")
    throw new Error(failure + ": native joiner wrapper provenance");
  const parsed = ts.createSourceFile("native-joiner.ts", source.toString("utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const imports = parsed.statements.filter(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === "./portable-joiner-config-builder");
  const wrappers = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "defineJoinerConfig");
  if (imports.length !== 1 || imports[0] === undefined || wrappers.length !== 1 || wrappers[0] === undefined ||
    authorityProgram(imports[0].getText(parsed)) !== authorityProgram('import { defineJoinerConfigFromModels, type JoinerConfigModels } from "./portable-joiner-config-builder"') ||
    authorityProgram(wrappers[0].getText(parsed)) !== authorityProgram(`export function defineJoinerConfig(
      serviceName: string, options: DefineJoinerConfigOptions = {}
    ) { return defineJoinerConfigFromModels(serviceName, {
      ...options, models: options.models ?? discoverJoinerConfigModels(),
    }) }`)) throw new Error(failure + ": native joiner wrapper delegation");
}

/** Only the import and callee change; native explicit models, aliases, options
 * and emitted program remain complete and ordered.
 * @param {string} source @param {string} target */
export function verifyPaymentJoinerFork(source, target) {
  verifyNativePaymentJoinerDelegation();
  const parsed = ts.createSourceFile("payment-joiner.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const declarations = parsed.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .filter(node => ts.isIdentifier(node.name) && node.name.text === "joinerConfig");
  const call = declarations[0]?.initializer;
  if (declarations.length !== 1 || call === undefined || !ts.isCallExpression(call) || call.arguments.length !== 2 ||
    !ts.isIdentifier(call.expression) || call.expression.text !== "defineJoinerConfig")
    throw new Error(failure + ": Payment native joiner call");
  const options = call.arguments[1];
  const models = options !== undefined && ts.isObjectLiteralExpression(options)
    ? options.properties.filter(node => ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "models") : [];
  const model = models[0];
  if (models.length !== 1 || model === undefined || !ts.isPropertyAssignment(model) ||
    !ts.isArrayLiteralExpression(model.initializer) || model.initializer.elements.length === 0 ||
    !model.initializer.elements.every(ts.isIdentifier))
    throw new Error(failure + ": Payment explicit native models");
  let expected = replaceChecked(source, 'import { defineJoinerConfig, Modules } from "@medusajs/framework/utils"',
    'import { Modules } from "@medusajs/framework/utils/portable"\n' +
    'import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"');
  expected = replaceChecked(expected, "defineJoinerConfig(Modules.PAYMENT,", "defineJoinerConfigFromModels(Modules.PAYMENT,");
  if (authorityProgram(expected) !== authorityProgram(target)) throw new Error(failure + ": Payment joiner program");
}

/** Authenticate the shared cache helper independently of any Cart step. Only
 * erased contracts and exact imports change; native resolution, call order,
 * callbacks, cache operations and flag behavior remain complete.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyWorkflowCacheFork(source, target, destination) {
  let expected = source;
  /** @param {string} before @param {string} after @param {number} [count] */
  const replace = (before, after, count = 1) => {
    if (expected.split(before).length !== count + 1) throw new Error(failure + ": workflow cache relocation anchor");
    expected = expected.split(before).join(after);
  };
  if (destination === "packages/medusa-utils/src/caching/index.ts") {
    replace('import { ICachingModuleService, Logger, MedusaContainer } from "@medusajs/types"',
      'import type { ICachingModuleService } from "@medusajs/types/caching/index"\nimport type { Logger } from "@medusajs/types"');
    replace('import { MedusaContextType, Modules } from "../modules-sdk"',
      'import { MedusaContextType } from "../modules-sdk/decorators/context-parameter"\nimport { Modules } from "../modules-sdk/definition"');
    replace('from "../feature-flags"', 'from "../feature-flags/flag-router"');
    replace('import { ContainerRegistrationKeys, isObject } from "../common"',
      'import { ContainerRegistrationKeys } from "../common/container"\nimport { isObject } from "../common/is-object"\n\n' +
      'interface CacheContainer {\n  resolve<T>(name: string): T\n  resolve<T>(name: string, options: { readonly allowUnregistered: true }): T | undefined\n}');
    replace("MedusaContainer", "CacheContainer", 4);
  } else if (destination === "packages/medusa-utils/src/feature-flags/flag-router.ts") {
    replace('import { FeatureFlagTypes } from "@medusajs/types"', 'import type * as FeatureFlagTypes from "@medusajs/types/feature-flag/index"');
  } else throw new Error(failure + ": unknown workflow cache source");
  if (authorityProgram(expected) !== authorityProgram(target)) throw new Error(failure + ": workflow cache program");
}

/** The native selection, cache helpers, email validation and scalar inverse
 * remain complete. Only the existing transaction-covered host declaration,
 * precise imports and erased contracts are adapted.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyCustomerSelectionFork(source, target, destination) {
  let expected = source.replaceAll("\r\n", "\n");
  /** @param {string} before @param {string} after @param {number} [count] */
  const replace = (before, after, count = 1) => {
    if (expected.split(before).length !== count + 1) throw new Error(failure + ": Customer selection adaptation anchor");
    expected = expected.split(before).join(after);
  };
  if (destination === "packages/medusa-core-flows/src/cart/steps/find-or-create-customer.ts") {
    replace("  MedusaContainer,\n", "");
    replace('} from "@medusajs/framework/types"', '} from "@medusajs/types"\nimport type { WorkflowContainer as MedusaContainer } from "@medusajs/workflows-sdk"');
    replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
    replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
    replace("customerId?: string | null", "customerId?: string | null | undefined");
    replace("email?: string | null", "email?: string | null | undefined", 2);
    replace("customer?: CustomerDTO | null", "customer?: CustomerDTO | null | undefined");
    replace("  customer?: CustomerDTO\n", "  customer?: CustomerDTO | null | undefined\n");
    replace("export const findOrCreateCustomerStep = createStep(", "export const findOrCreateCustomerStep = createStep<\n" +
      "  FindOrCreateCustomerStepInput,\n  FindOrCreateCustomerOutputStepOutput,\n  StepCompensateInput\n>(");
    replace("  findOrCreateCustomerStepId,", '  { name: findOrCreateCustomerStepId, compensation: "transactionCovered" },');
  } else if (destination !== "packages/medusa-utils/src/common/is-email.ts") {
    throw new Error(failure + ": unknown Customer selection source");
  }
  if (authorityProgram(expected) !== authorityProgram(target)) throw new Error(failure + ": Customer selection program");
}
