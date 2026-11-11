export const Entities = { price_list: "price_list", price: "price" } as const

export const adminPriceListRemoteQueryFields = [
  "id",
  "type",
  "description",
  "title",
  "status",
  "starts_at",
  "ends_at",
  "created_at",
  "updated_at",
  "deleted_at",
  "price_list_rules.value",
  "price_list_rules.attribute",
]

export const retrivePriceListQueryConfig = {
  defaults: adminPriceListRemoteQueryFields,
  isList: false,
  entity: Entities.price_list,
}

export const listPriceListQueryConfig = {
  ...retrivePriceListQueryConfig,
  isList: true,
  entity: Entities.price_list,
}
