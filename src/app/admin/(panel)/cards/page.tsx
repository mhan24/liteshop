import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, products } from "@/db/schema";
import { getCardLowStockThreshold } from "@/server/settings";
import { csrfToken } from "@/server/admin-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/input";
import { AdminForm } from "@/components/admin/admin-form";
import { deleteCardAction, importCardsAction } from "@/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminCardsPage() {
  const csrf = await csrfToken();
  const [productRows, recent, threshold] = await Promise.all([
    db.select().from(products).where(eq(products.deliveryType, "auto")).orderBy(asc(products.id)),
    db.select().from(cards).orderBy(desc(cards.id)).limit(100),
    getCardLowStockThreshold(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl font-semibold">卡密库存</h1>

      <Card>
        <CardHeader>
          <CardTitle>导入卡密（每行一条）</CardTitle>
        </CardHeader>
        <CardContent>
          {productRows.length === 0 ? (
            <p className="text-sm text-muted">暂无自动发卡商品，请先创建。</p>
          ) : (
            <AdminForm action={importCardsAction} csrf={csrf} submitLabel="导入" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="card-product">商品</Label>
                <Select id="card-product" name="productId" required>
                  {productRows.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="card-content">卡密内容</Label>
                <Textarea id="card-content" name="content" rows={8} required placeholder={"CARD-AAAA-BBBB\nCARD-CCCC-DDDD"} />
              </div>
            </AdminForm>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">最近 100 条卡密（低于 {threshold} 条时后台告警）</h2>
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {recent.length === 0 ? (
            <li className="p-4 text-sm text-muted">暂无卡密</li>
          ) : (
            recent.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{c.content}</p>
                  <p className="text-xs text-muted">
                    商品 #{c.productId} · {c.status}
                    {c.soldAt ? ` · ${c.soldAt.toLocaleString("zh-CN")}` : ""}
                  </p>
                </div>
                {c.status === "available" ? (
                  <AdminForm action={deleteCardAction} csrf={csrf} submitLabel="删除">
                    <input type="hidden" name="id" value={c.id} />
                  </AdminForm>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
