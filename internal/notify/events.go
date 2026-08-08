package notify

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"shop/internal/db/repository"
	"shop/internal/jobs"
	"shop/internal/models"

	"shop/internal/logging"
)

// 统一事件类型。
const (
	EventOrderCreated   = "order_created"
	EventPaymentSuccess = "payment_success"
	EventDelivered      = "delivered"
	EventLowStock       = "low_stock"
	EventSystemError    = "system_error"
)

// Notify 将事件分发到已启用的渠道 (Telegram / Email / Webhook)。
// payload 为事件附带数据 (已可模板渲染)。
func (n *Notifier) Notify(event string, payload map[string]string) {
	if n.db == nil || !n.eventEnabled(event) {
		return
	}
	cfg := n.CurrentConfig()
	site := n.siteTitle()
	text := renderTemplate(n.eventTemplate(event, "telegram", n.eventText(event)), payload)

	// Telegram
	if cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
		n.publish(jobs.Job{Kind: jobs.KindTelegram, Text: "[" + site + "] " + text})
	}
	// Email：买家事件发给买家；无买家联系方式的系统事件发给管理员通知邮箱（若已配置）。
	if cfg.SMTPHost != "" {
		if contact := payload["contact"]; strings.Contains(contact, "@") {
			subject := renderTemplate(n.eventTemplate(event, "mail_subject", "["+site+"] "+payload["title"]), payload)
			body := renderTemplate(n.eventTemplate(event, "mail_body", n.eventText(event)), payload)
			n.publish(jobs.Job{Kind: jobs.KindMail, To: contact, Subject: subject, Body: body})
		} else if adminEmail := n.adminEmail(); adminEmail != "" {
			subject := renderTemplate(n.eventTemplate(event, "mail_subject", "["+site+"] "+eventTitle(event)), payload)
			n.publish(jobs.Job{Kind: jobs.KindMail, To: adminEmail, Subject: subject, Body: text})
		}
	}
	// Webhook
	if cfg.WebhookURL != "" {
		n.publish(jobs.Job{Kind: jobs.KindWebhook, Event: event, Payload: payload})
	}
}

// eventTemplate 返回事件模板（存配置优先，否则回退默认值）。
func (n *Notifier) eventTemplate(event, kind, fallback string) string {
	if n.db != nil {
		if v, err := repository.GetSetting(n.db, "evt_tpl_"+kind+"_"+event); err == nil && strings.TrimSpace(v) != "" {
			return v
		}
		// 兼容旧版发卡模板键（delivered 事件迁移前配置的 mail_paid_*）。
		if event == EventDelivered {
			legacy := map[string]string{
				"mail_subject": "mail_paid_subject",
				"mail_body":    "mail_paid_body",
				"telegram":     "telegram_paid_body",
			}[kind]
			if legacy != "" {
				if v, err := repository.GetSetting(n.db, legacy); err == nil && strings.TrimSpace(v) != "" {
					return v
				}
			}
		}
	}
	return fallback
}

// EventTemplates 返回各事件当前生效的模板（供后台展示与编辑）。
func (n *Notifier) EventTemplates() map[string]map[string]string {
	events := []string{EventOrderCreated, EventPaymentSuccess, EventDelivered, EventLowStock, EventSystemError}
	out := make(map[string]map[string]string, len(events))
	for _, ev := range events {
		var def map[string]string
		if ev == EventDelivered {
			// 发卡通知使用富文本默认模板（与旧 mail_paid_* 一致）。
			def = map[string]string{
				"telegram":     defaultTelegramPaidBody,
				"mail_subject": defaultMailPaidSubject,
				"mail_body":    defaultMailPaidBody,
			}
		} else {
			def = map[string]string{
				"telegram":     n.eventText(ev),
				"mail_subject": "[" + n.siteTitle() + "] " + eventTitle(ev),
				"mail_body":    n.eventText(ev),
			}
		}
		out[ev] = map[string]string{
			"telegram":     n.eventTemplate(ev, "telegram", def["telegram"]),
			"mail_subject": n.eventTemplate(ev, "mail_subject", def["mail_subject"]),
			"mail_body":    n.eventTemplate(ev, "mail_body", def["mail_body"]),
		}
	}
	return out
}

// adminEmail 返回管理员通知邮箱（接收低库存/系统异常等事件）。
func (n *Notifier) adminEmail() string {
	if n.db == nil {
		return ""
	}
	v, err := repository.GetSetting(n.db, "notify_admin_email")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// SendTestEvent 发送一条指定事件的测试通知（channel: telegram / mail / 空=自动）。
func (n *Notifier) SendTestEvent(event, channel string) error {
	cfg := n.CurrentConfig()
	site := n.siteTitle()
	tpls := n.EventTemplates()[event]
	payload := map[string]string{
		"event":        event,
		"title":        eventTitle(event),
		"order_no":     "S20260101000000-TEST",
		"product_name": "测试商品",
		"qty":          "2",
		"amount":       "10.00",
		"fiat":         "CNY",
		"trade_type":   "usdt.trc20",
		"contact":      n.adminEmail(),
		"paid_at":      time.Now().Format("2006-01-02 15:04:05"),
		"cards":        "TEST-CARD-0001\nTEST-CARD-0002",
		"order_url":    strings.TrimRight(cfg.PublicBaseURL, "/") + "/order/S20260101000000-TEST",
		"available":    "5",
		"message":      "这是一条测试通知",
		"site_title":   site,
	}
	text := renderTemplate(tpls["telegram"], payload)
	switch channel {
	case "telegram":
		if cfg.TelegramBotToken == "" || cfg.TelegramChatID == "" {
			return errors.New("Telegram 未配置")
		}
		return n.sendTelegramWithConfig(cfg, "[TEST] ["+site+"] "+text)
	case "mail":
		admin := n.adminEmail()
		if cfg.SMTPHost == "" {
			return errors.New("SMTP 未配置")
		}
		if admin == "" {
			return errors.New("未配置管理员通知邮箱")
		}
		subject := "[TEST] " + renderTemplate(tpls["mail_subject"], payload)
		body := renderTemplate(tpls["mail_body"], payload)
		return n.sendMailWithConfig(cfg, admin, subject, body)
	default:
		if cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
			return n.SendTestEvent(event, "telegram")
		}
		return n.SendTestEvent(event, "mail")
	}
}

