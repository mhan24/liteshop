package sqlite

import (
	"database/sql"

	inventorydomain "shop/internal/modules/inventory/domain"
)

// TxOps 事务内卡密操作适配器：供订单等模块以端口方式注入，
// 避免跨模块直接 import 本仓储实现。
type TxOps struct{}

// NewTxOps 返回事务卡密操作适配器。
func NewTxOps() *TxOps {
	return &TxOps{}
}

func (TxOps) ReserveCardsTx(tx *sql.Tx, orderID, productID int64, quantity int) (int64, error) {
	return ReserveCardsTx(tx, orderID, productID, quantity)
}

func (TxOps) ConfirmReservationTx(tx *sql.Tx, orderID int64) (int64, error) {
	return ConfirmReservationTx(tx, orderID)
}

func (TxOps) ReleaseReservationTx(tx *sql.Tx, orderID int64) (int64, error) {
	return ReleaseReservationTx(tx, orderID)
}

func (TxOps) CardsByOrderTx(tx *sql.Tx, orderID int64) ([]inventorydomain.Card, error) {
	return CardsByOrderTx(tx, orderID)
}
