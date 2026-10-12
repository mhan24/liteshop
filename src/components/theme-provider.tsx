"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** 主题 Provider：默认跟随系统；class 策略配合 globals.css 的 .dark 变量 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
