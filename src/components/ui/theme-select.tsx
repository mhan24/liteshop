"use client";

import { useSyncExternalStore } from "react";
import { getThemePreference, setThemePreference, subscribeTheme } from "@/lib/theme";

export function ThemeSelect() {
  const theme = useSyncExternalStore(subscribeTheme, getThemePreference, () => "system");

  return (
    <label
      title="外观主题"
      className="relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-sm border border-line px-2 text-xs font-medium text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
    >
      <span aria-hidden="true" className="flex size-3.5 overflow-hidden rounded-full border border-current">
        <span className="w-1/2 bg-current" />
      </span>
      外观
      <select
        aria-label="外观主题"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        value={theme}
        onChange={(event) => setThemePreference(event.currentTarget.value)}
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
    </label>
  );
}
