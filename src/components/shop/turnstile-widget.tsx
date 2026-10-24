"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_SRC_BASE = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** 从挂载到拿到 token 的总预算：覆盖「脚本加载 + render + challenge 网络往返」。
 *  render 成功但 challenge 的 iframe 被网络阻断时不会收到任何回调，
 *  必须靠这个总预算兜底判不可用。 */
const SOLVE_TIMEOUT_MS = 15_000;

/** Turnstile 常见错误码的中文提示（其余展示原始码） */
const ERROR_HINTS: Record<string, string> = {
  "110200": "域名未加入该 Site Key 的允许列表，请到 Cloudflare Turnstile 设置检查主机名",
  "300xxx": "人机验证执行出错，请重试",
  "600000": "人机验证挑战失败，请重试",
};

/**
 * Cloudflare Turnstile 显式渲染组件。
 * - onToken 产出一次性验证 token（过期/出错置空）；父级以 hidden input 随表单提交
 * - 脚本加载失败 / 渲染超时 / 挑战错误 → 显示可读提示与「重试」按钮
 *   （常见原因：访客网络到 challenges.cloudflare.com 不稳定；Site Key 未包含当前域名）
 * - 重试用 cache-bust 重新插入脚本：旧脚本可能"加载完成"但内容无效
 *   （网络劫持/响应为空），此时 window.turnstile 不存在且 load 事件不会再触发，
 *   复用旧 script 节点会导致重试死锁
 * - 提交失败后 token 已被消费：父级可通过变更 key 强制重新挂载
 */
export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState<string>("");
  /** 重试代数：自增后 effect 重新执行（重新挂脚本/渲染） */
  const [attempt, setAttempt] = useState(0);
  const [lastAttempt, setLastAttempt] = useState(attempt);
  const gotTokenRef = useRef(false);

  // 重试时重置状态：渲染期调整（官方推荐模式），避免在 effect 里同步 setState
  if (lastAttempt !== attempt) {
    setLastAttempt(attempt);
    setState("loading");
    setErrorText("");
  }

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    widgetIdRef.current = null;
    gotTokenRef.current = false;

    const fail = (text: string) => {
      if (cancelled) return;
      setState("error");
      setErrorText(text);
      onTokenRef.current("");
    };

    const render = () => {
      if (cancelled || !ref.current) return;
      if (!window.turnstile) {
        // 脚本"加载完成"但 API 未定义：内容被劫持/响应为空
        fail("人机验证服务响应异常，请重试（或更换网络环境）");
        return;
      }
      if (widgetIdRef.current !== null) return;
      try {
        widgetIdRef.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: "light",
          callback: (token: string) => {
            if (cancelled) return;
            gotTokenRef.current = true;
            setState("ready");
            onTokenRef.current(token);
          },
          "expired-callback": () => onTokenRef.current(""),
          "error-callback": (code?: string) => {
            const hint =
              (code && ERROR_HINTS[code.slice(0, 6)]) ??
              (code && ERROR_HINTS[code]) ??
              `人机验证出错${code ? `（代码 ${code}）` : ""}，请重试`;
            fail(hint);
            return true as unknown as void;
          },
        });
      } catch {
        fail("人机验证初始化失败，请重试");
      }
    };

    // 总预算兜底：脚本加载失败、render 后挑战无响应（iframe 被网络阻断），
    // 只要预算内没拿到 token 就判不可用——这是验证服务不可用的唯一可靠信号。
    // 用 1s 轮询而非单次 setTimeout：个别环境会推迟长定时器，轮询必然累积触发。
    const startedAt = Date.now();
    const poll = setInterval(() => {
      if (cancelled) {
        clearInterval(poll);
        return;
      }
      if (gotTokenRef.current) {
        clearInterval(poll);
        return;
      }
      if (Date.now() - startedAt >= SOLVE_TIMEOUT_MS) {
        clearInterval(poll);
        if (widgetIdRef.current !== null) {
          // render 已成功但挑战无响应：移除僵尸 widget 再判失败
          window.turnstile?.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
        fail("人机验证服务无响应，请重试；多次失败可联系客服或更换网络");
      }
    }, 1000);

    if (window.turnstile) {
      render();
    } else {
      // 每次尝试都新建脚本节点（cache-bust）：复用已"完成"的旧节点会收不到 load 事件
      const script = document.createElement("script");
      script.src = `${SCRIPT_SRC_BASE}&r=${Date.now()}-${attempt}`;
      script.async = true;
      script.addEventListener("load", render);
      script.addEventListener("error", () => fail("无法连接人机验证服务，请检查网络后重试"));
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      clearInterval(poll);
      if (widgetIdRef.current !== null) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, attempt]);

  if (state === "error") {
    return (
      <div className="rounded-lg border border-tint-red-fg/25 bg-tint-red px-3 py-2.5 text-sm text-tint-red-fg">
        {errorText}
        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="ml-2 inline-flex items-center gap-1 font-medium underline underline-offset-4"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div>
      <div ref={ref} className="min-h-[65px]" />
      {state === "loading" ? <p className="mt-1 text-xs text-muted">人机验证加载中…</p> : null}
    </div>
  );
}
