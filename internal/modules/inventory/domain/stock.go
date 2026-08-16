package domain

// StockCount 商品库存数量（available/reserved/sold）。
// 库存领域类型归 inventory 模块 domain 层，仓储/应用层共用。
type StockCount struct {
	Available int
	Reserved  int
	Sold      int
}
