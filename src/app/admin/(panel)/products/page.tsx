import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { getSiteCurrency } from "@/server/settings";
import { csrfToken } from "@/server/admin-auth";
import { listAllProducts } from "@/server/catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { AdminForm } from "@/components/admin/admin-form";
import {
  createCategoryAction,
  createProductAction,
  deleteCategoryAction,
  deleteProductAction,
  updateProductAction,
} from "@/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const csrf = await csrfToken();
  const [items, cats, currency] = await Promise.all([
    listAllProducts(),
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
    getSiteCurrency(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl font-semibold">商品与分类</h1>

      <Card>
        <CardHeader>
          <CardTitle>新建分类</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminForm action={createCategoryAction} csrf={csrf} submitLabel="创建分类" className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">名称</Label>
              <Input id="cat-name" name="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-slug">Slug（可选）</Label>
              <Input id="cat-slug" name="slug" placeholder="留空自动生成" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-sort">排序</Label>
              <Input id="cat-sort" name="sortOrder" type="number" defaultValue={0} min={0} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-desc">描述</Label>
              <Input id="cat-desc" name="description" />
            </div>
          </AdminForm>
          {cats.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {cats.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                  <span>
                    {c.name} <span className="font-mono text-xs text-muted">/{c.slug}</span>
                  </span>
                  <AdminForm action={deleteCategoryAction} csrf={csrf} submitLabel="删除">
                    <input type="hidden" name="id" value={c.id} />
                  </AdminForm>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>新建商品</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductFields csrf={csrf} action={createProductAction} submitLabel="创建商品" categories={cats} currency={currency} />
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">全部商品</h2>
        {items.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {p.name}{" "}
                <span className="font-mono text-xs text-muted">/{p.slug}</span>{" "}
                <span className="text-xs text-muted">
                  {formatMoney(p.priceCents, currency)} · {p.status === "on" ? "上架" : "下架"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProductFields
                csrf={csrf}
                action={updateProductAction}
                submitLabel="保存修改"
                categories={cats}
                currency={currency}
                initial={{
                  id: p.id,
                  name: p.name,
                  slug: p.slug,
                  description: p.description,
                  priceMinor: p.priceCents,
                  deliveryType: p.deliveryType,
                  stockLimit: p.stockDisplay,
                  status: p.status,
                  imageUrl: p.imageUrl ?? "",
                  categoryId: p.categoryId,
                }}
              />
              <AdminForm action={deleteProductAction} csrf={csrf} submitLabel="删除商品">
                <input type="hidden" name="id" value={p.id} />
              </AdminForm>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}

function ProductFields<S extends { ok: boolean; message: string }>({
  csrf,
  action,
  submitLabel,
  categories: cats,
  currency,
  initial,
}: {
  csrf: string;
  action: (prev: S | null, formData: FormData) => Promise<S>;
  submitLabel: string;
  categories: Array<typeof categories.$inferSelect>;
  currency: string;
  initial?: {
    id: number;
    name: string;
    slug: string;
    description: string;
    priceMinor: number;
    deliveryType: "auto" | "manual";
    stockLimit: number | null;
    status: "on" | "off";
    imageUrl: string;
    categoryId: number | null;
  };
}) {
  return (
    <AdminForm action={action} csrf={csrf} submitLabel={submitLabel} className="grid gap-3 sm:grid-cols-2">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="space-y-1.5">
        <Label>名称</Label>
        <Input name="name" required defaultValue={initial?.name} />
      </div>
      <div className="space-y-1.5">
        <Label>Slug（URL）</Label>
        <Input name="slug" required pattern="[a-z0-9][a-z0-9-]+" defaultValue={initial?.slug} />
      </div>
      <div className="space-y-1.5">
        <Label>价格（{currency} 最小单位，分）</Label>
        <Input name="priceMinor" type="number" min={0} required defaultValue={initial?.priceMinor ?? 0} />
      </div>
      <div className="space-y-1.5">
        <Label>发货方式</Label>
        <Select name="deliveryType" defaultValue={initial?.deliveryType ?? "auto"}>
          <option value="auto">自动发卡</option>
          <option value="manual">人工发货</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>库存上限（manual 型；留空不限）</Label>
        <Input name="stockLimit" type="number" min={0} defaultValue={initial?.stockLimit ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label>状态</Label>
        <Select name="status" defaultValue={initial?.status ?? "on"}>
          <option value="on">上架</option>
          <option value="off">下架</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>分类</Label>
        <Select name="categoryId" defaultValue={initial?.categoryId ?? ""}>
          <option value="">（无分类）</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>图片 URL（可选）</Label>
        <Input name="imageUrl" type="url" defaultValue={initial?.imageUrl} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>描述</Label>
        <Textarea name="description" rows={3} defaultValue={initial?.description} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>SEO 描述（可选，≤300 字）</Label>
        <Input name="seoDescription" maxLength={300} />
      </div>
    </AdminForm>
  );
}
