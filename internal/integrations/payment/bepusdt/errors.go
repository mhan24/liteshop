package bepusdt

import (
	"strings"

	orderapp "shop/internal/modules/order/application"
)

// normalizeStatus 把 BEpusdt 原始回调状态归一化为内部支付状态。
// BEpusdt 状态值：2=已支付，3=已取消/关闭；其余视为待支付。
func normalizeStatus(raw string) (st orderapp.PaymentTxStatus) {
	switch strings.TrimSpace(raw) {
	case "2":
		return orderapp.PaymentTxPaid
	case "3":
		return orderapp.PaymentTxClosed
	default:
		return orderapp.PaymentTxPending
	}
}
