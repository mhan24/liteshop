package service

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"shop/internal/db/repository"
	"shop/internal/models"
	"shop/internal/payment"
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
type OrderService struct {
	repo  *repository.OrderRepository
	keys  *repository.KeyRepository
	payFn func() *payment.Client
	cfgFn func() PaymentConfig

	// 通知回调（由装配层注入，避免 service ↔ notify/jobs 循环依赖）。
	SendPaid          func(order models.Order, cards []models.Card)
	OnOrderCreated    func(order models.Order)
	OnPaymentSuccess  func(order models.Order, cards []models.Card)
	OnDelivered       func(order models.Order, cards []models.Card)
	OnLowStock        func(productID int64, productName string, available, threshold int)
	OnSystemError     func(msg string)
	SendLinks         func(contact string, links []string) error
	LowStockThreshold func() int
}

// BusinessError 表示可安全展示给买家的业务错误（如券码无效、库存不足）。
// 其余错误视为系统错误，由上层统一脱敏。
type BusinessError struct{ msg string }

func (e *BusinessError) Error() string { return e.msg }

func newBusinessErrorf(format string, args ...any) error {
	return &BusinessError{msg: fmt.Sprintf(format, args...)}
}

// wrapCouponError 仅将已知优惠券业务错误转为可回显的业务错误；
// 数据库等系统错误透传，由上层统一脱敏。
func wrapCouponError(err error) error {
	switch {
	case errors.Is(err, repository.ErrCouponNotFound), errors.Is(err, repository.ErrCouponExpired),
		errors.Is(err, repository.ErrCouponUsedUp), errors.Is(err, repository.ErrCouponNotApplicable):
		return newBusinessErrorf("%s", err.Error())
	}
	return err
}

func NewOrderService(repo *repository.OrderRepository, payFn func() *payment.Client, cfgFn func() PaymentConfig) *OrderService {
	return &OrderService{repo: repo, payFn: payFn, cfgFn: cfgFn}
}

// SetKeyRepository 注入卡密仓储（低库存检查用）。
func (s *OrderService) SetKeyRepository(keys *repository.KeyRepository) {
	s.keys = keys
}

// ExpireStale 清理长时间停留 created / waiting_payment 的订单（释放卡密并回滚优惠券）。
// 用作进程崩溃/异常中断后的补偿清理。返回处理的订单数。
func (s *OrderService) ExpireStale(timeoutSec int) (int, error) {
	if timeoutSec <= 0 {
		timeoutSec = 3600
	}
	cutoff := models.Now() - int64(timeoutSec)
	orders, err := s.repo.ListOrders(
		`status IN ('created','waiting_payment') AND created_at < ?`,
		[]any{cutoff}, 100,
	)
	if err != nil {
		return 0, err
	}
	expired := 0
	for _, o := range orders {
		if err := s.Expire(o.ID); err != nil {
			continue
		}
		expired++
	}
	return expired, nil
}

func (s *OrderService) cfg() PaymentConfig {
	if s.cfgFn != nil {
		return s.cfgFn()
	}
	return PaymentConfig{}
}

