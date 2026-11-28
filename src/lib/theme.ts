export type ThemePreference = "system" | "light" | "dark";

const storageKey = "liteshop_theme";
const changeEvent = "liteshop:theme";
let temporaryPreference: ThemePreference | undefined;

// 静态脚本随初始 HTML 到达，在页面首次绘制前恢复用户的选择。
export const themeInitScript = `try {
  const theme = localStorage.getItem("${storageKey}");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}`;

function preference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function getThemePreference(): ThemePreference {
  return preference(document.documentElement.dataset.theme);
}

function applyTheme(theme: ThemePreference) {
  if (theme === getThemePreference()) return;
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(changeEvent));
}

export function setThemePreference(value: string) {
  const theme = preference(value);
  try {
    if (theme === "system") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, theme);
    temporaryPreference = undefined;
  } catch {
    temporaryPreference = theme;
  }
  applyTheme(theme);
}

export function subscribeTheme(listener: () => void) {
  function restoreTheme() {
    try {
      applyTheme(temporaryPreference ?? preference(localStorage.getItem(storageKey)));
    } catch {
      // 浏览器禁用存储时，保留当前文档的选择。
    }
  }
  function onStorage(event: StorageEvent) {
    if (event.key === storageKey || event.key === null) restoreTheme();
  }
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", restoreTheme);
  restoreTheme();
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", restoreTheme);
  };
}
