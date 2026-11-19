import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getAdminSessionVersion, getCardLowStockThreshold, SETTING_KEYS } from "@/server/settings";
import { resetDb } from "../helpers";

/** 回归：未设置的数字配置曾因 Number(null) === 0 读成 0，默认值永不生效 */
describe("数字型设置默认值", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("未设置时回落默认值", async () => {
    expect(await getCardLowStockThreshold()).toBe(5);
    expect(await getAdminSessionVersion()).toBe(1);
  });

  it("显式设置（含 0）按设置值；非法值回落默认值", async () => {
    await db.insert(settings).values({ key: SETTING_KEYS.cardLowStockThreshold, value: "0" });
    expect(await getCardLowStockThreshold()).toBe(0);
    await db.update(settings).set({ value: "abc" });
    expect(await getCardLowStockThreshold()).toBe(5);
  });
});
