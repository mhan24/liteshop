package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"shop/internal/db"
	"shop/internal/models"
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
	text := renderTemplate(n.eventText(event), payload)

	// Telegram
	if cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
		if err := n.sendTelegramWithConfig(cfg, "["+site+"] "+text); err != nil {
			log.Printf("notify telegram failed event=%s err=%v", event, err)
		}
	}
	// Email (仅订单相关事件发给买家, 简单事件发到站点 SMTP From 不现实, 故仅当 payload 含 contact 时发送)
	if contact := payload["contact"]; cfg.SMTPHost != "" && strings.Contains(contact, "@") {
		subject := "[" + site + "] " + payload["title"]
		if err := n.sendMailWithConfig(cfg, contact, subject, text); err != nil {
			log.Printf("notify mail failed event=%s to=%s err=%v", event, contact, err)
		}
	}
	// Webhook
	if cfg.WebhookURL != "" {
		go n.sendWebhook(event, payload, site)
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
		log.Printf("notify webhook req error event=%s err=%v", event, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "LiteShop-Webhook")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("notify webhook failed event=%s err=%v", event, err)
		return
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("notify webhook http %d event=%s", resp.StatusCode, event)
	}
}

// eventEnabled 判断事件是否已启用通知。
func (n *Notifier) eventEnabled(event string) bool {
	raw, err := db.GetSetting(n.db, "notify_events")
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
		"order_url":    strings.TrimRight(n.CurrentConfig().PublicBaseURL, "/") + "/order/" + order.OrderNo,
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
// available 为当前可用卡密数。
func (n *Notifier) NotifyLowStock(productID int64, productName string, available int) {
	if n.db == nil {
		return
	}
	th, _ := db.GetSetting(n.db, "low_stock_threshold")
	threshold := 10
	if v, err := strconv.Atoi(strings.TrimSpace(th)); err == nil && v > 0 {
		threshold = v
	}
	if available > threshold {
		return
	}
	// 限频: 每商品 30 分钟内只提醒一次
	key := fmt.Sprintf("low_stock_notified_%d", productID)
	last, err := db.GetSetting(n.db, key)
	if err == nil && last != "" {
		if ts, err2 := strconv.ParseInt(last, 10, 64); err2 == nil && time.Now().Unix()-ts < 1800 {
			return
		}
	}
	_ = db.SetSetting(n.db, key, strconv.FormatInt(time.Now().Unix(), 10))
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
