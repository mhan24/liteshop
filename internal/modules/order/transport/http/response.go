package http

import (
	inventorydomain "shop/internal/modules/inventory/domain"
	orderdomain "shop/internal/modules/order/domain"
)

// orderResponse HTTP 响应模型（显式字段，绝不携带内部备注/卡密等非契约字段）。
type orderResponse struct {
	ID                 int64  `json:"id"`
	OrderNo            string `json:"order_no"`
	ProductID          int64  `json:"product_id"`
	ProductName        string `json:"product_name"`
	Qty                int    `json:"qty"`
	AmountCents        int64  `json:"amount_cents"`
	Fiat               string `json:"fiat"`
	TradeType          string `json:"trade_type"`
	PaymentGateway     string `json:"payment_gateway"`
	PaymentGatewayName string `json:"payment_gateway_name"`
	BuyerContact       string `json:"buyer_contact,omitempty"`
	Status             string `json:"status"`
	PaymentStatus      string `json:"payment_status"`
	TradeID            string `json:"trade_id,omitempty"`
	PaymentURL         string `json:"payment_url,omitempty"`
	BlockTransactionID string `json:"block_transaction_id,omitempty"`
	DeliveryType       string `json:"delivery_type"`
	DeliveryContent    string `json:"delivery_content,omitempty"`
	CreatedAt          int64  `json:"created_at"`
	UpdatedAt          int64  `json:"updated_at"`
	PaidAt             int64  `json:"paid_at"`
}

// toOrderResponse 领域对象 → HTTP 响应（网关显示名由 settings 应用提供）。
func (h *Handlers) toOrderResponse(o orderdomain.Order) orderResponse {
	return orderResponse{
		ID: o.ID, OrderNo: o.OrderNo, ProductID: o.ProductID, ProductName: o.ProductName,
		Qty: o.Qty, AmountCents: o.AmountCents, Fiat: o.Fiat, TradeType: o.TradeType,
		PaymentGateway: o.PaymentGateway, PaymentGatewayName: h.deps.Settings.GatewayDisplayName(o.PaymentGateway),
		BuyerContact: o.BuyerContact, Status: string(o.Status), PaymentStatus: string(o.PaymentStatus),
		TradeID: o.TradeID, PaymentURL: o.PaymentURL, BlockTransactionID: o.BlockTransactionID,
		DeliveryType: o.DeliveryType, DeliveryContent: o.DeliveryContent,
		CreatedAt: o.CreatedAt, UpdatedAt: o.UpdatedAt, PaidAt: o.PaidAt,
	}
}

// Public 未校验归属时的脱敏视图（清空买家邮箱/支付地址/交易号/发货内容）。
func (r orderResponse) Public() orderResponse {
	r.BuyerContact = ""
	r.PaymentURL = ""
	r.TradeID = ""
	r.BlockTransactionID = ""
	r.DeliveryContent = ""
	return r
}

// cardResponse 卡密响应模型。
type cardResponse struct {
	ID            int64  `json:"id"`
	ProductID     int64  `json:"product_id"`
	ReservedOrder int64  `json:"reserved_order"`
	SoldOrder     int64  `json:"sold_order"`
	Content       string `json:"content"`
	Status        string `json:"status"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
	SoldAt        int64  `json:"sold_at"`
}

func toCardResponse(c inventorydomain.Card) cardResponse {
	return cardResponse{
		ID: c.ID, ProductID: c.ProductID, ReservedOrder: c.ReservedOrder, SoldOrder: c.SoldOrder,
		Content: c.Content, Status: c.Status, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt, SoldAt: c.SoldAt,
	}
}

// createOrderResponse 下单响应。
type createOrderResponse struct {
	OrderNo    string `json:"order_no"`
	PaymentURL string `json:"payment_url"`
	Token      string `json:"token"`
}

// linksResponse 发送查看链接响应。
type linksResponse struct {
	OK   bool `json:"ok"`
	Sent int  `json:"sent,omitempty"`
}

// orderEventResponse 订单日志响应模型。
type orderEventResponse struct {
	ID        int64  `json:"id"`
	Event     string `json:"event"`
	Message   string `json:"message"`
	From      string `json:"from"`
	To        string `json:"to"`
	AdminID   int64  `json:"admin_id"`
	Metadata  string `json:"metadata"`
	CreatedAt int64  `json:"created_at"`
}

func toOrderEventResponse(e orderdomain.OrderEvent) orderEventResponse {
	return orderEventResponse{
		ID: e.ID, Event: e.Event, Message: e.Message, From: e.From, To: e.To,
		AdminID: e.AdminID, Metadata: e.Metadata, CreatedAt: e.CreatedAt,
	}
}
