"use client";

import { useState } from "react";
import {
  manualDeliverAction,
  retryDeliveryAction,
  closeOrderAction,
  resolveReconcilingAction,
} from "@/actions/admin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** 订单行操作：人工发货 / 重试发货 / 关闭（按钮组，按状态渲染） */
export function OrderRowActions({
  csrf,
  orderNo,
  status,
  deliveryType,
}: {
  csrf: string;
  orderNo: string;
  status: string;
  deliveryType: string;
}) {
  const [open, setOpen] = useState(false);
  const canManualDeliver = status === "paid" || status === "delivering";
  const canRetry = status === "delivering" && deliveryType === "auto";
  const canClose = status === "pending" || status === "paid" || status === "delivering" || status === "expired";
  // 待对账订单需人工核对网关后再决定是否释放库存（不得自动超时释放）
  const canResolveReconciling = status === "reconciling";

  return (
    <div className="flex items-center justify-end gap-1">
      {canManualDeliver ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">人工发货</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>人工发货 · {orderNo}</DialogTitle>
              <DialogDescription>
                录入交付内容（账号密码、兑换码等），保存后买家即可在查单页看到。
              </DialogDescription>
            </DialogHeader>
            <form action={manualDeliverAction} className="space-y-4">
              <input type="hidden" name="csrf" value={csrf} />
              <input type="hidden" name="orderNo" value={orderNo} />
              <div className="space-y-1.5">
                <Label htmlFor={`content-${orderNo}`}>交付内容</Label>
                <Textarea
                  id={`content-${orderNo}`}
                  name="content"
                  rows={6}
                  required
                  className="font-mono text-xs"
                  placeholder={"账号: xxx\n密码: xxx"}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button type="submit">确认发货</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {canRetry ? (
        <form action={retryDeliveryAction}>
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="orderNo" value={orderNo} />
          <Button type="submit" variant="outline" size="sm">
            重试发货
          </Button>
        </form>
      ) : null}

      {canResolveReconciling ? (
        <form action={resolveReconcilingAction}>
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="orderNo" value={orderNo} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            title="已核对 bepusdt 后台，确认该交易不存在，可释放库存"
          >
            确认未建单
          </Button>
        </form>
      ) : null}

      {canClose ? (
        <form action={closeOrderAction}>
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="orderNo" value={orderNo} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-pastel-red-text hover:bg-pastel-red-bg hover:text-pastel-red-text"
          >
            关闭
          </Button>
        </form>
      ) : null}
    </div>
  );
}
