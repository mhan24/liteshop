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

	smtp "shop/internal/integrations/notification/smtp"
	inventorydomain "shop/internal/modules/inventory/domain"
	orderdomain "shop/internal/modules/order/domain"
	"shop/internal/platform/scheduler/jobs"
	"shop/internal/shared/clock"

	"shop/internal/platform/logging"
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
	_ = n.notify(event, payload, func(j jobs.Job) error {
		n.publish(j)
		return nil
	})
}

// NotifySync 供 Outbox 使用：同步完成消费者处理后才返回，避免事件确认后进程退出导致内存任务丢失。
func (n *Notifier) NotifySync(event string, payload map[string]string) error {
	return n.notify(event, payload, func(j jobs.Job) error {
		return n.handleJobSync(j)
	})
}

func (n *Notifier) handleJobSync(j jobs.Job) error {
	cfg := n.CurrentConfig()
	switch j.Kind {
	case jobs.KindMail:
		if err := smtp.Send(cfg, j.To, j.Subject, j.Body); err != nil {
			// 邮件有持久化重试队列，入队成功后可确认 Outbox 事件。
			return n.enqueueFailedMailErr(j.To, j.Subject, j.Body, 0)
		}
	case jobs.KindTelegram:
		return retryNotify("telegram", 3, func() error {
			return n.sendTelegramWithConfig(cfg, j.Text)
		})
	case jobs.KindWebhook:
		return retryNotify("webhook", 3, func() error {
			return n.sendWebhook(j.Event, j.Payload, n.siteTitle())
		})
	}
	return nil
}

func (n *Notifier) notify(event string, payload map[string]string, enqueue func(jobs.Job) error) error {
	if n.db == nil || !n.eventEnabled(event) {
		return nil
	}
	cfg := n.CurrentConfig()
	site := n.siteTitle()
	text := renderTemplate(n.eventTemplate(event, "telegram", n.eventText(event)), payload)

	// Telegram
	if cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
		if err := enqueue(jobs.Job{Kind: jobs.KindTelegram, Text: "[" + site + "] " + text}); err != nil {
			return err
		}
	}
	// Email：买家事件发给买家；无买家联系方式的系统事件发给管理员通知邮箱（若已配置）。
	if cfg.SMTPHost != "" {
		if contact := payload["contact"]; strings.Contains(contact, "@") {
			subject := renderTemplate(n.eventTemplate(event, "mail_subject", "["+site+"] "+payload["title"]), payload)
			body := renderTemplate(n.eventTemplate(event, "mail_body", n.eventText(event)), payload)
			if err := enqueue(jobs.Job{Kind: jobs.KindMail, To: contact, Subject: subject, Body: body}); err != nil {
				return err
			}
		} else if adminEmail := n.adminEmail(); adminEmail != "" {
			subject := renderTemplate(n.eventTemplate(event, "mail_subject", "["+site+"] "+eventTitle(event)), payload)
			if err := enqueue(jobs.Job{Kind: jobs.KindMail, To: adminEmail, Subject: subject, Body: text}); err != nil {
				return err
			}
		}
	}
	// Webhook
	if cfg.WebhookURL != "" {
		if err := enqueue(jobs.Job{Kind: jobs.KindWebhook, Event: event, Payload: payload}); err != nil {
			return err
		}
	}
	return nil
}

// eventTemplate 返回事件模板（存配置优先，否则回退默认值）。
func (n *Notifier) eventTemplate(event, kind, fallback string) string {
	if n.settings != nil {
		if v, err := n.settings.GetSetting("evt_tpl_" + kind + "_" + event); err == nil && strings.TrimSpace(v) != "" {
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
				if v, err := n.settings.GetSetting(legacy); err == nil && strings.TrimSpace(v) != "" {
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
	if n.settings == nil {
		return ""
	}
	v, err := n.settings.GetSetting("notify_admin_email")
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
			return errors.New("telegram 未配置")
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
		return smtp.Send(cfg, admin, subject, body)
	default:
		if cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
			return n.SendTestEvent(event, "telegram")
		}
		return n.SendTestEvent(event, "mail")
	}
}

func (n *Notifier) sendWebhook(event string, payload map[string]string, site string) error {
	body := map[string]any{
		"event":      event,
		"site_title": site,
		"time":       time.Now().Unix(),
		"data":       payload,
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, n.CurrentConfig().WebhookURL, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("webhook req: %w", err)
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
		return fmt.Errorf("webhook send: %w", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook http %d event=%s", resp.StatusCode, event)
	}
	return nil
}

// webhookSecret 返回 Webhook 签名密钥（未配置则空）。
func (n *Notifier) webhookSecret() string {
	if n.settings == nil {
		return ""
	}
	v, err := n.settings.GetSecret("webhook_secret")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// eventEnabled 判断事件是否已启用通知。
func (n *Notifier) eventEnabled(event string) bool {
	if n.settings == nil {
		return true
	}
	raw, err := n.settings.GetSetting("notify_events")
	// 未配置（或配置为空）时视为全部事件启用，与后台“全部勾选”的默认展示一致。
	if err != nil || strings.TrimSpace(raw) == "" {
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
func (n *Notifier) OrderPayload(event string, order orderdomain.Order, cards []inventorydomain.Card, extra map[string]string) map[string]string {
	cardLines := make([]string, 0, len(cards))
	for _, c := range cards {
		cardLines = append(cardLines, c.Content)
	}
	// 人工手动交付：无卡密，使用管理员人工填写的发货内容。
	if len(cardLines) == 0 && strings.TrimSpace(order.DeliveryContent) != "" {
		for _, line := range strings.Split(order.DeliveryContent, "\n") {
			if strings.TrimSpace(line) != "" {
				cardLines = append(cardLines, line)
			}
		}
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
		"paid_at":      clock.FormatBeijing(order.PaidAt),
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