// CreateOrder 创建订单并生成 BEpusdt 交易。
// 支持批发价（阶梯折扣）与优惠券（couponCode 可空）。
// 返回订单号、支付地址、优惠券抵扣金额（分）、优惠券 ID（0=未用）、错误。
func (s *OrderService) CreateOrder(p models.Product, qty int, contact, tradeType, couponCode string) (string, string, int64, int64, error) {
	if qty <= 0 {
		qty = 1
	}
	// 批发价：按数量匹配最高档折扣
	baseCents := p.PriceCents
	if p.MinQty < 1 {
		p.MinQty = 1
	}
	if qty < p.MinQty {
		return "", "", 0, 0, newBusinessErrorf("最少购买 %d 件", p.MinQty)
	}
	if p.MaxQty > 0 && qty > p.MaxQty {
		return "", "", 0, 0, newBusinessErrorf("最多购买 %d 件", p.MaxQty)
	}
	amountCents := baseCents * int64(qty)
	bestMinQty := 0
	bestDiscount := 100 // 默认无折扣
	for _, tier := range p.Wholesale {
		if tier.MinQty < 1 || tier.Discount < 1 || tier.Discount > 100 {
			continue
		}
		if qty >= tier.MinQty && tier.MinQty > bestMinQty {
			bestMinQty = int(tier.MinQty)
			bestDiscount = int(tier.Discount)
		}
	}
	if bestDiscount != 100 {
		amountCents = baseCents * int64(qty) * int64(bestDiscount) / 100
	}
	// 优惠券
	// 券码统一大写（创建时已大写存储），避免大小写不匹配。
	couponCode = strings.ToUpper(strings.TrimSpace(couponCode))
	discount := int64(0)
	couponID := int64(0)
	if couponCode != "" {
		var cidErr error
		couponID, cidErr = s.repo.GetCouponIDByCode(couponCode)
		if cidErr != nil {
			return "", "", 0, 0, wrapCouponError(cidErr)
		}
		d, err := s.repo.ApplyCoupon(couponCode, amountCents, p.ID)
		if err != nil {
			return "", "", 0, 0, wrapCouponError(err)
		}
		discount = d
		amountCents -= discount
		// 100% 折扣券（或等额固定券）抵扣后金额为 0，走"零金额直接完成"路径。
		if amountCents < 0 {
			amountCents = 0
		}
	}
	now := models.Now()
	order := models.Order{
		OrderNo:            models.NewOrderNo(),
		ProductID:          p.ID,
		ProductName:        p.Name,
		Qty:                qty,
		AmountCents:        amountCents,
		CostCents:          p.CostCents,
		CostSnapshotSource: "order_time",
		Fiat:               s.cfg().Fiat,
		TradeType:          tradeType,
		BuyerContact:       contact,
		ViewToken:          models.RandomToken(24),
		Status:             models.OrderCreated,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := s.repo.CreatePendingOrder(&order); err != nil {
		var insufficient *repository.InsufficientError
		if errors.As(err, &insufficient) {
			return "", "", 0, 0, newBusinessErrorf("库存不足，请刷新后重试")
		}
		return "", "", 0, 0, err
	}
	_ = s.repo.AddLog(order.ID, "order_created", "订单已创建", "", models.OrderCreated, 0)
	if discount > 0 {
		if err := s.repo.UseCoupon(couponID, order.OrderNo, discount); err != nil {
			_ = s.repo.ReleaseLockedCards(order.ID)
			_ = s.repo.SetOrderStatus(order.ID, models.OrderPaymentFailed)
			_ = s.repo.AddLog(order.ID, "coupon_failed", "优惠券占用失败: "+err.Error(), models.OrderCreated, models.OrderPaymentFailed, 0)
			return order.OrderNo, "", 0, 0, wrapCouponError(err)
		}
		_ = s.repo.AddLog(order.ID, "coupon_used", fmt.Sprintf("优惠券抵扣 %d 分", discount), "", models.OrderCreated, 0)
	}
	// 零金额订单：跳过 BEpusdt 支付，直接置为已支付并发卡。
	if order.AmountCents == 0 {
		now := models.Now()
		delivered, err := s.repo.CompleteFreeOrder(order.ID, now)
		if err != nil {
			return order.OrderNo, "", 0, 0, err
		}
		order.Status = models.OrderPaid
		order.PaidAt = now
		_ = s.repo.AddLog(order.ID, "payment_success", "免费订单（100% 折扣）直接完成", models.OrderCreated, models.OrderPaid, 0)
		cards, _ := s.repo.GetOrderCards(order.ID)
		if delivered == 0 || len(cards) == 0 {
			_ = s.repo.SetOrderStatus(order.ID, models.OrderDeliveryFailed)
			_ = s.repo.AddLog(order.ID, "delivery_failed", "发卡失败：无可用卡密", models.OrderPaid, models.OrderDeliveryFailed, 0)
			return order.OrderNo, "", discount, couponID, ErrNoCards
		}
		_ = s.repo.SetOrderStatus(order.ID, models.OrderDelivered)
		_ = s.repo.AddLog(order.ID, "delivered", "卡密已发放", models.OrderPaid, models.OrderDelivered, 0)
		if s.SendPaid != nil {
			go s.SendPaid(order, cards)
		}
		s.fireCreatedEvents(order)
		return order.OrderNo, "", discount, couponID, nil
	}
	cfg := s.cfg()
	// 订单页凭查看令牌访问（不再把买家邮箱放进跳转 URL）。
	redirectURL := cfg.PublicBaseURL + "/order/" + order.OrderNo + "?token=" + order.ViewToken
	paymentURL, tradeID, err := s.payFn().CreateTransaction(payment.CreateInput{
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
		// 回滚优惠券用量（支付失败，券不应被消耗）
		if discount > 0 {
			if refunded, err := s.repo.RefundByOrderNo(order.OrderNo); err != nil {
				_ = s.repo.AddLog(order.ID, "coupon_refund_failed", "优惠券回滚失败: "+err.Error(), models.OrderPaymentFailed, models.OrderPaymentFailed, 0)
			} else if !refunded {
				_ = s.repo.AddLog(order.ID, "coupon_refund_missing", "支付失败但未找到优惠券使用记录", models.OrderPaymentFailed, models.OrderPaymentFailed, 0)
			}
		}
		return order.OrderNo, "", discount, couponID, err
	}
	_ = s.repo.SetTradeInfo(order.ID, tradeID, paymentURL)
	_ = s.repo.SetOrderStatus(order.ID, models.OrderWaitingPayment)
	_ = s.repo.AddLog(order.ID, "transaction_created", "BEpusdt 交易已创建", models.OrderCreated, models.OrderWaitingPayment, 0)
	s.fireCreatedEvents(order)
	return order.OrderNo, paymentURL, discount, couponID, nil
}

// MarkPaidAndDeliver 处理支付成功回调：置为 paid 并发卡。
// 返回订单、卡密、是否发生变更。
func (s *OrderService) MarkPaidAndDeliver(orderNo, tradeID, blockTx string) (models.Order, []models.Card, bool, error) {
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
	delivered, err := s.repo.MarkPaidAndDeliver(o.ID, tradeID, blockTx, now)
	if err != nil {
		return o, nil, false, err
	}
	o.Status = models.OrderPaid
	o.TradeID = tradeID
	o.BlockTransactionID = blockTx
	o.PaidAt = now
	_ = s.repo.AddLog(o.ID, "payment_success", "支付成功", models.OrderWaitingPayment, models.OrderPaid, 0)
	cards, _ := s.repo.GetOrderCards(o.ID)
	if delivered == 0 || len(cards) == 0 {
		_ = s.repo.SetOrderStatus(o.ID, models.OrderDeliveryFailed)
		_ = s.repo.AddLog(o.ID, "delivery_failed", "发卡失败：无可用卡密", models.OrderPaid, models.OrderDeliveryFailed, 0)
		return o, nil, false, ErrNoCards
	}
	_ = s.repo.SetOrderStatus(o.ID, models.OrderDelivered)
	_ = s.repo.AddLog(o.ID, "delivered", "卡密已发放", models.OrderPaid, models.OrderDelivered, 0)
	if s.SendPaid != nil {
		// 异步发送，避免支付回调被 SMTP/Telegram 网络耗时阻塞（BEpusdt 应答超时重试）。
		go s.SendPaid(o, cards)
	}
	s.fireOrderEvents(o, cards)
	return o, cards, true, nil
}

// fireOrderEvents 支付成功/发货事件通知（模板事件：payment_success / delivered）。
func (s *OrderService) fireOrderEvents(order models.Order, cards []models.Card) {
	if s.OnPaymentSuccess != nil {
		go s.OnPaymentSuccess(order, cards)
	}
	if s.OnDelivered != nil {
		go s.OnDelivered(order, cards)
	}
}

// fireCreatedEvents 订单创建事件 + 低库存检查。
func (s *OrderService) fireCreatedEvents(order models.Order) {
	if s.OnOrderCreated != nil {
		go s.OnOrderCreated(order)
	}
	if s.OnLowStock != nil && s.keys != nil {
		if remain, err := s.keys.AvailableCount(order.ProductID); err == nil {
			threshold := 10
			if s.LowStockThreshold != nil {
				threshold = s.LowStockThreshold()
			}
			go s.OnLowStock(order.ProductID, order.ProductName, remain, threshold)
		}
	}
}

// ---- 查询（handler 只经服务访问仓储） ----

func (s *OrderService) GetOrderByNo(orderNo string) (models.Order, error) {
	return s.repo.GetOrderByNo(orderNo)
}

func (s *OrderService) GetOrderByID(id int64) (models.Order, error) {
	return s.repo.GetOrderByID(id)
}

func (s *OrderService) GetOrderCards(id int64) ([]models.Card, error) {
	return s.repo.GetOrderCards(id)
}

func (s *OrderService) GetOrderStatus(id int64) (string, error) {
	return s.repo.GetOrderStatus(id)
}

func (s *OrderService) OrdersByContact(contact string, limit int) ([]models.Order, error) {
	return s.repo.OrdersByContact(contact, limit)
}

func (s *OrderService) ListOrders(where string, args []any, limit int) ([]models.Order, error) {
	return s.repo.ListOrders(where, args, limit)
}

func (s *OrderService) Logs(orderID int64) ([]models.OrderEvent, error) {
	return s.repo.Logs(orderID)
}

func (s *OrderService) AddLog(orderID int64, event, message, from, to string, adminID int64) error {
	return s.repo.AddLog(orderID, event, message, from, to, adminID)
}

// ---- 网关联动 ----

// CancelWithGateway 取消订单并同步关闭 BEpusdt 交易（失败不阻塞本地取消）。
func (s *OrderService) CancelWithGateway(orderID int64) error {
	s.cancelGatewayTx(orderID)
	return s.Cancel(orderID)
}

// ExpireWithGateway 过期订单并同步关闭 BEpusdt 交易。
func (s *OrderService) ExpireWithGateway(orderID int64) error {
	s.cancelGatewayTx(orderID)
	return s.Expire(orderID)
}

// HandleGatewayCancel 处理 BEpusdt 侧取消回调（status=3）。
func (s *OrderService) HandleGatewayCancel(orderNo string) {
	o, err := s.repo.GetOrderByNo(orderNo)
	if err != nil {
		return
	}
	s.cancelGatewayTx(o.ID)
	_ = s.Expire(o.ID)
}

func (s *OrderService) cancelGatewayTx(orderID int64) {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil || o.TradeID == "" {
		return
	}
	go func(tradeID string) {
		_ = s.payFn().CancelTransaction(tradeID)
	}(o.TradeID)
}

// ---- 重发 ----

func resendableStatus(status string) bool {
	switch status {
	case models.OrderPaid, models.OrderProcessing, models.OrderDelivered, models.OrderCompleted, models.OrderDeliveryFailed:
		return true
	}
	return false
}

// Resend 重发单个订单的发卡通知。
func (s *OrderService) Resend(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if !resendableStatus(o.Status) {
		return nil
	}
	cards, _ := s.repo.GetOrderCards(o.ID)
	if len(cards) == 0 {
		return nil
	}
	if s.SendPaid != nil {
		go s.SendPaid(o, cards)
	}
	_ = s.repo.AddLog(o.ID, "resend", "管理员重新发送卡密", o.Status, o.Status, 0)
	return nil
}

// BatchResend 批量重发（已支付且有卡密的订单）。
func (s *OrderService) BatchResend(ids []int64) (int, error) {
	sent := 0
	for _, id := range ids {
		o, err := s.repo.GetOrderByID(id)
		if err != nil || !resendableStatus(o.Status) {
			continue
		}
		cards, _ := s.repo.GetOrderCards(o.ID)
		if len(cards) == 0 {
			continue
		}
		if s.SendPaid != nil {
			go s.SendPaid(o, cards)
		}
		_ = s.repo.AddLog(o.ID, "resend", "批量重发卡密", o.Status, o.Status, 0)
		sent++
	}
	return sent, nil
}

// SendViewLinks 将订单查看链接发送到登记邮箱。返回发送条数（0=无订单）。
func (s *OrderService) SendViewLinks(contact string) (int, error) {
	orders, err := s.repo.OrdersByContact(contact, 10)
	if err != nil {
		return 0, err
	}
	base := strings.TrimRight(s.cfg().PublicBaseURL, "/")
	links := []string{}
	for _, o := range orders {
		link := base + "/order/" + o.OrderNo + "?token=" + o.ViewToken
		links = append(links, o.ProductName+" x"+strconv.Itoa(o.Qty)+": "+link)
	}
	if len(links) == 0 {
		return 0, nil
	}
	if s.SendLinks == nil {
		return 0, errors.New("邮件发送未配置")
	}
	if err := s.SendLinks(contact, links); err != nil {
		return 0, err
	}
	return len(links), nil
}

// ---- 优惠券 ----

func (s *OrderService) ListCoupons() ([]models.Coupon, error) {
	return s.repo.ListCoupons()
}

func (s *OrderService) CreateCoupon(c models.Coupon) error {
	return s.repo.CreateCoupon(c)
}

func (s *OrderService) UpdateCoupon(c models.Coupon) error {
	return s.repo.UpdateCoupon(c)
}

func (s *OrderService) DeleteCoupon(id int64) error {
	return s.repo.DeleteCoupon(id)
}

// ErrNoCards 表示订单已支付但发卡数量为 0（需管理员处理）。
var ErrNoCards = errors.New("order paid but no cards delivered")

// Cancel 取消订单（释放卡密）。
func (s *OrderService) Cancel(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if _, changed, err := s.repo.CancelOrder(orderID); err != nil {
		return err
	} else if !changed {
		return fmt.Errorf("invalid order state for cancel: %s", o.Status)
	}
	_ = s.repo.AddLog(orderID, "cancelled", "订单已取消", o.Status, models.OrderCancelled, 0)
	return nil
}

// Expire 过期订单（释放卡密）。
func (s *OrderService) Expire(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if _, changed, err := s.repo.ExpireOrder(orderID); err != nil {
		return err
	} else if !changed {
		return fmt.Errorf("invalid order state for expire: %s", o.Status)
	}
	_ = s.repo.AddLog(orderID, "expired", "订单已过期", o.Status, models.OrderExpired, 0)
	return nil
}

// Redeliver 补发卡密（发卡失败订单）。
func (s *OrderService) Redeliver(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	switch o.Status {
	case models.OrderPaid, models.OrderProcessing, models.OrderDeliveryFailed,
		models.OrderDelivered, models.OrderCompleted:
		// 允许补发/确认
	default:
		return fmt.Errorf("订单状态 %s 不允许补发卡密", o.Status)
	}
	cards, _ := s.repo.GetOrderCards(o.ID)
	if len(cards) > 0 {
		if o.Status != models.OrderDelivered && o.Status != models.OrderCompleted {
			_ = s.repo.SetOrderStatus(o.ID, models.OrderDelivered)
			_ = s.repo.AddLog(o.ID, "delivered", "管理员手动确认发卡", o.Status, models.OrderDelivered, 0)
		}
		if s.SendPaid != nil {
			go s.SendPaid(o, cards)
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
		go s.SendPaid(o, cards)
	}
	return nil
}

// SetStatus 手动修改订单状态。
func (s *OrderService) SetStatus(orderID int64, to, message string) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if o.Status == to {
		return nil
	}
	// 取消/过期必须走原子流程（释放卡密 + 回滚优惠券），不能直接改状态。
	switch to {
	case models.OrderCancelled:
		return s.Cancel(orderID)
	case models.OrderExpired:
		return s.Expire(orderID)
	}
	// 发卡失败订单的"确认已发"应走补发流程（校验卡密）。
	if o.Status == models.OrderDeliveryFailed && to == models.OrderDelivered {
		return s.Redeliver(orderID)
	}
	if !models.IsValidOrderTransition(o.Status, to) {
		return fmt.Errorf("invalid order transition %s -> %s", o.Status, to)
	}
	_ = s.repo.SetOrderStatus(orderID, to)
	_ = s.repo.AddLog(orderID, "status_changed", message, o.Status, to, 0)
	return nil
}

// Repository 暴露给上层查询。
func (s *OrderService) Repo() *repository.OrderRepository { return s.repo }
