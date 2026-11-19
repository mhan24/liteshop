import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, products } from "@/db/schema";
import { getCardLowStockThreshold } from "@/server/settings";
import { csrfToken } from "@/server/admin-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/input";
import { Label, Select, Textarea } from "@/components/ui/input";
import { AdminForm } from "@/components/admin/admin-form";
import { deleteCardAction, importCardsAction } from "@/actions/admin";

export const dynamic = "force-dynamic";

const CARD_STATUS = { available: "可售", reserved: "已锁定（待支付）", sold: "已售" } as const;

export default async function AdminCardsPage() {
  const csrf = await csrfToken();
  const [productRows, recent, threshold, counts] = await Promise.all([
    db.select().from(products).orderBy(asc(products.id)),
    db.select().from(cards).orderBy(desc(cards.id)).limit(100),
    getCardLowStockThreshold(),
    db
      .select({ productId: cards.productId, status: cards.status, n: sql<number>`count(*)::int` })
      .from(cards)
      .groupBy(cards.productId, cards.status),
  ]);
  const nameOf = new Map(productRows.map((p) => [p.id, p.name]));
  const stockOf = (productId: number, status: string) =>
    counts.find((c) => c.productId === productId && c.status === status)?.n ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">卡密库存</h1>

      <Card>
        <CardHeader>
          <CardTitle>导入卡密（每行一条，重复内容自动跳过）</CardTitle>
        </CardHeader>
        <CardContent>
          {productRows.length === 0 ? (
            <p className="text-sm text-muted">还没有商品，先去「商品」创建。</p>
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
                <Textarea
                  id="card-content"
                  name="content"
                  rows={8}
                  required
                  placeholder={"CARD-AAAA-BBBB\nCARD-CCCC-DDDD"}
                />
              </div>
            </AdminForm>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">各商品库存</h2>
          <span className="text-xs text-faint">
            可售低于 <span className="data text-muted">{threshold}</span> 张标为待补货（阈值在「设置」中修改）
          </span>
        </div>
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="data-table">
            <thead>
              <tr>
                <th>商品</th>
                <th style={{ textAlign: "right" }}>可售</th>
                <th style={{ textAlign: "right" }}>已锁定</th>
                <th style={{ textAlign: "right" }}>已售</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {productRows.map((p) => {
                const available = stockOf(p.id, "available");
                return (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      {p.status === "off" ? <span className="ml-2 text-xs text-faint">已下架</span> : null}
                    </td>
                    <td className="data text-right">{available}</td>
                    <td className="data text-right text-muted">{stockOf(p.id, "reserved")}</td>
                    <td className="data text-right text-muted">{stockOf(p.id, "sold")}</td>
                    <td>
                      {available === 0 ? (
                        <Badge tone="red">缺货</Badge>
                      ) : available < threshold ? (
                        <Badge tone="yellow">待补货</Badge>
                      ) : (
                        <Badge tone="green">充足</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">最近 100 条卡密</h2>
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {recent.length === 0 ? (
            <li className="p-4 text-sm text-muted">还没有卡密。</li>
          ) : (
            recent.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="data truncate text-xs text-fg">{c.content}</p>
                  <p className="text-xs text-muted">
                    {nameOf.get(c.productId) ?? `商品 #${c.productId}`} · {CARD_STATUS[c.status]}
                    {c.soldAt ? ` · ${c.soldAt.toLocaleString("zh-CN")}` : ""}
                  </p>
                </div>
                {c.status === "available" ? (
                  <AdminForm action={deleteCardAction} csrf={csrf} submitLabel="删除" variant="danger" inline confirmText="删除这张卡密？">
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
