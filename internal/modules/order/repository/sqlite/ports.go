package sqlite

import (
	"database/sql"

	inventorydomain "shop/internal/modules/inventory/domain"
)

// CardTxOps 事务内卡密操作端口：SQL 实现归 inventory 模块，由组合根注入。
// order 仓储只编排订单事务（保证状态与卡密同事务提交/回滚），不直接写 cards 表。
type CardTxOps interface {
	ReserveCardsTx(tx *sql.Tx, orderID, productID int64, quantity int) (int64, error)
	ConfirmReservationTx(tx *sql.Tx, orderID int64) (int64, error)
	ReleaseReservationTx(tx *sql.Tx, orderID int64) (int64, error)
	CardsByOrderTx(tx *sql.Tx, orderID int64) ([]inventorydomain.Card, error)
}

// CouponTxOps 事务内优惠券回滚端口：SQL 实现归 coupon 模块，由组合根注入。
// order 仓储不直接操作 coupons / coupon_usages 表。
type CouponTxOps interface {
	RefundByOrderNoTx(tx *sql.Tx, orderNo string) (bool, error)
}
