package notify

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	smtp "shop/internal/integrations/notification/smtp"
	inventorydomain "shop/internal/modules/inventory/domain"
	orderdomain "shop/internal/modules/order/domain"
	"shop/internal/platform/config"
	mailqueue "shop/internal/platform/mailqueue"
	"shop/internal/platform/scheduler/jobs"
	"shop/internal/shared/clock"

	"shop/internal/platform/logging"
)

type Notifier struct {
	cfg      config.Config
	db       *sql.DB // 仅平台 mailqueue 与通知自有表（low_stock_reminders）
	bus      *jobs.Bus
	settings SettingsReader
	logs     OrderLogWriter
}

func New(cfg config.Config, database *sql.DB, bus *jobs.Bus, settings SettingsReader, logs OrderLogWriter) *Notifier {
	return &Notifier{cfg: cfg, db: database, bus: bus, settings: settings, logs: logs}
}

const (
	defaultMailPaidSubject = "支付成功发卡通知 - {{order_no}}"
	defaultMailPaidBody    = `您好：

您的订单已支付成功。

订单号：{{order_no}}
商品：{{product_name}} x{{qty}}
金额：{{amount}} {{fiat}}
收款类型：{{trade_type}}
支付时间：{{paid_at}}

卡密：
{{cards}}

请妥善保管卡密。订单查询：{{order_url}}
查询时使用下单邮箱：{{contact}}

如需帮助，请直接回复本邮件。`
	defaultTelegramPaidBody = `✅ 支付成功

订单号：{{order_no}}
商品：{{product_name}} x{{qty}}
金额：{{amount}} {{fiat}}
收款类型：{{trade_type}}

卡密：
{{cards}}

查询订单：{{order_url}}`
)

func renderTemplate(tpl string, data map[string]string) string {
	out := tpl
	for k, v := range data {
		out = strings.ReplaceAll(out, "{{"+k+"}}", v)
	}
	return out
}

func (n *Notifier) CurrentConfig() config.Config {
	cfg := n.cfg
	if n.settings == nil {
		return cfg
	}
	get := func(key string) string {
		v, err := n.settings.GetSetting(key)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(v)
	}
	if v := get("smtp_host"); v != "" {
		cfg.SMTPHost = v
	}
	if v := get("smtp_port"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.SMTPPort = port
		}
	}
	if v := get("smtp_username"); v != "" {
		cfg.SMTPUsername = v
	}
	if v, err := n.settings.GetSecret("smtp_password"); err == nil && strings.TrimSpace(v) != "" {
		cfg.SMTPPassword = strings.TrimSpace(v)
	}
	if v := get("smtp_from"); v != "" {
		cfg.SMTPFrom = v
	}
	if v, err := n.settings.GetSecret("telegram_bot_token"); err == nil && strings.TrimSpace(v) != "" {
		cfg.TelegramBotToken = strings.TrimSpace(v)
	}
	if v := get("telegram_chat_id"); v != "" {
		cfg.TelegramChatID = v
	}
	if v := get("webhook_url"); v != "" {
		cfg.WebhookURL = v
	}
	if v, err := n.settings.GetSecret("webhook_secret"); err == nil && strings.TrimSpace(v) != "" {
		cfg.WebhookSecret = strings.TrimSpace(v)
	}
	return cfg
}