func (n *Notifier) sendWebhook(event string, payload map[string]string, site string) {
	body := map[string]any{
		"event":      event,
		"site_title": site,
		"time":       time.Now().Unix(),
		"data":       payload,
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, n.CurrentConfig().WebhookURL, bytes.NewReader(raw))
	if err != nil {
		logging.App().Sugar().Warnf("notify webhook req error event=%s err=%v", event, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "LiteShop-Webhook")
	// 可选签名：若配置 webhook_secret，附加 HMAC-SHA256 供接收方验真
	if secret := n.webhookSecret(); secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write(raw)
		req.Header.Set("X-LiteShop-Signature", hex.EncodeToString(mac.Sum(nil)))
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		logging.App().Sugar().Warnf("notify webhook failed event=%s err=%v", event, err)
		return
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= 400 {
		logging.App().Sugar().Warnf("notify webhook http %d event=%s", resp.StatusCode, event)
	}
}

// webhookSecret 返回 Webhook 签名密钥（未配置则空）。
func (n *Notifier) webhookSecret() string {
	if n.db == nil {
		return ""
	}
	v, err := repository.GetSecret(n.db, "webhook_secret", n.cipher)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// eventEnabled 判断事件是否已启用通知。
func (n *Notifier) eventEnabled(event string) bool {
	raw, err := repository.GetSetting(n.db, "notify_events")
	if err != nil {
		return true
	}
	for _, e := range strings.Split(raw, ",") {
		if strings.TrimSpace(e) == event {
			return true
		}
	}
	return false
}

// eventText 返回事件的默认文案 (可用于 Telegram/邮件/Webhook)。
func (n *Notifier) eventText(event string) string {
	switch event {
	case EventOrderCreated:
		return "📦 新订单\n订单号：{{order_no}}\n商品：{{product_name}} x{{qty}}\n金额：{{amount}} {{fiat}}\n联系：{{contact}}"
	case EventPaymentSuccess:
		return "✅ 支付成功\n订单号：{{order_no}}\n商品：{{product_name}}\n金额：{{amount}} {{fiat}}\n支付时间：{{paid_at}}\n\n{{cards}}"
	case EventDelivered:
		return "📨 发货成功\n订单号：{{order_no}}\n商品：{{product_name}}\n\n卡密：\n{{cards}}"
	case EventLowStock:
		return "⚠️ 库存不足\n商品：{{product_name}}\n剩余：{{available}}\n请及时补充卡密"
	case EventSystemError:
		return "🚨 系统异常\n{{message}}"
	default:
		return event
	}
}

// OrderPayload 构造订单事件的通用数据。
func (n *Notifier) OrderPayload(event string, order models.Order, cards []models.Card, extra map[string]string) map[string]string {
	cardLines := make([]string, 0, len(cards))
	for _, c := range cards {
		cardLines = append(cardLines, c.Content)
	}
	p := map[string]string{
		"event":        event,
		"title":        eventTitle(event),
		"order_no":     order.OrderNo,
		"product_name": order.ProductName,
		"qty":          strconv.Itoa(order.Qty),
		"amount":       fmt.Sprintf("%.2f", float64(order.AmountCents)/100),
		"fiat":         order.Fiat,
		"contact":      order.BuyerContact,
		"paid_at":      models.FormatBeijing(order.PaidAt),
		"cards":        strings.Join(cardLines, "\n"),
		"order_url":    orderURL(n.CurrentConfig().PublicBaseURL, order),
	}
	for k, v := range extra {
		p[k] = v
	}
	return p
}

func eventTitle(event string) string {
	switch event {
	case EventOrderCreated:
		return "新订单通知"
	case EventPaymentSuccess:
		return "支付成功通知"
	case EventDelivered:
		return "发货成功通知"
	default:
		return event
	}
}

// NotifyLowStock 检查商品库存，低于阈值时发送库存不足通知（限频防刷屏）。
// threshold 由调用方传入（统一入口为 web 的 lowStockThreshold）。
func (n *Notifier) NotifyLowStock(productID int64, productName string, available, threshold int) {
	if n.db == nil || threshold <= 0 {
		return
	}
	if available > threshold {
		return
	}
	// 限频: 每商品 30 分钟内只提醒一次（low_stock_reminders 表，替代 settings 键膨胀）。
	now := time.Now().Unix()
	res, err := n.db.Exec(`INSERT INTO low_stock_reminders(product_id, notified_at) VALUES(?, ?)
		ON CONFLICT(product_id) DO UPDATE SET notified_at = excluded.notified_at
		WHERE low_stock_reminders.notified_at < excluded.notified_at - 1800`, productID, now)
	if err != nil {
		logging.App().Sugar().Warnf("low stock reminder: %v", err)
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return // 30 分钟内已提醒过
	}
	payload := map[string]string{
		"event":        EventLowStock,
		"product_name": productName,
		"available":    strconv.Itoa(available),
	}
	n.Notify(EventLowStock, payload)
}

// NotifySystemError 发送系统异常通知。
func (n *Notifier) NotifySystemError(message string) {
	n.Notify(EventSystemError, map[string]string{
		"event":   EventSystemError,
		"message": message,
	})
}
