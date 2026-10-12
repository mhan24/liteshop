import Link from "next/link";
import { csrfToken } from "@/lib/session";
import { getAdminBase } from "@/lib/admin-path";
import { takeFlash } from "@/lib/flash-store";
import {
  clearCardsAction,
  deleteCardsAction,
} from "@/actions/admin";
import { listCards, listProducts } from "@/server/admin/catalog";
import { CardStatus } from "@/db/schema";
import { Flash } from "@/components/admin/flash";
import { ImportCardsDialog } from "@/components/admin/import-cards-dialog";
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
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";
export const metadata = { title: "卡密管理" };

const STATUS_TABS = [
  { key: "", label: "全部" },
  { key: CardStatus.available, label: "可用" },
  { key: CardStatus.reserved, label: "占用" },
  { key: CardStatus.sold, label: "已售" },
];

export default async function AdminCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; status?: string; flash?: string }>;
}) {
  const params = await searchParams;
  const flash = takeFlash(params.flash);
  const csrf = await csrfToken();
  const base = await getAdminBase();
  const products = listProducts().filter((p) => p.deliveryType === "auto");

  const selectedId = Number(params.product ?? 0) || products[0]?.id || 0;
  const selected = products.find((p) => p.id === selectedId) ?? null;
  const status = params.status ?? "";
  const cards = selected ? listCards(selected.id, status || null) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl tracking-tight">卡密</h1>
          <p className="mt-1 text-sm text-muted-foreground">卡密池：导入即上架售卖；同一内容可多张（支持重复销售）</p>
        </div>
        {selected ? (
          <div className="flex items-center gap-2">
            <ImportCardsDialog csrf={csrf} productId={selected.id}>
              <Button>导入卡密</Button>
            </ImportCardsDialog>
            <form action={clearCardsAction}>
              <input type="hidden" name="csrf" value={csrf} />
              <input type="hidden" name="productId" value={selected.id} />
              <Button type="submit" variant="outline">
                清空可用
              </Button>
            </form>
          </div>
        ) : null}
      </div>

      <Flash ok={flash?.ok} err={flash?.err} />

      {products.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          还没有自动发卡商品，先到
          <Link href={`${base}/products`} className="mx-1 underline underline-offset-4">
            商品管理
          </Link>
          创建一个
        </div>
      ) : (
        <>
          {/* 商品切换 */}
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <Link
                key={p.id}
                href={`${base}/cards?product=${p.id}${status ? `&status=${status}` : ""}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  p.id === selectedId
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {p.name}
                <span className="ml-2 font-mono text-xs opacity-70">余 {p.availableCards}</span>
              </Link>
            ))}
          </div>

          {selected ? (
            <>
              {/* 状态筛选 */}
              <div className="flex gap-1">
                {STATUS_TABS.map((t) => (
                  <Link
                    key={t.key}
                    href={`${base}/cards?product=${selected.id}${t.key ? `&status=${t.key}` : ""}`}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-sm",
                      status === t.key
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </Link>
                ))}
              </div>

              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-8"></TableHead>
                      <TableHead>卡密内容</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>关联订单</TableHead>
                      <TableHead className="text-right">导入时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cards.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          暂无卡密
                        </TableCell>
                      </TableRow>
                    ) : (
                      cards.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
                            {c.status === "available" ? (
                              <input type="checkbox" name="ids" value={c.id} form="delete-cards-form" className="size-3.5" />
                            ) : null}
                          </TableCell>
                          <TableCell className="max-w-md">
                            <span className="block truncate font-mono text-xs" title={c.content}>
                              {c.content}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "border-transparent",
                                c.status === "available" && "bg-pastel-green-bg text-pastel-green-text",
                                c.status === "reserved" && "bg-pastel-yellow-bg text-pastel-yellow-text",
                                c.status === "sold" && "bg-pastel-blue-bg text-pastel-blue-text"
                              )}
                            >
                              {c.status === "available" ? "可用" : c.status === "reserved" ? "占用" : "已售"}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {c.orderId ? (
                              <Link
                                href={`${base}/orders?q=${c.orderId}`}
                                className="underline underline-offset-4"
                              >
                                {c.orderId}
                              </Link>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {formatDateTime(c.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <form id="delete-cards-form" action={deleteCardsAction} className="flex items-center gap-3">
                <input type="hidden" name="csrf" value={csrf} />
                <input type="hidden" name="productId" value={selected.id} />
                <Button type="submit" variant="outline" size="sm" disabled={status === "sold"}>
                  删除勾选的可用卡密
                </Button>
                <span className="text-xs text-muted-foreground">
                  仅可删除「可用」状态；占用/已售卡密保留审计
                </span>
              </form>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
