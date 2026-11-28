import { beforeEach, expect, it } from "vitest";
import { db } from "@/db";
import { products } from "@/db/schema";
import { listStoreProducts } from "@/server/catalog";
import HomePage from "@/app/(shop)/page";
import { resetDb } from "../helpers";

beforeEach(resetDb);

it("把商品名里的百分号、下划线与反斜杠当作普通搜索字符", async () => {
  await db.insert(products).values([
    { name: "点卡 10%_\\", slug: "literal", priceCents: 100, status: "on" },
    { name: "点卡 10", slug: "regular", priceCents: 100, status: "on" },
  ]);
  for (const q of ["%", "_", "\\"]) {
    expect((await listStoreProducts({ q })).map((row) => row.slug)).toEqual(["literal"]);
  }
});

it("首页能处理重复的搜索和分类参数", async () => {
  await expect(HomePage({
    searchParams: Promise.resolve({ q: ["点卡", "充值"], category: ["cards", "topup"] }),
  })).resolves.toBeDefined();
});
