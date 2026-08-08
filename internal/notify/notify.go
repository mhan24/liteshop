package notify

import (
	"crypto/tls"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"

	"shop/internal/config"
	"shop/internal/db/repository"
	"shop/internal/jobs"
	"shop/internal/models"
	"shop/internal/security"

	"shop/internal/logging"
)

type Notifier struct {
	cfg    config.Config
	db     *sql.DB
	bus    *jobs.Bus
	cipher *security.Cipher
}

func New(cfg config.Config, database *sql.DB, bus *jobs.Bus, cipher *security.Cipher) *Notifier {
	return &Notifier{cfg: cfg, db: database, bus: bus, cipher: cipher}
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
	if n.db == nil {
		return cfg
	}
	get := func(key string) string {
		v, err := repository.GetSetting(n.db, key)
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
	if v, err := repository.GetSecret(n.db, "smtp_password", n.cipher); err == nil && strings.TrimSpace(v) != "" {
		cfg.SMTPPassword = strings.TrimSpace(v)
	}
	if v := get("smtp_from"); v != "" {
		cfg.SMTPFrom = v
	}
	if v, err := repository.GetSecret(n.db, "telegram_bot_token", n.cipher); err == nil && strings.TrimSpace(v) != "" {
		cfg.TelegramBotToken = strings.TrimSpace(v)
	}
	if v := get("telegram_chat_id"); v != "" {
		cfg.TelegramChatID = v
	}
	if v := get("webhook_url"); v != "" {
		cfg.WebhookURL = v
	}
	if v, err := repository.GetSecret(n.db, "webhook_secret", n.cipher); err == nil && strings.TrimSpace(v) != "" {
		cfg.WebhookSecret = strings.TrimSpace(v)
	}
	return cfg
}

func (n *Notifier) siteTitle() string {
	if v, err := repository.GetSetting(n.db, "site_title"); err == nil && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return "LiteShop"
}

func (n *Notifier) SendPaid(order models.Order, cards []models.Card) {
	// 异步任务：HTTP 回调只入队，由 worker 执行邮件/Telegram。
	n.publish(jobs.Job{Kind: jobs.KindPaid, Order: order, Cards: cards})
}

// sendPaidJob 发卡通知执行体（worker 内运行）。
func (n *Notifier) sendPaidJob(order models.Order, cards []models.Card) {
	cfg := n.CurrentConfig()
	// 发卡通知并入 delivered 事件模板统一管理（兼容旧 mail_paid_* 配置）。
	tpls := n.EventTemplates()[EventDelivered]
	cardLines := make([]string, 0, len(cards))
	for _, c := range cards {
		cardLines = append(cardLines, c.Content)
	}
	paidAt := order.PaidAt
	if paidAt <= 0 {
		paidAt = models.Now()
	}
	data := map[string]string{
		"order_no":     order.OrderNo,
		"product_name": order.ProductName,
		"qty":          strconv.Itoa(order.Qty),
		"amount":       fmt.Sprintf("%.2f", float64(order.AmountCents)/100),
		"fiat":         order.Fiat,
		"trade_type":   order.TradeType,
		"contact":      order.BuyerContact,
		"paid_at":      models.FormatBeijing(paidAt),
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
		if err := n.sendMailWithConfig(cfg, order.BuyerContact, subject, mailBody); err != nil {
			logging.App().Sugar().Warnf("send paid mail failed: order=%s to=%s err=%v", order.OrderNo, order.BuyerContact, err)
			n.enqueueFailedMail(order.BuyerContact, subject, mailBody, order.ID)
			_ = repository.AddOrderLog(n.db, order.ID, "notify_failed", "邮件通知发送失败: "+err.Error(), order.Status, order.Status, 0, "smtp")
		} else {
			mailSent = true
		}
	}
	if cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
		if err := n.sendTelegramWithConfig(cfg, telegramBody); err != nil {
			logging.App().Sugar().Warnf("send paid telegram failed: order=%s err=%v", order.OrderNo, err)
			_ = repository.AddOrderLog(n.db, order.ID, "notify_failed", "Telegram 通知发送失败: "+err.Error(), order.Status, order.Status, 0, "telegram")
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
		_ = repository.AddOrderLog(n.db, order.ID, "notify_sent", "通知已发送 ("+strings.Join(channels, "+")+")", order.Status, order.Status, 0, "")
	}
}

// Handler 返回任务分发函数（供 worker 消费）。
func (n *Notifier) Handler() func(jobs.Job) {
	return func(j jobs.Job) {
		switch j.Kind {
		case jobs.KindPaid:
			n.sendPaidJob(j.Order, j.Cards)
		case jobs.KindMail:
			cfg := n.CurrentConfig()
			if err := n.sendMailWithConfig(cfg, j.To, j.Subject, j.Body); err != nil {
				logging.App().Sugar().Warnf("notify mail failed to=%s err=%v", j.To, err)
				n.enqueueFailedMail(j.To, j.Subject, j.Body, 0)
			}
		case jobs.KindTelegram:
			cfg := n.CurrentConfig()
			if err := n.sendTelegramWithConfig(cfg, j.Text); err != nil {
				logging.App().Sugar().Warnf("notify telegram failed err=%v", err)
			}
		case jobs.KindWebhook:
			n.sendWebhook(j.Event, j.Payload, n.siteTitle())
		}
	}
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
	return n.sendMailWithConfig(cfg, to, subject, body)
}

// enqueueFailedMail 邮件发送失败后写入重试队列。
func (n *Notifier) enqueueFailedMail(to, subject, body string, orderID int64) {
	if n.db == nil {
		return
	}
	_ = repository.EnqueueMail(n.db, to, subject, body, orderID, time.Now().Add(time.Minute).Unix())
}

// orderURL 构造订单查看地址；新订单携带查看令牌，避免依赖邮箱弱凭证。
func orderURL(publicBaseURL string, order models.Order) string {
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
	return n.sendMailWithConfig(cfg, to, "发卡系统 SMTP 测试", "SMTP OK")
}

// SendOrderLinks 向订单登记邮箱发送该邮箱下全部订单的查看链接（单封邮件，令牌只发往该邮箱）。
func (n *Notifier) SendOrderLinks(to string, links []string) error {
	cfg := n.CurrentConfig()
	if cfg.SMTPHost == "" {
		return errors.New("SMTP 未配置")
	}
	body := "您的订单查看链接：\n\n" + strings.Join(links, "\n\n") +
		"\n\n请妥善保管这些链接，不要转发给他人。"
	return n.sendMailWithConfig(cfg, to, "订单查看链接", body)
}

func (n *Notifier) SendTestTelegram() error {
	cfg := n.CurrentConfig()
	if cfg.TelegramBotToken == "" || cfg.TelegramChatID == "" {
		return errors.New("Telegram 未配置")
	}
	return n.sendTelegramWithConfig(cfg, "发卡系统 Telegram 测试")
}

func (n *Notifier) sendMailWithConfig(cfg config.Config, to, subject, body string) error {
	from := cfg.SMTPFrom
	if from == "" {
		from = cfg.SMTPUsername
	}
	// JoinHostPort 兼容 IPv6 字面量（[::1]:465）。
	addr := net.JoinHostPort(cfg.SMTPHost, strconv.Itoa(cfg.SMTPPort))
	domain := "localhost"
	if at := strings.LastIndex(from, "@"); at >= 0 && at < len(from)-1 {
		domain = from[at+1:]
	}
	headers := []string{
		"From: " + from,
		"To: " + to,
		"Subject: " + mime.BEncoding.Encode("utf-8", subject),
		"Date: " + time.Now().Format(time.RFC1123Z),
		"Message-ID: <" + models.RandomToken(12) + "@" + domain + ">",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
	}
	msg := []byte(strings.Join(headers, "\r\n") + "\r\n\r\n" + body)
	// 显式拨号超时 + 整段 SMTP 会话 30s 期限，避免慢/挂死 SMTP 长期占用 goroutine。
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	var err error
	if cfg.SMTPPort == 465 {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{ServerName: cfg.SMTPHost})
	} else {
		conn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	client, err := smtp.NewClient(conn, cfg.SMTPHost)
	if err != nil {
		return err
	}
	defer client.Close()
	// 非隐式 TLS 端口：若服务器支持 STARTTLS 则升级。
	if cfg.SMTPPort != 465 {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: cfg.SMTPHost}); err != nil {
				return err
			}
		}
	}
	if cfg.SMTPUsername != "" {
		auth := smtp.PlainAuth("", cfg.SMTPUsername, cfg.SMTPPassword, cfg.SMTPHost)
		if err := client.Auth(auth); err != nil {
			return err
		}
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
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
