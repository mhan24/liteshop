import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { getThemePreference, setThemePreference, subscribeTheme, themeInitScript } from "@/lib/theme";

// Run the exact script sent before hydration, with only the APIs available in the document head.
function firstTheme(stored: string | null | Error) {
  const root = { dataset: {} as { theme?: string } };
  const localStorage = {
    getItem(key: string) {
      if (stored instanceof Error) throw stored;
      return key === "liteshop_theme" ? stored : null;
    },
  };
  const window = { document: { documentElement: root }, localStorage };
  runInNewContext(themeInitScript, { ...window, window });
  return root.dataset.theme;
}

it("首屏脚本在页面水合前恢复已保存的浅色或深色", () => {
  expect(firstTheme("light")).toBe("light");
  expect(firstTheme("dark")).toBe("dark");
});

it("没有有效偏好或无法读取存储时，首屏继续跟随系统", () => {
  for (const stored of [null, "", "system", "broken", new Error("Storage denied")]) {
    expect(firstTheme(stored)).toBeUndefined();
  }
});

it("手动设置同步到页面与存储，其他标签页清除偏好后恢复跟随系统", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("localStorage", storage);
  const listener = vi.fn();
  const unsubscribe = subscribeTheme(listener);
  try {
    setThemePreference("dark");
    expect(getThemePreference()).toBe("dark");
    expect(storage.getItem("liteshop_theme")).toBe("dark");
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    values.clear();
    events.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
    expect(getThemePreference()).toBe("system");
    expect(listener).toHaveBeenCalled();
  } finally {
    unsubscribe();
    vi.unstubAllGlobals();
  }
});
