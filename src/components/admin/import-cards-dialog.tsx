"use client";

import { useState } from "react";
import { importCardsAction } from "@/actions/admin";
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

export function ImportCardsDialog({
  csrf,
  productId,
  children,
}: {
  csrf: string;
  productId: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>批量导入卡密</DialogTitle>
          <DialogDescription>一行一张；同一内容可导入多张（允许重复销售，适合测试）。</DialogDescription>
        </DialogHeader>
        <form action={importCardsAction} className="space-y-4">
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="productId" value={productId} />
          <div className="space-y-1.5">
            <Label htmlFor="cards-content">卡密内容</Label>
            <Textarea
              id="cards-content"
              name="content"
              rows={10}
              required
              placeholder={"CARD-0001-AAAA\nCARD-0002-BBBB\nCARD-0003-CCCC"}
              className="font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit">导入</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
