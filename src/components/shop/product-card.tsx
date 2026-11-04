import Link from "next/link";
import { formatMoney } from "@/lib/money";

/**
 * 商品卡（首页与分类页共用）。
 * 白底、1px 边框、hover 只做极轻的边框加深与 2px 阴影；
 * 库存直接给出可用数量，缺货时整卡降透明度但仍可进入详情。
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
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition-[box-shadow,border-color] duration-200 hover:border-[#dedcd8] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
    >
      {product.imageUrl ? (
        <div className="aspect-[16/10] overflow-hidden border-b border-line bg-surface-2">
          {/* 商品图由后台填写，尺寸与画质不可控，用 next/image 需要域名白名单，这里直接给 img */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col justify-between gap-6 p-6">
        <div className="space-y-2">
          <h2 className="font-serif text-lg font-semibold leading-snug tracking-[-0.01em]">
            {product.name}
          </h2>
          {product.description ? (
            <p className="line-clamp-2 text-sm leading-6 text-muted">{product.description}</p>
          ) : null}
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <span className="font-serif text-lg font-semibold tracking-tight">
            {formatMoney(product.priceCents)}
          </span>
          <span className="font-mono text-xs text-muted">
            {product.inStock ? `库存 ${product.stock}` : "缺货"}
          </span>
        </div>
      </div>
    </Link>
  );
}
