export type Order = { [key: string]: "ASC" | "DESC" | Order }

/**
 * Convert an order of dot string into a nested object
 * @example
 * input: { id: "ASC", "items.title": "ASC", "items.variant.title": "ASC" }
 * output: {
 *   "id": "ASC",
 *   "items": {
 *     "id": "ASC",
 *     "variant": {
 *        "title": "ASC"
 *     }
 *   },
 * }
 * @param orderBy
 */
export function buildOrder(orderBy: { [k: string]: "ASC" | "DESC" }): Order {
  // Native path construction over caller-owned selectors must not traverse Object.prototype.
  const output: Order = Object.create(null)

  const orderKeys = Object.keys(orderBy)

  for (const order of orderKeys) {
    if (order.indexOf(".") > -1) {
      const nestedOrder = order.split(".")

      let parent = output

      while (nestedOrder.length > 1) {
        const nestedRelation = nestedOrder.shift() as string
        parent = (parent[nestedRelation] as Order) ??= Object.create(null)
      }

      parent[nestedOrder[0]] = orderBy[order]

      continue
    }

    output[order] = orderBy[order]
  }

  return output
}
