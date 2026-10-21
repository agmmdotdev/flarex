/**
 * The customer address details.
 */
export interface CustomerAddressDTO {
  /**
   * The ID of the customer address.
   */
  id: string

  /**
   * The address name of the customer address.
   */
  address_name?: string

  /**
   * Whether the customer address is default shipping.
   */
  is_default_shipping: boolean

  /**
   * Whether the customer address is default billing.
   */
  is_default_billing: boolean

  /**
   * The associated customer's ID.
   */
  customer_id: string

  /**
   * The company of the customer address.
   */
  company?: string

  /**
   * The first name of the customer address.
   */
  first_name?: string

  /**
   * The last name of the customer address.
   */
  last_name?: string

  /**
   * The address 1 of the customer address.
   */
  address_1?: string

  /**
   * The address 2 of the customer address.
   */
  address_2?: string

  /**
   * The city of the customer address.
   */
  city?: string

  /**
   * The country code of the customer address.
   */
  country_code?: string

  /**
   * The lower-case [ISO 3166-2](https://en.wikipedia.org/wiki/ISO_3166-2) province of the customer address.
   */
  province?: string

  /**
   * The postal code of the customer address.
   */
  postal_code?: string

  /**
   * The phone of the customer address.
   */
  phone?: string

  /**
   * Holds custom data in key-value pairs.
   */
  metadata?: Record<string, unknown>

  /**
   * The created at of the customer address.
   */
  created_at: string

  /**
   * The updated at of the customer address.
   */
  updated_at: string
}

/**
 * The customer details.
 */
export interface CustomerDTO {
  /**
   * The ID of the customer.
   */
  id: string

  /**
   * The email of the customer.
   */
  email: string

  /**
   * A flag indicating if customer has an account or not.
   */
  has_account: boolean

  /**
   * The associated default billing address's ID.
   */
  default_billing_address_id: string | null

  /**
   * The associated default shipping address's ID.
   */
  default_shipping_address_id: string | null

  /**
   * The company name of the customer.
   */
  company_name: string | null

  /**
   * The first name of the customer.
   */
  first_name: string | null

  /**
   * The last name of the customer.
   */
  last_name: string | null

  /**
   * The addresses of the customer.
   */
  addresses: CustomerAddressDTO[]

  /**
   * The phone of the customer.
   */
  phone: string | null

  /**
   * The groups of the customer.
   */
  groups: {
    /**
     * The ID of the group.
     */
    id: string
    /**
     * The name of the group.
     */
    name: string
  }[]

  /**
   * Holds custom data in key-value pairs.
   */
  metadata: Record<string, unknown>

  /**
   * Who created the customer.
   */
  created_by: string | null

  /**
   * The deletion date of the customer.
   */
  deleted_at: Date | string | null

  /**
   * The creation date of the customer.
   */
  created_at: Date | string

  /**
   * The update date of the customer.
   */
  updated_at: Date | string
}
