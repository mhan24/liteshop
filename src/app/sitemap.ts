import type { MetadataRoute } from "next";
import { listStoreProducts, listCategories } from "@/server/catalog";
import { getSiteUrl } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getSiteUrl();
  const [products, categories] = await Promise.all([listStoreProducts(), listCategories()]);
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    ...categories.map((c) => ({
      url: `${base}/category/${c.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...products.map((p) => ({
      url: `${base}/products/${p.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
