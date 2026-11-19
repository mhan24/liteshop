"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * 滚动入场（渐进增强）：内容默认可见，JS 未加载或加载慢时不会出现空白。
 * 挂载时只给「仍在视口下方」的元素加 data-armed（隐藏待入场），
 * 进入视口后加 .is-visible 过渡显示；首屏已可见的元素不做动画、不闪烁。
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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // 首屏：保持原样
    el.dataset.armed = "";
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add("is-visible");
          observer.disconnect();
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
