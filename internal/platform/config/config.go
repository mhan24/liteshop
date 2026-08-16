package config

import (
	"os"
	"strings"
)

type Config struct {
	ListenAddr        string
	DatabasePath      string
	LogDir            string
	PublicBaseURL     string
	NotifyURL         string
	PaymentGateway    string
	EnabledGateways   []string
	AdminUsername     string
	AdminPassword     string
	SessionSecret     string
	TurnstileSecret   string
	TurnstileSiteKey  string
	BepusdtBaseURL    string
	BepusdtToken      string
	BepusdtFiat       string
	BepusdtTradeType  string
	BepusdtTradeTypes []string
	BepusdtTimeoutSec int
	HashPayBaseURL    string
	HashPayMerchantID string
	HashPayPrivateKey string
	HashPayCurrency   string
	SMTPHost          string
	SMTPPort          int
	SMTPUsername      string
	SMTPPassword      string
	SMTPFrom          string
	TelegramBotToken  string
	TelegramChatID    string
	WebhookURL        string
	WebhookSecret     string
}

func ParseTradeTypes(list string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, v := range strings.Split(list, ",") {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	if len(out) == 0 {
		out = append(out, "usdt.trc20")
	}
	return out
}

// Load 返回静态默认值。业务配置存数据库；监听地址属于进程级部署配置，
// 可通过 LITESHOP_LISTEN_ADDR 收紧到本机反向代理。
func Load() Config {
	cfg := Config{
		ListenAddr:        ":8080",
		DatabasePath:      "data/shop.db",
		LogDir:            "logs",
		PublicBaseURL:     "http://localhost:8080",
		NotifyURL:         "http://localhost:8080/notify/bepusdt",
		PaymentGateway:    "bepusdt",
		EnabledGateways:   []string{"bepusdt"},
		AdminUsername:     "admin",
		AdminPassword:     "",
		SessionSecret:     "",
		TurnstileSecret:   "",
		TurnstileSiteKey:  "",
		BepusdtBaseURL:    "http://localhost:8081",
		BepusdtToken:      "",
		BepusdtFiat:       "CNY",
		BepusdtTradeType:  "usdt.trc20",
		BepusdtTradeTypes: []string{"usdt.trc20"},
		BepusdtTimeoutSec: 1200,
		HashPayBaseURL:    "https://pay.example.com",
		HashPayCurrency:   "USD",
		SMTPHost:          "",
		SMTPPort:          465,
		SMTPUsername:      "",
		SMTPPassword:      "",
		SMTPFrom:          "",
		TelegramBotToken:  "",
		TelegramChatID:    "",
		WebhookURL:        "",
		WebhookSecret:     "",
	}
	if addr := strings.TrimSpace(os.Getenv("LITESHOP_LISTEN_ADDR")); addr != "" {
		cfg.ListenAddr = addr
	}
	return cfg
}
