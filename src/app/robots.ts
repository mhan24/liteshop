import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/products/", "/category/"],
        disallow: ["/admin", "/admin/", "/api/", "/orders", "/checkout", "/cart", "/pay/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
