package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddr        string
	DatabasePath      string
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
}

func getenv(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func getint(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func ParseTradeTypes(list, fallback string) []string {
	seen := make(map[string]bool)
	var out []string
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			return
		}
		seen[v] = true
		out = append(out, v)
	}
	for _, v := range strings.Split(list, ",") {
		add(v)
	}
	add(fallback)
	if len(out) == 0 {
		out = append(out, "usdt.trc20")
	}
	return out
}

// Load reads optional process environment. Runtime settings are overridden by the
// admin backend and persisted in the database, so .env is no longer required.
func Load() Config {
	publicBase := strings.TrimRight(getenv("SHOP_PUBLIC_BASE_URL", "http://localhost:8080"), "/")
	notifyURL := strings.TrimSpace(os.Getenv("BEPUSDT_NOTIFY_URL"))
	if notifyURL == "" {
		notifyURL = publicBase + "/notify/bepusdt"
	}
	tradeTypes := ParseTradeTypes(getenv("BEPUSDT_TRADE_TYPES", ""), getenv("BEPUSDT_TRADE_TYPE", "usdt.trc20"))
	return Config{
		ListenAddr:        getenv("SHOP_LISTEN_ADDR", ":8080"),
		DatabasePath:      getenv("SHOP_DATABASE_PATH", "data/shop.db"),
		PublicBaseURL:     publicBase,
		NotifyURL:         notifyURL,
		AdminUsername:     getenv("SHOP_ADMIN_USERNAME", "admin"),
		AdminPassword:     getenv("SHOP_ADMIN_PASSWORD", ""),
		SessionSecret:     getenv("SHOP_SESSION_SECRET", ""),
		TurnstileSecret:   getenv("TURNSTILE_SECRET", ""),
		TurnstileSiteKey:  getenv("TURNSTILE_SITE_KEY", "0x4AAAAAAD-83GuuhsY2-KeZ"),
		BepusdtBaseURL:    strings.TrimRight(getenv("BEPUSDT_BASE_URL", "http://localhost:8081"), "/"),
		BepusdtToken:      getenv("BEPUSDT_API_TOKEN", ""),
		BepusdtFiat:       getenv("BEPUSDT_FIAT", "CNY"),
		BepusdtTradeType:  tradeTypes[0],
		BepusdtTradeTypes: tradeTypes,
		BepusdtTimeoutSec: getint("BEPUSDT_TIMEOUT_SEC", 1200),
		SMTPHost:          getenv("SMTP_HOST", ""),
		SMTPPort:          getint("SMTP_PORT", 465),
		SMTPUsername:      getenv("SMTP_USERNAME", ""),
		SMTPPassword:      getenv("SMTP_PASSWORD", ""),
		SMTPFrom:          getenv("SMTP_FROM", ""),
		TelegramBotToken:  getenv("TELEGRAM_BOT_TOKEN", ""),
		TelegramChatID:    getenv("TELEGRAM_CHAT_ID", ""),
	}
}
