// Package smtp 邮件发送实现（notification 集成的 SMTP 通道）。
// 只负责传输协议，不接触业务表；配置由组合根经 config 传入。
package smtp

import (
	"crypto/tls"
	"mime"
	"net"
	netsmtp "net/smtp"
	"strconv"
	"strings"
	"time"

	"shop/internal/models"
	"shop/internal/platform/config"
)

// Send 使用配置发送一封邮件（隐式 TLS 465 / STARTTLS / 明文）。
func Send(cfg config.Config, to, subject, body string) error {
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
	client, err := netsmtp.NewClient(conn, cfg.SMTPHost)
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
		auth := netsmtp.PlainAuth("", cfg.SMTPUsername, cfg.SMTPPassword, cfg.SMTPHost)
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
