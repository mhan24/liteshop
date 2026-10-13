"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react/ssr";
import { cn } from "@/lib/utils";

/**
 * 交易所转账收银台段（对照 HashPay checkoutUrl 的体验）：
 * 大号应付金额 + 秒级倒计时 + 收款账户/金额一键复制 + 分步转账指引。
 * 支付结果由订单轮询负责，本段只管「把钱转对」。
 */

export interface CashierData {
  exchange: string;
  accountId: string;
  amount: string;
  asset: string;
  /** ISO/毫秒时间戳；null = 不限时 */
  expiresAtMs: number | null;
}

function useCountdown(expiresAtMs: number | null): {
  text: string;
  expired: boolean;
  urgent: boolean;
} {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAtMs == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAtMs]);

  if (expiresAtMs == null) return { text: "不限时", expired: false, urgent: false };
  const remain = Math.max(0, expiresAtMs - now);
  if (remain <= 0) return { text: "已超时", expired: true, urgent: true };
  const totalSeconds = Math.floor(remain / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  const text = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  return { text, expired: false, urgent: totalSeconds < 300 };
}

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("truncate text-sm", mono && "font-mono")} title={value}>
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // 剪贴板不可用（非 HTTPS 等）：静默，文本仍可手动选择
          }
        }}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={`复制${label}`}
        title={`复制${label}`}
      >
        {copied ? (
          <CheckIcon className="size-4 text-pastel-green-text" weight="bold" />
        ) : (
          <CopyIcon className="size-4" weight="bold" />
        )}
      </button>
    </div>
  );
}

export function ExchangeCashier({ data }: { data: CashierData }) {
  const countdown = useCountdown(data.expiresAtMs);

  return (
    <div
      className={cn(
        "mt-5 rounded-lg border p-5",
        countdown.urgent && !countdown.expired
          ? "border-pastel-red-bg bg-pastel-red-bg/40"
          : "border-border bg-secondary"
      )}
    >
      {/* 应付金额（唯一匹配依据）+ 倒计时 */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.05em] text-muted-foreground uppercase">
            转账金额（须完全一致）
          </p>
          <p className="mt-1 font-mono text-3xl leading-none">
            {data.amount}
            <span className="ml-2 text-base text-muted-foreground">{data.asset}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">支付倒计时</p>
          <p
            className={cn(
              "font-mono text-2xl leading-none",
              countdown.urgent ? "text-pastel-red-text" : ""
            )}
          >
            {countdown.text}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3 border-t border-border pt-4">
        <CopyField label={`收款账户（${data.exchange} UID）`} value={data.accountId} mono />
        <CopyField label="转账金额" value={data.amount} mono />
      </div>

      <ol className="mt-5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
        <li>
          打开{data.exchange} App，进入「转账 / 提币」，选择向
          {data.exchange === "币安 Binance" ? "币安账户（UID）" : "欧易账户（UID）"}转账
        </li>
        <li>粘贴上方收款账户与金额，币种选择 {data.asset}，完成转账</li>
        <li>到账后本页自动确认并发货，通常 1-3 分钟；请勿修改金额小数</li>
      </ol>
    </div>
  );
}
