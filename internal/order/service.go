package order

import (
	"fmt"

	"shop/internal/bepusdt"
	"shop/internal/models"
)

// PaymentConfig 提供支付所需配置（由 web 层实现，避免循环依赖）。
type PaymentConfig struct {
	PublicBaseURL string
	NotifyURL     string
	TimeoutSec    int
	Fiat          string
	TradeTypes    []string
}

// Service 订单业务逻辑。
type Service struct {
	repo  *Repository
	payFn func() *bepusdt.Client
	cfgFn func() PaymentConfig
	// SendPaid 发卡通知回调（注入 web 层的 notifier）。
	SendPaid func(order models.Order, cards []models.Card)
}

func NewService(repo *Repository, payFn func() *bepusdt.Client, cfgFn func() PaymentConfig) *Service {
	return &Service{repo: repo, payFn: payFn, cfgFn: cfgFn}
}

// CreateOrder 创建订单并生成 BEpusdt 交易。
// 返回订单号与支付地址。
func (s *Service) CreateOrder(p models.Product, qty int, contact, tradeType string) (string, string, error) {
	if qty <= 0 {
		qty = 1
	}
	now := models.Now()
	order := models.Order{
		OrderNo:      models.NewOrderNo(),
		ProductID:    p.ID,
		ProductName:  p.Name,
		Qty:          qty,
		AmountCents:  p.PriceCents * int64(qty),
		Fiat:         s.cfgFn().Fiat,
		TradeType:    tradeType,
		BuyerContact: contact,
		Status:       models.OrderCreated,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.repo.CreatePendingOrder(&order); err != nil {
		return "", "", err
	}
	_ = s.repo.AddLog(order.ID, "order_created", "订单已创建", "", models.OrderCreated, 0)
	cfg := s.cfgFn()
	redirectURL := cfg.PublicBaseURL + "/order/" + order.OrderNo + "?contact=" + contact
	paymentURL, tradeID, err := s.payFn().CreateTransaction(bepusdt.CreateInput{
		OrderID:     order.OrderNo,
		AmountYuan:  float64(order.AmountCents) / 100,
		Fiat:        cfg.Fiat,
		TradeType:   tradeType,
		Name:        p.Name,
		NotifyURL:   cfg.NotifyURL,
		RedirectURL: redirectURL,
		TimeoutSec:  cfg.TimeoutSec,
	})
	if err != nil {
		_ = s.repo.SetOrderStatus(order.ID, models.OrderPaymentFailed)
		_ = s.repo.AddLog(order.ID, "payment_failed", "创建 BEpusdt 交易失败: "+err.Error(), models.OrderCreated, models.OrderPaymentFailed, 0)
		return "", "", err
	}
	_ = s.repo.SetTradeInfo(order.ID, tradeID, paymentURL)
	_ = s.repo.SetOrderStatus(order.ID, models.OrderWaitingPayment)
	_ = s.repo.AddLog(order.ID, "transaction_created", "BEpusdt 交易已创建", models.OrderCreated, models.OrderWaitingPayment, 0)
	return order.OrderNo, paymentURL, nil
}

// MarkPaidAndDeliver 处理支付成功回调：置为 paid 并发卡。
// 返回订单、卡密、是否发生变更。
func (s *Service) MarkPaidAndDeliver(orderNo, tradeID, blockTx string) (models.Order, []models.Card, bool, error) {
	o, err := s.repo.GetOrderByNo(orderNo)
	if err != nil {
		return models.Order{}, nil, false, err
	}
	switch o.Status {
	case models.OrderPaid, models.OrderProcessing, models.OrderDelivered, models.OrderCompleted:
		cards, _ := s.repo.GetOrderCards(o.ID)
		return o, cards, false, nil
	case models.OrderWaitingPayment:
		// 继续
	default:
		return o, nil, false, nil
	}
	now := models.Now()
	if err := s.repo.MarkPaid(o.ID, tradeID, blockTx, now); err != nil {
		return o, nil, false, err
	}
	o.Status = models.OrderPaid
	o.TradeID = tradeID
	o.BlockTransactionID = blockTx
	o.PaidAt = now
	_ = s.repo.AddLog(o.ID, "payment_success", "支付成功", models.OrderWaitingPayment, models.OrderPaid, 0)
	// 发卡
	if err := s.repo.DeliverCards(o.ID); err != nil {
		return o, nil, false, err
	}
	cards, _ := s.repo.GetOrderCards(o.ID)
	if len(cards) == 0 {
		_ = s.repo.SetOrderStatus(o.ID, models.OrderDeliveryFailed)
		_ = s.repo.AddLog(o.ID, "delivery_failed", "发卡失败：无可用卡密", models.OrderPaid, models.OrderDeliveryFailed, 0)
		return o, nil, false, nil
	}
	_ = s.repo.SetOrderStatus(o.ID, models.OrderDelivered)
	_ = s.repo.AddLog(o.ID, "delivered", "卡密已发放", models.OrderPaid, models.OrderDelivered, 0)
	if s.SendPaid != nil {
		s.SendPaid(o, cards)
	}
	return o, cards, true, nil
}

// Cancel 取消订单（释放卡密）。
func (s *Service) Cancel(orderID int64) error {
	from, err := s.repo.GetOrderStatus(orderID)
	if err != nil {
		return err
	}
	if from != models.OrderWaitingPayment && from != models.OrderCreated {
		return fmt.Errorf("invalid order state for cancel: %s", from)
	}
	if err := s.repo.ReleaseLockedCards(orderID); err != nil {
		return err
	}
	_ = s.repo.SetOrderStatus(orderID, models.OrderCancelled)
	_ = s.repo.AddLog(orderID, "cancelled", "订单已取消", from, models.OrderCancelled, 0)
	return nil
}

// Expire 过期订单（释放卡密）。
func (s *Service) Expire(orderID int64) error {
	from, err := s.repo.GetOrderStatus(orderID)
	if err != nil {
		return err
	}
	if from != models.OrderWaitingPayment && from != models.OrderCreated {
		return nil
	}
	if err := s.repo.ReleaseLockedCards(orderID); err != nil {
		return err
	}
	_ = s.repo.SetOrderStatus(orderID, models.OrderExpired)
	_ = s.repo.AddLog(orderID, "expired", "订单已过期", from, models.OrderExpired, 0)
	return nil
}

// Redeliver 补发卡密（发卡失败订单）。
func (s *Service) Redeliver(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if o.Status == models.OrderPaymentFailed {
		return fmt.Errorf("订单未支付，无法重新发卡")
	}
	cards, _ := s.repo.GetOrderCards(o.ID)
	if len(cards) > 0 {
		if o.Status != models.OrderDelivered && o.Status != models.OrderCompleted {
			_ = s.repo.SetOrderStatus(o.ID, models.OrderDelivered)
			_ = s.repo.AddLog(o.ID, "delivered", "管理员手动确认发卡", o.Status, models.OrderDelivered, 0)
		}
		if s.SendPaid != nil {
			s.SendPaid(o, cards)
		}
		return nil
	}
	// 无预留卡密：从同商品库存补扣
	if o.ProductID <= 0 {
		return fmt.Errorf("订单缺少商品信息")
	}
	// 幂等释放旧锁定，避免残留 reserved_order 造成库存超扣/孤儿锁定
	_ = s.repo.ReleaseLockedCards(o.ID)
	affected, err := s.repo.ReserveCardsFromStock(o.ProductID, o.Qty, o.ID)
	if err != nil {
		return err
	}
	if affected != o.Qty {
		return fmt.Errorf("可用卡密不足，无法补发")
	}
	// 将新锁定的卡密真正售出
	if err := s.repo.DeliverCards(o.ID); err != nil {
		return err
	}
	cards, _ = s.repo.GetOrderCards(o.ID)
	_ = s.repo.SetOrderStatus(o.ID, models.OrderDelivered)
	_ = s.repo.AddLog(o.ID, "delivered", "管理员补发卡密", o.Status, models.OrderDelivered, 0)
	if s.SendPaid != nil {
		s.SendPaid(o, cards)
	}
	return nil
}

// SetStatus 手动修改订单状态。
func (s *Service) SetStatus(orderID int64, to, message string) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if o.Status == to {
		return nil
	}
	if o.PaidAt > 0 && (to == models.OrderCreated || to == models.OrderWaitingPayment) {
		return fmt.Errorf("已支付订单不可回退到未支付状态")
	}
	_ = s.repo.SetOrderStatus(orderID, to)
	_ = s.repo.AddLog(orderID, "status_changed", message, o.Status, to, 0)
	return nil
}

// Repository 暴露给上层查询。
func (s *Service) Repo() *Repository { return s.repo }
