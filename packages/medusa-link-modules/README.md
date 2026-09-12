# Private native Link source

Finite promotion from the pinned Medusa 2.13.4 fork recorded in
`third_party/medusa/SOURCE.json`. The exact source and output hashes are owned by
`medusa-currency-promotion.json`; the original source island remains inert.

Only ProductSalesChannel is exported. Native tuple normalization, selectors,
lifecycle maps and event construction remain in the original services.
Infrastructure adaptations:

- Portable utility imports and a DAL repository contract replace ORM imports.
- The selected service factory returns its actual constructor type and omits
  the unused read-only factory; no container or loader is promoted.
- Link naming uses the native composition function without promoting every
  built-in link definition.
- The native entity generator returns structural values instead of an ORM
  EntitySchema/class/filter/hook. Its columns, keys, defaults and four indexes
  are compared against the pinned original generator.

The adapter supplies one scoped repository and event sink. Flarex still owns
timestamps, active-row upsert, transaction settlement and publication. Its shared
lowering also supplies the implicit active-deletion index required by the
soft-delete capability. This is additional Flarex metadata, not an upstream index.

The SDK Link router is separately available from the private
`@medusajs/modules-sdk/link` entry. It requires explicit loaded modules and has
no process-global bootstrap fallback. Original routing tests remain separate
from stored integration tests; their Inventory fixtures do not activate an
Inventory integration.
