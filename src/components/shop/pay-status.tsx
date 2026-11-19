"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { cancelOrderAction, resumePaymentAction } from "@/actions/shop";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Flash } from "@/components/admin/flash-view";

/** 待支付页：状态轮询 + 重新发起支付 / 取消订单（都要下单邮箱 + 查单密码） */
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
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
        >
          继续付款
        </a>
      ) : null}

      {resumeState ? (
        <Flash
          ok={resumeState.ok ? resumeState.message : undefined}
          err={resumeState.ok ? undefined : resumeState.message}
        />
      ) : null}

      {resumeState?.ok && resumeState.data?.paymentUrl ? (
        <a
          href={resumeState.data.paymentUrl}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
        >
          打开新的收银台
        </a>
      ) : null}

      <details className="faq-item rounded-lg border border-line px-4">
        <summary>收银台打不开，或想取消订单</summary>
        <div className="space-y-5 pb-4">
          <form action={resumeAction} className="space-y-3 border-t border-line pt-4">
            <input type="hidden" name="orderNo" value={orderNo} />
            <p className="text-xs leading-5 text-muted">
              收银台过期或没打开时，验证邮箱与查单密码后可重新建一笔支付。旧交易会被作废，请不要再向旧交易付款。
            </p>
            <BuyerFields idPrefix="pay" />
            <Button type="submit" variant="outline" disabled={resumePending} className="w-full">
              {resumePending ? "处理中…" : "重新发起支付"}
            </Button>
          </form>

          <form action={cancelAction} className="space-y-3 border-t border-line pt-4">
            <input type="hidden" name="orderNo" value={orderNo} />
            <BuyerFields idPrefix="cancel" />
            <Button type="submit" variant="danger" disabled={cancelPending} className="w-full">
              {cancelPending ? "处理中…" : "取消订单"}
            </Button>
            <p className="text-xs leading-5 text-muted">取消后卡密立即退回库存，订单不可恢复。</p>
          </form>

          {cancelState ? (
            <Flash
              ok={cancelState.ok ? cancelState.message : undefined}
              err={cancelState.ok ? undefined : cancelState.message}
            />
          ) : null}
        </div>
      </details>
    </div>
  );
}

function BuyerFields({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-email`}>下单邮箱</Label>
        <Input id={`${idPrefix}-email`} name="email" type="email" required placeholder="you@example.com" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-password`}>查单密码</Label>
        <Input
          id={`${idPrefix}-password`}
          name="password"
          required
          autoComplete="off"
          placeholder="下单时显示的 8 位密码"
          className="font-mono uppercase"
        />
      </div>
    </>
  );
}
