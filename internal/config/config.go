package config

import "strings"

type Config struct {
	ListenAddr        string
	DatabasePath      string
	LogDir            string
	PublicBaseURL     string
	NotifyURL         string
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

// Load returns static defaults only. All runtime configuration is stored in the
// database and managed through the admin backend; no environment variables or
// .env files are used.
func Load() Config {
	return Config{
		ListenAddr:        ":8080",
		DatabasePath:      "data/shop.db",
		LogDir:            "logs",
		PublicBaseURL:     "http://localhost:8080",
		NotifyURL:         "http://localhost:8080/notify/bepusdt",
		AdminUsername:     "admin",
		AdminPassword:     "",
		SessionSecret:     "",
		TurnstileSecret:   "",
		TurnstileSiteKey:  "0x4AAAAAAD-83GuuhsY2-KeZ",
		BepusdtBaseURL:    "http://localhost:8081",
		BepusdtToken:      "",
		BepusdtFiat:       "CNY",
		BepusdtTradeType:  "usdt.trc20",
		BepusdtTradeTypes: []string{"usdt.trc20"},
		BepusdtTimeoutSec: 1200,
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
}
