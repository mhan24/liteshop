package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	orderapp "shop/internal/modules/order/application"

	orderdomain "shop/internal/modules/order/domain"
	"shop/internal/platform/httpserver"
	"shop/internal/platform/logging"
	"strings"
	"time"

	"go.uber.org/zap"
)

func (h *Handlers) CreateOrder(w http.ResponseWriter, r *http.Request) {
	var req createOrderRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	// 已配置 Turnstile 才要求人机验证（与订单查询/发送查看链接一致）。
	if h.deps.Settings.TurnstileSecret() != "" {
		if err := h.verifyTurnstile(req.TurnstileResponse, h.deps.ClientIP(r), r.Host); err != nil {
			httpserver.WriteError(w, 403, "turnstile failed")
			return
		}
	}
	if req.Qty <= 0 {
		req.Qty = 1
	}
	if !httpserver.ValidEmail(req.Contact) {
		httpserver.WriteError(w, 400, "invalid email")
		return
	}
	gateway := strings.ToLower(strings.TrimSpace(req.Gateway))
	if gateway == "" {
		gateway = h.deps.Settings.GatewayName()
	}
	if !h.deps.Settings.GatewayEnabled(gateway) {
		httpserver.WriteError(w, 400, "invalid payment gateway")
		return
	}
	payCfg := h.deps.Settings.PaymentConfig()
	if !gatewayConfigured(payCfg, gateway) {
		httpserver.WriteError(w, 400, "payment gateway not configured")
		return
	}
	tradeType := strings.TrimSpace(req.TradeType)
	if gateway == "hashpay" {
		// HashPay 收银台由买家自选网络/资产，订单上记录请求货币作为交易类型（对账用）。
		if tradeType == "" {
			tradeType = payCfg.HashPayCurrency
			if tradeType == "" {
				tradeType = "USD"
			}
		}
	} else if tradeType == "" {
		tradeType = h.deps.Settings.TradeTypes()[0]
	} else if !h.deps.Settings.TradeTypeAllowed(tradeType) {
		httpserver.WriteError(w, 400, "invalid trade type")
		return
	}
	result, err := h.deps.Orders.Create(orderapp.CreateCommand{
		ProductID: req.ProductID, Qty: req.Qty, Contact: req.Contact,
		TradeType: tradeType, Gateway: gateway, CouponCode: req.CouponCode,
	})
	if err != nil {
		h.deps.Notify.SystemError("创建支付交易失败: " + err.Error())
		logging.Payment().Warn("payment create failed",
			zap.String("request_id", logging.RequestID(r.Context())),
			zap.String("order_no", result.OrderNo),
			zap.String("trade_type", tradeType),
			zap.String("result", "error"),
			zap.String("error", err.Error()),
		)
		msg := "下单失败，请重试或联系客服"
		var biz *orderapp.BusinessError
		if errors.As(err, &biz) {
			msg = biz.Error()
		}
		if result.OrderNo != "" {
			httpserver.WriteJSON(w, 502, map[string]any{"error": msg, "order_no": result.OrderNo})
		} else {
			httpserver.WriteError(w, 502, msg)
		}
		return
	}
	if o, oerr := h.deps.Orders.GetOrderByNo(result.OrderNo); oerr == nil {
		logging.Payment().Info("payment create",
			zap.String("request_id", logging.RequestID(r.Context())),
			zap.String("order_no", result.OrderNo),
			zap.Int64("amount_cents", o.AmountCents),
			zap.String("trade_type", o.TradeType),
			zap.String("trace_id", o.TradeID),
			zap.String("result", "ok"),
		)
	}
	httpserver.WriteJSON(w, 200, createOrderResponse{OrderNo: result.OrderNo, PaymentURL: result.PaymentURL, Token: result.Token})
}

func (h *Handlers) OrdersByContact(w http.ResponseWriter, r *http.Request) {
	contact := strings.TrimSpace(r.URL.Query().Get("contact"))
	if !httpserver.ValidEmail(contact) {
		httpserver.WriteError(w, 400, "invalid email")
		return
	}
	// 已配置 Turnstile 时，邮箱查询同样要求人机验证（防枚举/防刷）。
	if h.deps.Settings.TurnstileSecret() != "" {
		if err := h.verifyTurnstile(strings.TrimSpace(r.Header.Get("X-Turnstile-Response")), h.deps.ClientIP(r), r.Host); err != nil {
			httpserver.WriteError(w, 403, "turnstile failed")
			return
		}
	}
	orders, err := h.deps.Orders.OrdersByContact(contact, 10)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, o := range orders {
		item := map[string]any{
			"order_no":        o.OrderNo,
			"product_name":    o.ProductName,
			"qty":             o.Qty,
			"amount":          fmt.Sprintf("%.2f", float64(o.AmountCents)/100),
			"fiat":            o.Fiat,
			"trade_type":      o.TradeType,
			"payment_gateway": o.PaymentGateway,
			"status":          o.Status,
			"created_at":      o.CreatedAt,
			"paid_at":         o.PaidAt,
		}
		// 订单号用于前台"勾选部分/单个重发查看链接"（发送接口校验邮箱归属后才发令牌）。
		if o.Status == orderdomain.OrderWaitingPayment {
			item["payment_url"] = o.PaymentURL
		}
		out = append(out, item)
	}
	httpserver.WriteJSON(w, 200, map[string]any{"orders": out})
}

