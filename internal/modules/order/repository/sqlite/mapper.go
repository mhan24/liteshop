package sqlite

import "shop/internal/modules/order/domain"

// toDomain 行结构 → 领域对象（状态映射为强类型）。
func toDomain(r orderRow) domain.Order {
	return domain.Order{
		ID: r.ID, OrderNo: r.OrderNo, ProductID: r.ProductID, ProductName: r.ProductName,
		Qty: r.Qty, AmountCents: r.AmountCents, CostCents: r.CostCents,
		CostSnapshotSource: r.CostSnapshotSource, Fiat: r.Fiat, TradeType: r.TradeType,
		PaymentGateway: r.PaymentGateway, BuyerContact: r.BuyerContact, ViewToken: r.ViewToken,
		Status:             domain.Status(r.Status),
		PaymentStatus:      domain.PaymentStatus(r.PaymentStatus),
		TradeID:            r.TradeID,
		PaymentURL:         r.PaymentURL,
		BlockTransactionID: r.BlockTransactionID,
		DeliveryType:       r.DeliveryType,
		DeliveryContent:    r.DeliveryContent,
		CreatedAt:          r.CreatedAt,
		UpdatedAt:          r.UpdatedAt,
		PaidAt:             r.PaidAt,
	}
}

// fromDomain 领域对象 → 行结构（写入时使用，状态落库为字符串）。
func fromDomain(o domain.Order) orderRow {
	return orderRow{
		ID: o.ID, OrderNo: o.OrderNo, ProductID: o.ProductID, ProductName: o.ProductName,
		Qty: o.Qty, AmountCents: o.AmountCents, CostCents: o.CostCents,
		CostSnapshotSource: o.CostSnapshotSource, Fiat: o.Fiat, TradeType: o.TradeType,
		PaymentGateway: o.PaymentGateway, BuyerContact: o.BuyerContact, ViewToken: o.ViewToken,
		Status:             string(o.Status),
		PaymentStatus:      string(o.PaymentStatus),
		TradeID:            o.TradeID,
		PaymentURL:         o.PaymentURL,
		BlockTransactionID: o.BlockTransactionID,
		DeliveryType:       o.DeliveryType,
		DeliveryContent:    o.DeliveryContent,
		CreatedAt:          o.CreatedAt,
		UpdatedAt:          o.UpdatedAt,
		PaidAt:             o.PaidAt,
	}
}
