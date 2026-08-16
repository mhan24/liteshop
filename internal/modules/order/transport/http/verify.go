package http

import (
	"crypto/hmac"

	"shop/internal/integrations/turnstile"
	"shop/internal/platform/config"
)

// verifyTurnstile 已配置 Turnstile 才校验（查询/发链接场景由调用方自行判断）。
func (h *Handlers) verifyTurnstile(token, remoteIP, host string) error {
	if h.deps.Settings.TurnstileSecret() == "" {
		return nil
	}
	return turnstile.Verify(h.deps.Settings.TurnstileSecret(), token, remoteIP, host)
}

// gatewayConfigured 判断指定网关凭据是否齐全。
func gatewayConfigured(cfg config.Config, gateway string) bool {
	if gateway == "hashpay" {
		return cfg.HashPayMerchantID != "" && cfg.HashPayPrivateKey != ""
	}
	return cfg.BepusdtBaseURL != "" && cfg.BepusdtToken != ""
}

// hmacEqual 恒定时间比较（订单查看令牌）。
func hmacEqual(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}
