import Link from "next/link";
import { csrfToken } from "@/lib/session";
import { getAdminBase } from "@/lib/admin-path";
import { takeFlash } from "@/lib/flash-store";
import { getSiteCurrency } from "@/server/settings";
import { deleteProductAction, toggleProductStatusAction } from "@/actions/admin";
import { listProducts } from "@/server/admin/catalog";
import { formatCents } from "@/lib/money";
import { isUnlimitedStock } from "@/lib/stock";
import { Flash } from "@/components/admin/flash";
import { ProductDialog } from "@/components/admin/product-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "商品管理" };

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ flash?: string }>;
}) {
  const { flash: flashId } = await searchParams;
  const flash = takeFlash(flashId);
  const csrf = await csrfToken();
  const base = await getAdminBase();
  const siteCurrency = getSiteCurrency();
  const products = listProducts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl tracking-tight">商品</h1>
          <p className="mt-1 text-sm text-muted-foreground">共 {products.length} 个商品</p>
        </div>
        <ProductDialog csrf={csrf} siteCurrency={siteCurrency}>
          <Button>新建商品</Button>
        </ProductDialog>
      </div>

      <Flash ok={flash?.ok} err={flash?.err} />

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>商品</TableHead>
              <TableHead className="text-right">价格</TableHead>
              <TableHead>发货</TableHead>
              <TableHead className="text-right">卡密余/售</TableHead>
              <TableHead className="text-right">订单</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  还没有商品，点击右上角新建
                </TableCell>
              </TableRow>
            ) : (
              products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-medium">{p.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">/{p.slug}</p>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ¥ {formatCents(BigInt(p.priceCents))}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-border text-muted-foreground">
                      {p.deliveryType === "auto" ? "自动发卡" : "人工发货"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {p.deliveryType === "auto"
                      ? `${p.availableCards} / ${p.soldCards}`
                      : isUnlimitedStock(p.stockLimit)
                        ? "不限"
                        : p.stockLimit === 0
                          ? "已售罄"
                          : `${p.stockLimit}（剩余）`}
                  </TableCell>
                  <TableCell className="text-right font-mono">{p.orderCount}</TableCell>
                  <TableCell>
                    <span
                      className={
                        p.status === "on"
                          ? "inline-flex items-center rounded-full bg-pastel-green-bg px-2 py-0.5 text-xs tracking-[0.05em] text-pastel-green-text uppercase"
                          : "inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-xs tracking-[0.05em] text-muted-foreground uppercase"
                      }
                    >
                      {p.status === "on" ? "上架" : "下架"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <ProductDialog
                        csrf={csrf}
                        siteCurrency={siteCurrency}
                        product={{
                          id: p.id,
                          name: p.name,
                          slug: p.slug,
                          description: p.description,
                          imageUrl: p.imageUrl,
                          price: p.priceCents,
                          currency: p.currency,
                          deliveryType: p.deliveryType,
                          stockLimit: p.stockLimit,
                          status: p.status,
                          sort: p.sort,
                        }}
                      >
                        <Button variant="ghost" size="sm">
                          编辑
                        </Button>
                      </ProductDialog>
                      {p.deliveryType === "auto" ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`${base}/cards?product=${p.id}`}>卡密</Link>
                        </Button>
                      ) : null}
                      <form action={toggleProductStatusAction}>
                        <input type="hidden" name="csrf" value={csrf} />
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="status" value={p.status === "on" ? "off" : "on"} />
                        <Button type="submit" variant="ghost" size="sm">
                          {p.status === "on" ? "下架" : "上架"}
                        </Button>
                      </form>
                      <form action={deleteProductAction}>
                        <input type="hidden" name="csrf" value={csrf} />
                        <input type="hidden" name="id" value={p.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-pastel-red-text hover:bg-pastel-red-bg hover:text-pastel-red-text"
                        >
                          删除
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        已产生订单或卡密售出记录的商品不可删除（审计约束），可下架。
      </p>
    </div>
  );
}
