import { describe, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadReverseServingScopes } from "./support/privatePayloadReverseServingScopes";
import { PRIVATE_REFERENCE_PAGE } from "../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";

const payloadMethods = ["payload-create", "payload-update", "payload-delete", PRIVATE_REFERENCE_PAGE];
const auth = { kind: "verifiedBearer", issuer: "https://rr4.test", subject: "editor-b", claims: {} } as const;
it("confines equal Product keys across two scopes and distinct principals from signed grants (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const a = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle, transport: "finiteCapture", registerCleanup: onTestFinished });
  const b = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle, transport: "finiteCapture", registerCleanup: onTestFinished });
  const first = await privatePayloadSaveFixture({ persistence: a.persistence, session: a.session, control, payloadMethods });
  try {
    const second = await privatePayloadSaveFixture({ persistence: b.persistence, session: b.session, control, payloadMethods, auth });
    try { await privatePayloadReverseServingScopes(first, second); } finally { await second.close(); }
  } finally { await first.close(); }
}, 480_000);

describe.skipIf(postgresUrl === null)("RR4 actual cross-scope serving (ordinary-role PostgreSQL)", () => {
  it("keeps equal native keys, policy points and issued grants scoped to the authenticated principal", async () => {
    const a = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const b = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
      try {
        const first = await privatePayloadSaveFixture({ persistence: a.persistence, session: makePostgresRelationalSession(a.persistence), payloadMethods });
        try {
          const second = await privatePayloadSaveFixture({ persistence: b.persistence, session: makePostgresRelationalSession(b.persistence), payloadMethods, auth });
          try { await privatePayloadReverseServingScopes(first, second); } finally { await second.close(); }
        } finally { await first.close(); }
      } finally { await b.dispose(); }
    } finally { await a.dispose(); }
  }, 480_000);
});
