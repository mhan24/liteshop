import Link from "next/link";
import { formatMoney } from "@/lib/money";

/**
 * 商品卡（首页与分类页共用，DESIGN.md §4 可点击卡片）。
 * hover：边框 line-strong + 底 surface-2，不位移、不加阴影；
 * 价格等宽；库存用「活」圆点表示，缺货降透明度但仍可进入详情。
 */
export function ProductCard({
  product,
}: {
  product: {
    slug: string;
    name: string;
    description: string;
    priceCents: number;
    imageUrl: string | null;
    inStock: boolean;
    stock: number;
  };
}) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className={`group flex h-full flex-col overflow-hidden rounded-md border border-line bg-surface transition-[background-color,border-color] duration-200 hover:border-line-strong hover:bg-surface-2 ${product.inStock ? "" : "opacity-60"}`}
    >
      {product.imageUrl ? (
        <div className="aspect-[16/10] overflow-hidden border-b border-line bg-sunken">
          {/* 商品图由后台填写，尺寸与画质不可控，用 next/image 需要域名白名单，这里直接给 img */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover opacity-90 transition-[transform,opacity] duration-500 group-hover:scale-[1.02] group-hover:opacity-100"
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col justify-between gap-6 p-5 sm:p-6">
        <div className="space-y-2">
          <h3 className="text-[15px] font-semibold leading-snug transition-colors group-hover:text-accent">
            {product.name}
          </h3>
          {product.description ? (
            <p className="line-clamp-2 text-sm leading-6 text-muted">{product.description}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="data text-lg font-semibold tracking-tight">{formatMoney(product.priceCents)}</span>
          <span
            className={`data inline-flex items-center gap-1.5 text-xs ${product.inStock ? "text-success" : "text-faint"}`}
          >
            <span aria-hidden className="live-dot" />
            {product.inStock ? `库存 ${product.stock}` : "缺货"}
          </span>
        </div>
      </div>
    </Link>
  );
}