func (n *Notifier) siteTitle() string {
	if n.settings != nil {
		if v, err := n.settings.GetSetting("site_title"); err == nil && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return "LiteShop"
}

// logOrder 通过注入的订单日志端口记录通知结果（端口未注入时静默跳过）。
func (n *Notifier) logOrder(orderID int64, event, message string, fromStatus, toStatus orderdomain.Status, adminID int64, metadata string) {
	if n.logs == nil {
		return
	}
	_ = n.logs.AddOrderLog(orderID, event, message, fromStatus, toStatus, adminID, metadata)
}

func (n *Notifier) SendPaid(order orderdomain.Order, cards []inventorydomain.Card) {
	// 异步任务：HTTP 回调只入队，由 worker 执行邮件/Telegram。
	n.publish(jobs.Job{Kind: jobs.KindPaid, Data: PaidPayload{Order: order, Cards: cards}})
}

// SendPaidSync 供 Outbox 使用：等待发卡通知消费者完成后再确认事件。
func (n *Notifier) SendPaidSync(order orderdomain.Order, cards []inventorydomain.Card) {
	n.sendPaidJob(order, cards)
}

// PaidPayload 发卡通知任务载荷（业务结构归通知适配器侧，bus 只搬运）。
type PaidPayload struct {
	Order orderdomain.Order
	Cards []inventorydomain.Card
}

// sendPaidJob 发卡通知执行体（worker 内运行）。
func (n *Notifier) sendPaidJob(order orderdomain.Order, cards []inventorydomain.Card) {
	cfg := n.CurrentConfig()
	// 发卡通知并入 delivered 事件模板统一管理（兼容旧 mail_paid_* 配置）。
	tpls := n.EventTemplates()[EventDelivered]
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
	paidAt := order.PaidAt
	if paidAt <= 0 {
		paidAt = clock.Now()
	}
	data := map[string]string{
		"order_no":     order.OrderNo,
		"product_name": order.ProductName,
		"qty":          strconv.Itoa(order.Qty),
		"amount":       fmt.Sprintf("%.2f", float64(order.AmountCents)/100),
		"fiat":         order.Fiat,
		"trade_type":   order.TradeType,
		"contact":      order.BuyerContact,
		"paid_at":      clock.FormatBeijing(paidAt),
		"cards":        strings.Join(cardLines, "\n"),
		"order_url":    orderURL(cfg.PublicBaseURL, order),
		"site_title":   n.siteTitle(),
	}
	subject := renderTemplate(tpls["mail_subject"], data)
	mailBody := renderTemplate(tpls["mail_body"], data)
	telegramBody := renderTemplate(tpls["telegram"], data)
	mailSent := false
	telegramSent := false
	if cfg.SMTPHost != "" && strings.Contains(order.BuyerContact, "@") {
		if err := smtp.Send(cfg, order.BuyerContact, subject, mailBody); err != nil {
			logging.App().Sugar().Warnf("send paid mail failed: order=%s to=%s err=%v", order.OrderNo, order.BuyerContact, err)
			n.enqueueFailedMail(order.BuyerContact, subject, mailBody, order.ID)
			n.logOrder(order.ID, "notify_failed", "邮件通知发送失败: "+err.Error(), order.Status, order.Status, 0, "smtp")
		} else {
			mailSent = true
		}
	}
	if cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
		// 发卡 Telegram 与 KindTelegram 任务一致：3 次指数退避重试（1s/2s）。
		if err := retryNotify("telegram", 3, func() error { return n.sendTelegramWithConfig(cfg, telegramBody) }); err != nil {
			n.logOrder(order.ID, "notify_failed", "Telegram 通知发送失败: "+err.Error(), order.Status, order.Status, 0, "telegram")
		} else {
			telegramSent = true
		}
	}
	if mailSent || telegramSent {
		channels := []string{}
		if mailSent {
			channels = append(channels, "邮件")
		}
		if telegramSent {
			channels = append(channels, "Telegram")
		}
		n.logOrder(order.ID, "notify_sent", "通知已发送 ("+strings.Join(channels, "+")+")", order.Status, order.Status, 0, "")
	}
}

// Handler 返回任务分发函数（供 worker 消费）。
func (n *Notifier) Handler() func(jobs.Job) {
	return func(j jobs.Job) {
		switch j.Kind {
		case jobs.KindPaid:
			if p, ok := j.Data.(PaidPayload); ok {
				n.sendPaidJob(p.Order, p.Cards)
			}
		case jobs.KindMail:
			cfg := n.CurrentConfig()
			if err := smtp.Send(cfg, j.To, j.Subject, j.Body); err != nil {
				logging.App().Sugar().Warnf("notify mail failed to=%s err=%v", j.To, err)
				n.enqueueFailedMail(j.To, j.Subject, j.Body, 0)
			}
		case jobs.KindTelegram:
			cfg := n.CurrentConfig()
			_ = retryNotify("telegram", 3, func() error { return n.sendTelegramWithConfig(cfg, j.Text) })
		case jobs.KindWebhook:
			site := n.siteTitle()
			_ = retryNotify("webhook", 3, func() error { return n.sendWebhook(j.Event, j.Payload, site) })
		}
	}
}

