import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Docker healthcheck：DB 只读探测 */
export async function GET() {
  try {
    db.get(sql`SELECT 1`);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[health] 数据库探测失败", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
