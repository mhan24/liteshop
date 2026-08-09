package service

import "strings"

// SaveNotify 保存通知配置（SMTP / Telegram / Webhook / 事件模板）。
func (s *SettingsService) SaveNotify(input map[string]any) error {
	set := func(key, field string) {
		if v, ok := input[field]; ok {
			_ = s.Set(key, strings.TrimSpace(str(v)))
		}
	}
	set("smtp_host", "smtp_host")
	set("smtp_port", "smtp_port")
	set("smtp_from", "smtp_from")
	set("telegram_chat_id", "telegram_chat_id")
	set("webhook_url", "webhook_url")
	set("notify_events", "notify_events")
	set("notify_admin_email", "notify_admin_email")
	if v := strings.TrimSpace(str(input["smtp_username"])); v != "" {
		_ = s.Set("smtp_username", v)
	}
	if v := strings.TrimSpace(str(input["smtp_password"])); v != "" {
		_ = s.SetSecret("smtp_password", v)
	}
	if v := strings.TrimSpace(str(input["telegram_bot_token"])); v != "" {
		_ = s.SetSecret("telegram_bot_token", v)
	}
	if v := strings.TrimSpace(str(input["webhook_secret"])); v != "" {
		_ = s.SetSecret("webhook_secret", v)
	}
	// 事件模板：evt_tpl_<kind>_<event>（空值回退默认模板）
	if v, ok := input["event_templates"]; ok {
		if m, ok := v.(map[string]any); ok {
			for ev, tpl := range m {
				tm, ok := tpl.(map[string]any)
				if !ok {
					continue
				}
				for _, kind := range []string{"telegram", "mail_subject", "mail_body"} {
					if val, ok := tm[kind]; ok {
						_ = s.Set("evt_tpl_"+kind+"_"+ev, strings.TrimSpace(str(val)))
					}
				}
			}
		}
	}
	return nil
}
