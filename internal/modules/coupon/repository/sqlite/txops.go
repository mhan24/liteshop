package sqlite

import "database/sql"

// TxOps 事务内优惠券回滚适配器：供订单等模块以端口方式注入，
// 避免跨模块直接 import 本仓储实现。
type TxOps struct{}

// NewTxOps 返回事务优惠券操作适配器。
func NewTxOps() *TxOps {
	return &TxOps{}
}

func (TxOps) RefundByOrderNoTx(tx *sql.Tx, orderNo string) (bool, error) {
	return RefundByOrderNoTx(tx, orderNo)
}
