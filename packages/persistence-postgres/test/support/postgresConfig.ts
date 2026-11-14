import { trimToNonBlankOrNull } from "@flarex/utils/strings";

/** Environment-only test configuration, shared by standalone and Vitest fixtures. */
export const postgresUrl = trimToNonBlankOrNull(process.env.FLAREX_POSTGRES_DATABASE_URL);