// retryNotify 带指数退避的重试（1s / 2s），全部失败后记录错误。
func retryNotify(name string, attempts int, fn func() error) error {
	for i := 1; i <= attempts; i++ {
		if err := fn(); err == nil {
			return nil
		} else if i < attempts {
			logging.App().Sugar().Warnf("notify %s failed attempt %d/%d err=%v", name, i, attempts, err)
			time.Sleep(time.Duration(i) * time.Second)
		} else {
			logging.App().Sugar().Errorf("notify %s failed after %d attempts err=%v", name, attempts, err)
			return err
		}
	}
	return nil
}

// publish 发布任务；未配置总线时同步执行（测试/降级）。
func (n *Notifier) publish(j jobs.Job) {
	if n.bus != nil {
		n.bus.Publish(j)
		return
	}
	n.Handler()(j)
}

// SendRawMail 直接发送一封邮件（邮件重试任务使用）。
func (n *Notifier) SendRawMail(to, subject, body string) error {
	cfg := n.CurrentConfig()
	if cfg.SMTPHost == "" {
		return errors.New("SMTP 未配置")
	}
	return smtp.Send(cfg, to, subject, body)
}

// enqueueFailedMail 邮件发送失败后写入重试队列。
func (n *Notifier) enqueueFailedMail(to, subject, body string, orderID int64) {
	if n.db == nil {
		return
	}
	_ = mailqueue.EnqueueMail(n.db, to, subject, body, orderID, time.Now().Add(time.Minute).Unix())
}

// orderURL 构造订单查看地址；新订单携带查看令牌，避免依赖邮箱弱凭证。
func orderURL(publicBaseURL string, order orderdomain.Order) string {
	u := strings.TrimRight(publicBaseURL, "/") + "/order/" + order.OrderNo
	if order.ViewToken != "" {
		u += "?token=" + order.ViewToken
	}
	return u
}

func (n *Notifier) SendTestEmail(to string) error {
	cfg := n.CurrentConfig()
	if cfg.SMTPHost == "" {
		return errors.New("SMTP 未配置")
	}
	if !strings.Contains(to, "@") {
		return errors.New("测试邮箱无效")
	}
	return smtp.Send(cfg, to, "发卡系统 SMTP 测试", "SMTP OK")
}

// SendOrderLinks 向订单登记邮箱发送该邮箱下全部订单的查看链接（单封邮件，令牌只发往该邮箱）。
func (n *Notifier) SendOrderLinks(to string, links []string) error {
	cfg := n.CurrentConfig()
	if cfg.SMTPHost == "" {
		return errors.New("SMTP 未配置")
	}
	body := "您的订单查看链接：\n\n" + strings.Join(links, "\n\n") +
		"\n\n请妥善保管这些链接，不要转发给他人。"
	return smtp.Send(cfg, to, "订单查看链接", body)
}

func (n *Notifier) SendTestTelegram() error {
	cfg := n.CurrentConfig()
	if cfg.TelegramBotToken == "" || cfg.TelegramChatID == "" {
		return errors.New("telegram 未配置")
	}
	return n.sendTelegramWithConfig(cfg, "发卡系统 Telegram 测试")
}

func (n *Notifier) sendTelegramWithConfig(cfg config.Config, text string) error {
	endpoint := "https://api.telegram.org/bot" + cfg.TelegramBotToken + "/sendMessage"
	form := url.Values{}
	form.Set("chat_id", cfg.TelegramChatID)
	form.Set("text", text)
	resp, err := n.cfgHTTPClient().PostForm(endpoint, form)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("telegram send failed: %s", resp.Status)
	}
	return nil
}

func (n *Notifier) cfgHTTPClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second}
}
