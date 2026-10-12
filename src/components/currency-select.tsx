"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currencySymbol, SUPPORTED_CURRENCIES } from "@/lib/money";

/** 币种下拉（USD/CNY/EUR/GBP/JPY）：服务端页面可直接使用，onValueChange 可选 */
export function CurrencySelect({
  name,
  defaultValue,
  value,
  onValueChange,
  id,
}: {
  name: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  id?: string;
}) {
  const isControlled = value !== undefined && onValueChange !== undefined;
  return (
    <Select
      name={name}
      defaultValue={isControlled ? undefined : (defaultValue ?? "USD")}
      value={isControlled ? value : undefined}
      onValueChange={isControlled ? onValueChange : undefined}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_CURRENCIES.map((c) => (
          <SelectItem key={c} value={c}>
            {c}（{currencySymbol(c)}）
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
