import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/input";

/** 商品卡（首页/分类页共用）：白底 1px 边框，hover 极轻投影 */
export function ProductCard({
  product,
  currency,
}: {
  product: {
    slug: string;
    name: string;
    description: string;
    priceCents: number;
    deliveryType: string;
    inStock: boolean;
    stockDisplay: number | null;
  };
  currency: string;
}) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex h-full flex-col justify-between rounded-xl border border-line bg-surface p-6 transition-[box-shadow,border-color] duration-200 hover:border-[#e0dfdc] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-serif text-lg font-semibold leading-snug tracking-tight">
            {product.name}
          </h2>
          <Badge tone={product.deliveryType === "auto" ? "green" : "yellow"}>
            {product.deliveryType === "auto" ? "自动发卡" : "人工发货"}
          </Badge>
        </div>
        <p className="line-clamp-2 text-sm leading-6 text-muted">{product.description}</p>
      </div>
      <div className="mt-6 flex items-baseline justify-between">
        <span className="font-serif text-lg font-semibold tracking-tight">
          {formatMoney(product.priceCents, currency)}
        </span>
        <span className={`text-xs ${product.inStock ? "text-muted" : "text-tint-red-fg"}`}>
          {product.stockDisplay === null ? "现货" : product.inStock ? `余量 ${product.stockDisplay}` : "缺货"}
        </span>
      </div>
    </Link>
  );
}