// apiSendOrderLinks 发送查看链接到登记邮箱：
// 仅传邮箱 → 发送该邮箱下全部有效订单的链接；
// 邮箱 + 订单号 → 仅重发该订单的查看链接（校验邮箱归属，防止令牌外泄）。

func (h *Handlers) SendOrderLinks(w http.ResponseWriter, r *http.Request) {
	var req sendLinksRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	contact := strings.TrimSpace(req.Contact)
	if !httpserver.ValidEmail(contact) {
		httpserver.WriteError(w, 400, "invalid email")
		return
	}
	// 已配置 Turnstile 时同样要求人机验证。
	if h.deps.Settings.TurnstileSecret() != "" {
		if err := h.verifyTurnstile(strings.TrimSpace(r.Header.Get("X-Turnstile-Response")), h.deps.ClientIP(r), r.Host); err != nil {
			httpserver.WriteError(w, 403, "turnstile failed")
			return
		}
	}
	orderNo := strings.TrimSpace(req.OrderNo)
	orderNos := make([]string, 0, len(req.OrderNos))
	for _, n := range req.OrderNos {
		n = strings.TrimSpace(n)
		if n != "" && len(n) <= 64 {
			orderNos = append(orderNos, n)
		}
	}
	if len(orderNos) > 10 {
		httpserver.WriteError(w, 400, "一次最多选择 10 个订单")
		return
	}
	// 冷却：全部订单按邮箱限频；单订单重发按"邮箱+订单号"限频（互不阻塞）。
	now := time.Now().Unix()
	key := strings.ToLower(contact)
	if len(orderNos) > 0 {
		key += "|batch:" + strings.Join(orderNos, ",")
	} else if orderNo != "" {
		key += "|" + strings.ToLower(orderNo)
	}
	h.linkMu.Lock()
	last := h.linkSent[key]
	if now-last < 300 {
		h.linkMu.Unlock()
		httpserver.WriteError(w, 429, "发送过于频繁，请稍后再试")
		return
	}
	h.linkSent[key] = now
	h.linkMu.Unlock()
	if len(orderNos) > 0 {
		// 批量勾选：仅发送选中且归属邮箱一致的有效订单（无效项静默跳过，返回条数）。
		sent, err := h.deps.Orders.SendViewLinksFor(contact, orderNos)
		if err != nil {
			httpserver.WriteInternalError(w, err)
			return
		}
		httpserver.WriteJSON(w, 200, linksResponse{OK: true, Sent: sent})
		return
	}
	if orderNo != "" {
		ok, err := h.deps.Orders.SendViewLink(contact, orderNo)
		if err != nil {
			httpserver.WriteInternalError(w, err)
			return
		}
		if !ok {
			httpserver.WriteError(w, 404, "订单不存在或邮箱不匹配")
			return
		}
		httpserver.WriteJSON(w, 200, linksResponse{OK: true})
		return
	}
	sent, err := h.deps.Orders.SendViewLinks(contact)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	httpserver.WriteJSON(w, 200, linksResponse{OK: true, Sent: sent})
}

func (h *Handlers) CancelOrder(w http.ResponseWriter, r *http.Request) {
	orderNo := r.PathValue("orderNo")
	o, err := h.deps.Orders.GetOrderByNo(orderNo)
	if err != nil {
		httpserver.WriteError(w, 404, "订单不存在")
		return
	}
	// 订单号会出现在支付跳转/查询 URL 中，不能作为唯一凭证：
	// 新订单凭查看令牌操作；旧订单（无令牌）回退到邮箱匹配。
	if !h.orderOwned(r, o) {
		httpserver.WriteError(w, 403, "contact mismatch")
		return
	}
	if o.Status != orderdomain.OrderWaitingPayment {
		httpserver.WriteError(w, 400, "当前状态不可取消")
		return
	}
	if err := h.deps.Orders.CancelWithGateway(o.ID); err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	httpserver.WriteJSON(w, 200, linksResponse{OK: true})
}

func (h *Handlers) Order(w http.ResponseWriter, r *http.Request) {
	orderNo := r.PathValue("orderNo")
	order, err := h.deps.Orders.GetOrderByNo(orderNo)
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	owned := h.orderOwned(r, order)
	item := h.toOrderResponse(order)
	if !owned {
		// 未验证归属时不下发买家邮箱、支付地址等敏感字段。
		item = item.Public()
	}
	resp := map[string]any{"order": item}
	if owned {
		switch order.Status {
		case orderdomain.OrderPaid, orderdomain.OrderProcessing, orderdomain.OrderDelivered, orderdomain.OrderCompleted:
			cards, err := h.deps.Orders.GetOrderCards(order.ID)
			if err != nil {
				httpserver.WriteInternalError(w, err)
				return
			}
			list := []cardResponse{}
			for _, c := range cards {
				list = append(list, toCardResponse(c))
			}
			resp["cards"] = list
		}
	}
	httpserver.WriteJSON(w, 200, resp)
}

// orderOwned 判断请求是否持有订单的访问凭证：
// 一律校验查看令牌（恒定时间比较）。存量订单已由迁移 014 回填令牌。

func (h *Handlers) orderOwned(r *http.Request, o orderdomain.Order) bool {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token != "" {
		return hmacEqual(token, o.ViewToken)
	}
	// 存量订单兼容路径：邮箱 + 订单号可查看订单，但新链接始终优先使用 token。
	contact := strings.TrimSpace(r.URL.Query().Get("contact"))
	return contact != "" && strings.EqualFold(contact, strings.TrimSpace(o.BuyerContact))
}
