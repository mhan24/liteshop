package sqlite

// orderRow 数据库行结构（与领域对象解耦：字段变化不直接污染业务层）。
type orderRow struct {
	ID                 int64
	OrderNo            string
	ProductID          int64
	ProductName        string
	Qty                int
	AmountCents        int64
	CostCents          int64
	CostSnapshotSource string
	Fiat               string
	TradeType          string
	PaymentGateway     string
	BuyerContact       string
	ViewToken          string
	Status             string
	PaymentStatus      string
	TradeID            string
	PaymentURL         string
	BlockTransactionID string
	DeliveryType       string
	DeliveryContent    string
	CreatedAt          int64
	UpdatedAt          int64
	PaidAt             int64
}
