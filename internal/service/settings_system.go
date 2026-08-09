package service

import (
	"strings"
)

// BackupSettings 返回可导出的配置（不含密钥类）。
func (s *SettingsService) BackupSettings() (map[string]string, error) {
	settings, err := s.All()
	if err != nil {
		return nil, err
	}
	for k := range settings {
		if s.IsSecretKey(k) {
			delete(settings, k)
		}
	}
	return settings, nil
}

// RestoreSettings 恢复配置（跳过密钥类与超长值）。返回恢复条数。
func (s *SettingsService) RestoreSettings(settings map[string]string) (int, error) {
	count := 0
	for k, v := range settings {
		if len(k) > 80 || len(v) > 20000 {
			continue
		}
		// 密钥类配置禁止被备份覆盖（恢复后需重新填写）。
		if s.IsSecretKey(k) {
			continue
		}
		if err := s.Set(k, v); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

// ResetAll 清空业务数据（恢复/重置用）。
func (s *SettingsService) ResetAll() error {
	return s.store.ResetAllTables()
}

// SetupInput 首次初始化输入。
type SetupInput struct {
	SiteTitle       string
	PublicBaseURL   string
	BepusdtBaseURL  string
	BepusdtAPIToken string
	TradeTypes      string
	Fiat            string
	TurnstileSite   string
	TurnstileSecret string
}

// ApplySetup 写入首次初始化配置（校验 URL/法币/收款类型）。
func (s *SettingsService) ApplySetup(in SetupInput) error {
	settings := map[string]string{
		"site_title":          firstNonEmpty(in.SiteTitle, "LiteShop"),
		"site_copyright":      "© {{year}} {{site_title}}. All rights reserved.",
		"bepusdt_fiat":        "CNY",
		"bepusdt_timeout_sec": "1200",
	}
	if in.Fiat != "" {
		f, err := normalizeFiat(in.Fiat)
		if err != nil {
			return err
		}
		settings["bepusdt_fiat"] = f
	}
	if strings.TrimSpace(in.PublicBaseURL) != "" {
		u, err := normalizeHTTPURL(in.PublicBaseURL, false)
		if err != nil {
			return err
		}
		settings["shop_public_base_url"] = u
	}
	if strings.TrimSpace(in.BepusdtBaseURL) != "" {
		u, err := normalizeHTTPURL(in.BepusdtBaseURL, false)
		if err != nil {
			return err
		}
		settings["bepusdt_base_url"] = u
	}
	if strings.TrimSpace(in.TradeTypes) != "" {
		tt, err := normalizeTradeTypes(in.TradeTypes)
		if err != nil {
			return err
		}
		settings["bepusdt_trade_types"] = tt
	}
	if strings.TrimSpace(in.TurnstileSite) != "" {
		settings["turnstile_site_key"] = strings.TrimSpace(in.TurnstileSite)
	}
	// 敏感配置走 secrets 表（AES-GCM 加密），不能明文写入 settings。
	if token := strings.TrimSpace(in.BepusdtAPIToken); token != "" {
		if err := s.SetSecret("bepusdt_api_token", token); err != nil {
			return err
		}
	}
	if secret := strings.TrimSpace(in.TurnstileSecret); secret != "" {
		if err := s.SetSecret("turnstile_secret", secret); err != nil {
			return err
		}
	}
	return s.SetMany(settings)
}
