"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * 滚动入场：进入视口时为容器加上 .is-visible，
 * 配合 globals.css 的 .reveal 过渡（600ms + 80ms 交错步进）。
 * --reveal-index 只影响过渡延迟，不改变布局。
 */
export function Reveal({
  children,
  className,
  index = 0,
}: {
  children: React.ReactNode;
  className?: string;
  index?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("is-visible");
            observer.disconnect();
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("reveal", className)}
      style={{ "--reveal-index": index } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
