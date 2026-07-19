declare module "pg/lib/client.js" {
  import type { Client } from "pg";

  const ClientConstructor: typeof Client;
  export default ClientConstructor;
}
