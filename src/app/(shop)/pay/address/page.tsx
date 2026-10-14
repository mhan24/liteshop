import { hasOrderAccess } from "@/server/order/access";
import { getOrderStatusView } from "@/server/order/query-order";
import { getCurrentAttempt } from "@/server/payment/attempts";
import { parseLitepayPaymentTarget } from "@/server/payment/litepay";
import { getSupportUrl, getTurnstileClientConfig } from "@/server/settings";
import { getCopy } from "@/server/copy";
import { CopyField } from "@/components/shop/copy-field";
import { OrderStatusPoll } from "@/components/shop/order-status-poll";
import { OrderAccessGate } from "@/components/shop/order-access-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "支付订单" };

/**
 * 交易所转账收银页（litepay 渠道）。
 *
 * LitePay 不提供托管收银台，只返回交易所 ID 与指定金额，
 * 因此由本站展示站内转账指引，并轮询订单状态直至到账。
 *
 * 数据来源：订单当前有效支付尝试落库的网关响应快照（`payment_attempts.raw`），
 * 服务端读取，不接受 URL 传入地址——避免买家被诱导转到被篡改的收款地址。
 */
export default async function PayAddressPage({
  searchParams,
}: {
  searchParams: Promise<{ order_no?: string }>;
}) {
  const { order_no: orderNo } = await searchParams;
  const accessible = orderNo ? await hasOrderAccess(orderNo) : false;
  const view = accessible && orderNo ? getOrderStatusView(orderNo) : null;

  // 仅在待支付阶段展示收款信息：已支付/已关闭的订单再显示目标会诱导重复转账
  const showTarget = view?.status === "pending" || view?.status === "reconciling";
  const attempt = accessible && showTarget && orderNo ? getCurrentAttempt(orderNo) : undefined;
  const target = attempt?.raw ? parseLitepayPaymentTarget(attempt.raw) : null;
  const isExchangeID = target?.method === "exchange_id";
  const exchangeName = target?.provider === "binance" ? "币安" : target?.provider === "okx" ? "OKX" : "交易所";

  const turnstile = getTurnstileClientConfig();
  const support = { url: getSupportUrl(), label: getCopy("support_label") };

  return (
    <main
      className="mx-auto max-w-2xl px-4 py-20"
      style={{
        backgroundImage:
          "radial-gradient(500px 200px at 80% 0%, rgba(180,160,120,0.05), transparent)",
      }}
    >
      {view && showTarget && target ? (
        <section className="mb-8">
          <h1 className="mb-1 text-lg font-semibold">{isExchangeID ? "请在交易所内转账" : "请按以下信息完成转账"}</h1>
          <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
            {isExchangeID
              ? `请在${exchangeName} App 内向下方 ID 发起站内转账，并填写完全一致的指定金额。系统按站内转账记录确认到账。`
              : "请使用交易所或钱包向下方地址转账指定金额。金额不一致将无法自动识别到账，请勿多转或少转。"}
          </p>

          <div className="space-y-3">
            <CopyField
              label={
                isExchangeID
                  ? `${exchangeName} ID`
                  : `收款地址${target.network ? `（${target.network}）` : ""}`
              }
              value={target.address}
              emphasis
              hint={
                isExchangeID
                  ? `请确认收款 ID 为此 ${exchangeName} ID，并在${exchangeName} App 内使用站内转账。`
                  : "请务必使用与上方网络一致的链转账，跨链转账会导致资产丢失。"
              }
            />
            {target.memo ? (
              <CopyField
                label="备注 / Memo（必填）"
                value={target.memo}
                hint="该币种需要同时填写备注，缺失备注将无法入账。"
              />
            ) : null}
            {target.amount ? (
              <CopyField
                label="转账金额（必须完全一致）"
                value={`${target.amount}${target.currency ? ` ${target.currency}` : ""}`}
              />
            ) : null}
          </div>

          {view.expiresAtText ? (
            <p className="mt-4 text-xs text-muted-foreground">
              请在 {view.expiresAtText} 前完成转账，超时后订单将关闭。
            </p>
          ) : null}
        </section>
      ) : null}

      <OrderStatusPoll
        orderNo={orderNo ?? ""}
        turnstile={turnstile}
        payCTA={false}
        support={support}
        accessGate={
          view ? undefined : (
            <OrderAccessGate
              orderNo={orderNo ?? ""}
              turnstile={turnstile.enabled ? turnstile : undefined}
            />
          )
        }
        initial={
          view
            ? {
                orderNo: view.orderNo,
                status: view.status,
                statusLabel: view.statusLabel,
                productName: view.productName,
                quantity: view.quantity,
                total: view.totalFormatted,
                emailMasked: view.emailMasked,
                paymentUrl: view.paymentUrl,
                expiresAtText: view.expiresAtText,
                productSlug: view.productSlug,
                canRepurchase: view.canRepurchase,
                repurchaseBlockedReason: view.repurchaseBlockedReason,
              }
            : null
        }
      />
    </main>
  );
}
