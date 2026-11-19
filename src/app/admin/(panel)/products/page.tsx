import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { formatMoney } from "@/lib/money";
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

/**
 * 商品与分类。
 * 商品只有一种履约方式（卡密自动发货），库存 = 可用卡密数量，
 * 因此表单里没有「发货方式」「库存上限」这类字段。
 */
export default async function AdminProductsPage() {
  const csrf = await csrfToken();
  const [items, cats] = await Promise.all([
    listAllProducts(),
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">商品与分类</h1>

      <Card>
        <CardHeader>
          <CardTitle>新建分类</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminForm
            action={createCategoryAction}
            csrf={csrf}
            submitLabel="创建分类"
            className="grid gap-3 sm:grid-cols-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">名称</Label>
              <Input id="cat-name" name="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-slug">URL 标识（可选）</Label>
              <Input id="cat-slug" name="slug" placeholder="留空自动生成" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-sort">排序</Label>
              <Input id="cat-sort" name="sortOrder" type="number" defaultValue={0} min={0} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-desc">分类说明</Label>
              <Input id="cat-desc" name="description" />
            </div>
          </AdminForm>
          {cats.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {cats.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-line px-3 py-2 text-sm"
                >
                  <span>
                    {c.name} <span className="font-mono text-xs text-muted">/{c.slug}</span>
                  </span>
                  <AdminForm action={deleteCategoryAction} csrf={csrf} submitLabel="删除" variant="danger" inline confirmText="确认删除该分类？分类下的商品会保留，并变为「无分类」。">
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
          <ProductFields csrf={csrf} action={createProductAction} submitLabel="创建商品" categories={cats} />
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">全部商品</h2>
        {items.length === 0 ? <p className="text-sm text-muted">暂无商品</p> : null}
        {items.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {p.name} <span className="font-mono text-xs text-muted">/{p.slug}</span>{" "}
                <span className="text-xs font-normal text-muted">
                  <span className="data">{formatMoney(p.priceCents)}</span> · 库存 {p.stock} · {p.status === "on" ? "上架" : "下架"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProductFields
                csrf={csrf}
                action={updateProductAction}
                submitLabel="保存修改"
                categories={cats}
                initial={{
                  id: p.id,
                  name: p.name,
                  slug: p.slug,
                  description: p.description,
                  priceMinor: p.priceCents,
                  status: p.status,
                  imageUrl: p.imageUrl ?? "",
                  seoDescription: p.seoDescription ?? "",
                  categoryId: p.categoryId,
                }}
              />
              <AdminForm action={deleteProductAction} csrf={csrf} submitLabel="删除商品" variant="danger" inline confirmText="确认删除该商品及其全部关联卡密？已完成订单的交付记录不受影响，此操作不可恢复。">
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
  initial,
}: {
  csrf: string;
  action: (prev: S | null, formData: FormData) => Promise<S>;
  submitLabel: string;
  categories: Array<typeof categories.$inferSelect>;
  initial?: {
    id: number;
    name: string;
    slug: string;
    description: string;
    priceMinor: number;
    status: "on" | "off";
    imageUrl: string;
    seoDescription: string;
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
        <Label>URL 标识（Slug）</Label>
        <Input name="slug" required pattern="[a-z0-9][a-z0-9-]+" placeholder="仅小写字母、数字和短横线" defaultValue={initial?.slug} />
      </div>
      <div className="space-y-1.5">
        <Label>价格（美分，100 = $1.00）</Label>
        <Input name="priceMinor" type="number" min={1} max={99999999} required defaultValue={initial?.priceMinor ?? 100} />
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
        <Label>图片链接（可选）</Label>
        <Input name="imageUrl" type="url" defaultValue={initial?.imageUrl} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>商品介绍</Label>
        <Textarea name="description" rows={3} defaultValue={initial?.description} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>SEO 简介（可选，≤300 字）</Label>
        <Input name="seoDescription" maxLength={300} placeholder="留空默认截取商品介绍" defaultValue={initial?.seoDescription} />
      </div>
    </AdminForm>
  );
}
