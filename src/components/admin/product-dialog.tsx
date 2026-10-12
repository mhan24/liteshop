"use client";

import { useState } from "react";
import { currencySymbol } from "@/lib/money";
import { saveProductAction } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
import { Textarea } from "@/components/ui/textarea";

export interface ProductDialogData {
  id?: number;
  name?: string;
  slug?: string;
  description?: string;
  imageUrl?: string | null;
  /** 分 → 金额字符串 */
  price?: number;
  currency?: string;
  deliveryType?: string;
  stockLimit?: number;
  status?: string;
  sort?: number;
}

function centsToYuan(cents?: number): string {
  if (cents == null) return "";
  const s = String(cents).padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

export function ProductDialog({
  product,
  csrf,
  siteCurrency,
  children,
}: {
  product?: ProductDialogData;
  csrf: string;
  /** 站点默认币种（新建商品默认值） */
  siteCurrency: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [deliveryType, setDeliveryType] = useState(product?.deliveryType ?? "auto");
  const [status, setStatus] = useState(product?.status ?? "on");
  const [currency, setCurrency] = useState(product?.currency ?? siteCurrency);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product?.id ? "编辑商品" : "新建商品"}</DialogTitle>
          <DialogDescription>
            自动发卡需在「卡密」页导入卡密；人工发货订单支付后停留在待处理列表。
          </DialogDescription>
        </DialogHeader>
        <form action={saveProductAction} className="space-y-4">
          <input type="hidden" name="csrf" value={csrf} />
          {product?.id ? <input type="hidden" name="id" value={product.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-name">商品名</Label>
              <Input id="p-name" name="name" defaultValue={product?.name} required maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-slug">链接标识（可选）</Label>
              <Input id="p-slug" name="slug" defaultValue={product?.slug} placeholder="留空自动生成" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-price">价格（{currencySymbol(currency) || currency}）</Label>
              <Input
                id="p-price"
                name="price"
                inputMode="decimal"
                defaultValue={centsToYuan(product?.price)}
                placeholder="9.90"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>币种</Label>
              <CurrencySelect name="currency" value={currency} onValueChange={setCurrency} />
            </div>
            <div className="space-y-1.5">
              <Label>发货方式</Label>
              <input type="hidden" name="deliveryType" value={deliveryType} />
              <Select value={deliveryType} onValueChange={setDeliveryType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动发卡</SelectItem>
                  <SelectItem value="manual">人工发货</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-stock">库存数量（人工发货）</Label>
              <Input
                id="p-stock"
                name="stockLimit"
                type="number"
                min={-1}
                placeholder="留空或 -1 = 不限"
                defaultValue={
                  product?.stockLimit != null && product.stockLimit >= 0 ? product.stockLimit : ""
                }
                disabled={deliveryType !== "manual"}
              />
              <p className="text-xs text-muted-foreground">
                填 0 表示售罄；留空或 -1 表示不限库存。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>上架状态</Label>
              <input type="hidden" name="status" value={status} />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">上架</SelectItem>
                  <SelectItem value="off">下架</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-sort">排序权重</Label>
              <Input id="p-sort" name="sort" type="number" defaultValue={product?.sort ?? 0} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-image">图片 URL（可选）</Label>
              <Input id="p-image" name="imageUrl" defaultValue={product?.imageUrl ?? ""} placeholder="https://…" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-desc">商品描述</Label>
              <Textarea id="p-desc" name="description" rows={5} defaultValue={product?.description} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
