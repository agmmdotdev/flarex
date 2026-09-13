import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("keeps PGlite username simulation separate from authenticated-login protection", async () => {
  const admin = new PGlite();
  const snapshot = await (async () => {
    try {
      await admin.exec(
        "create role functional_installer login nosuperuser nocreatedb nocreaterole noinherit nobypassrls",
      );
      return await admin.dumpDataDir("none");
    } finally {
      await admin.close();
    }
  })();
  const functional = await PGlite.create({
    loadDataDir: snapshot,
    username: "functional_installer",
  });
  try {
    expect(
      (
        await functional.query(`select current_user, session_user, rolsuper
      from pg_roles where rolname=current_user`)
      ).rows,
    ).toEqual([
      {
        current_user: "functional_installer",
        session_user: "postgres",
        rolsuper: false,
      },
    ]);
    // This succeeds because username applies SET ROLE to a single-user session.
    // A current-role-only check would therefore falsely certify protection.
    await functional.exec("reset role; reset session authorization");
    expect(
      (await functional.query("select current_user, session_user")).rows,
    ).toEqual([{ current_user: "postgres", session_user: "postgres" }]);
  } finally {
    await functional.close();
  }
}, 30_000);
