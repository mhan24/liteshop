package application

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

// PreparedSetup 是完成业务校验后的初始化写入集合，由组合根在一个数据库事务中提交。
type PreparedSetup struct {
	Settings map[string]string
	Secrets  map[string]string
}

// PrepareSetup 只校验和归一化输入，不写数据库。
func (s *SettingsService) PrepareSetup(in SetupInput) (PreparedSetup, error) {
	prepared := PreparedSetup{
		Settings: map[string]string{
			"site_title":          firstNonEmpty(in.SiteTitle, "LiteShop"),
			"site_copyright":      "© {{year}} {{site_title}}. All rights reserved.",
			"bepusdt_fiat":        "CNY",
			"bepusdt_timeout_sec": "1200",
		},
		Secrets: make(map[string]string),
	}
	settings := prepared.Settings
	if in.Fiat != "" {
		f, err := normalizeFiat(in.Fiat)
		if err != nil {
			return PreparedSetup{}, err
		}
		settings["bepusdt_fiat"] = f
	}
	if strings.TrimSpace(in.PublicBaseURL) != "" {
		u, err := normalizeHTTPURL(in.PublicBaseURL, false)
		if err != nil {
			return PreparedSetup{}, err
		}
		settings["shop_public_base_url"] = u
	}
	if strings.TrimSpace(in.BepusdtBaseURL) != "" {
		u, err := normalizeHTTPURL(in.BepusdtBaseURL, false)
		if err != nil {
			return PreparedSetup{}, err
		}
		settings["bepusdt_base_url"] = u
	}
	if strings.TrimSpace(in.TradeTypes) != "" {
		tt, err := normalizeTradeTypes(in.TradeTypes)
		if err != nil {
			return PreparedSetup{}, err
		}
		settings["bepusdt_trade_types"] = tt
	}
	if site := strings.TrimSpace(in.TurnstileSite); site != "" {
		settings["turnstile_site_key"] = site
	}
	if token := strings.TrimSpace(in.BepusdtAPIToken); token != "" {
		prepared.Secrets["bepusdt_api_token"] = token
	}
	if secret := strings.TrimSpace(in.TurnstileSecret); secret != "" {
		prepared.Secrets["turnstile_secret"] = secret
	}
	return prepared, nil
}

// ApplySetup 写入首次初始化配置（校验 URL/法币/收款类型）。
func (s *SettingsService) ApplySetup(in SetupInput) error {
	prepared, err := s.PrepareSetup(in)
	if err != nil {
		return err
	}
	for key, value := range prepared.Secrets {
		if err := s.SetSecret(key, value); err != nil {
			return err
		}
	}
	return s.SetMany(prepared.Settings)
}
