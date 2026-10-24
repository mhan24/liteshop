"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { cancelOrderAction, resumePaymentAction } from "@/actions/shop";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Flash } from "@/components/admin/flash-view";

/** 待支付页：状态轮询 + 取消/重新支付（邮箱双因子） */
export function PayStatusActions({
  orderNo,
  status,
  paymentUrl,
}: {
  orderNo: string;
  status: string;
  paymentUrl: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "pending") return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router, status]);

  const [cancelState, cancelAction, cancelPending] = useActionState(cancelOrderAction, null);
  const [resumeState, resumeAction, resumePending] = useActionState(resumePaymentAction, null);

  if (status !== "pending") return null;

  return (
    <div className="space-y-4">
      {paymentUrl ? (
        <a
          href={paymentUrl}
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-accent-fg hover:opacity-90"
        >
          前往收银台支付
        </a>
      ) : null}

      {resumeState ? (
        <Flash ok={resumeState.ok ? resumeState.message : undefined} err={resumeState.ok ? undefined : resumeState.message} />
      ) : null}
      {resumeState?.ok ? (
        <a
          href={resumeState.data?.paymentUrl ?? "#"}
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-accent-fg"
        >
          打开新收银台
        </a>
      ) : null}

      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm text-muted">取消订单 / 重新发起支付（需下单邮箱）</summary>
        <form action={resumeAction} className="mt-3 space-y-3">
          <input type="hidden" name="orderNo" value={orderNo} />
          <div className="space-y-1.5">
            <Label htmlFor="pay-email">下单邮箱</Label>
            <Input id="pay-email" name="email" type="email" required placeholder="you@example.com" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="outline" disabled={resumePending} className="flex-1">
              {resumePending ? "处理中…" : "重新发起支付"}
            </Button>
          </div>
        </form>
        <form action={cancelAction} className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-email">下单邮箱</Label>
            <Input id="cancel-email" name="email" type="email" required placeholder="you@example.com" />
          </div>
          <Button type="submit" variant="danger" disabled={cancelPending} className="w-full">
            {cancelPending ? "处理中…" : "确认取消订单"}
          </Button>
        </form>
        {cancelState ? (
          <div className="mt-3">
            <Flash ok={cancelState.ok ? cancelState.message : undefined} err={cancelState.ok ? undefined : cancelState.message} />
          </div>
        ) : null}
      </details>
    </div>
  );
}
