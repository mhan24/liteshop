import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Docker healthcheck：DB 只读探测 */
export async function GET() {
  try {
    db.get(sql`SELECT 1`);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
