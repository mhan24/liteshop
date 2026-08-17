package http

import (
	"encoding/json"
	"io"
	"net/http"
	notify "shop/internal/integrations/notification"
	"shop/internal/platform/httpserver"
	"strings"
)

func (h *Handlers) AdminSettings(w http.ResponseWriter, r *http.Request) {
	cfg := h.deps.Settings.PaymentConfig()
	hashpayNotifyURL := h.deps.Settings.Get("hashpay_notify_url")
	if hashpayNotifyURL == "" && cfg.PublicBaseURL != "" {
		hashpayNotifyURL = cfg.PublicBaseURL + h.deps.Settings.HashPayNotifyPath()
	}
	httpserver.WriteJSON(w, 200, map[string]any{
		"payment_gateway":          cfg.PaymentGateway,
		"payment_gateways":         h.deps.Settings.EnabledGateways(),
		"bepusdt_base_url":         cfg.BepusdtBaseURL,
		"bepusdt_api_token_set":    cfg.BepusdtToken != "",
		"fiat":                     h.deps.Settings.Fiat(),
		"trade_types":              strings.Join(h.deps.Settings.TradeTypes(), ","),
		"bepusdt_timeout_sec":      cfg.BepusdtTimeoutSec,
		"shop_public_base_url":     cfg.PublicBaseURL,
		"bepusdt_notify_path":      h.deps.Settings.NotifyPath(),
		"bepusdt_notify_url":       cfg.NotifyURL,
		"hashpay_base_url":         cfg.HashPayBaseURL,
		"hashpay_merchant_id":      cfg.HashPayMerchantID,
		"hashpay_private_key_set":  cfg.HashPayPrivateKey != "",
		"hashpay_currency":         cfg.HashPayCurrency,
		"hashpay_notify_path":      h.deps.Settings.HashPayNotifyPath(),
		"hashpay_notify_url":       hashpayNotifyURL,
		"gateway_bepusdt_name":     h.deps.Settings.Get("gateway_bepusdt_name"),
		"gateway_bepusdt_desc":     h.deps.Settings.Get("gateway_bepusdt_desc"),
		"gateway_bepusdt_priority": h.deps.Settings.Get("gateway_bepusdt_priority"),
		"gateway_hashpay_name":     h.deps.Settings.Get("gateway_hashpay_name"),
		"gateway_hashpay_desc":     h.deps.Settings.Get("gateway_hashpay_desc"),
		"gateway_hashpay_priority": h.deps.Settings.Get("gateway_hashpay_priority"),
	})
}

func (h *Handlers) AdminSettingsSave(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	if err := h.deps.Settings.SavePayment(input); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	h.deps.Audit(r, "payment_update", "settings", "payment", "", "支付配置已更新")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminNotify(w http.ResponseWriter, r *http.Request) {
	cfg := h.deps.Notify.CurrentConfig()
	events := h.deps.Settings.Get("notify_events")
	adminEmail := h.deps.Settings.Get("notify_admin_email")
	if events == "" {
		events = "order_created,payment_success,delivered,low_stock,system_error"
	}
	httpserver.WriteJSON(w, 200, map[string]any{
		"smtp_host":          cfg.SMTPHost,
		"smtp_port":          cfg.SMTPPort,
		"smtp_username_set":  cfg.SMTPUsername != "",
		"smtp_from":          cfg.SMTPFrom,
		"smtp_password_set":  cfg.SMTPPassword != "",
		"telegram_chat_id":   cfg.TelegramChatID,
		"telegram_token_set": cfg.TelegramBotToken != "",
		"webhook_url":        cfg.WebhookURL,
		"webhook_secret_set": cfg.WebhookSecret != "",
		"notify_events":      events,
		"notify_admin_email": adminEmail,
		"event_templates":    h.deps.Notify.EventTemplates(),
	})
}

func (h *Handlers) AdminNotifySave(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	if err := h.deps.Settings.SaveNotify(input); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	h.deps.Audit(r, "notify_update", "settings", "notify", "", "通知配置已更新")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminNotifyTestEvent 发送指定事件的测试通知（channel: telegram / mail / 空=自动）。

func (h *Handlers) AdminNotifyTestEvent(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Event   string `json:"event"`
		Channel string `json:"channel"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	input.Event = strings.TrimSpace(input.Event)
	switch input.Event {
	case notify.EventOrderCreated, notify.EventPaymentSuccess, notify.EventDelivered,
		notify.EventLowStock, notify.EventSystemError:
	default:
		httpserver.WriteError(w, 400, "invalid event")
		return
	}
	if err := h.deps.Notify.SendTestEvent(input.Event, strings.TrimSpace(input.Channel)); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminNotifyTestEmail(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email string `json:"test_email"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	if !httpserver.ValidEmail(strings.TrimSpace(input.Email)) {
		httpserver.WriteError(w, 400, "invalid email")
		return
	}
	if err := h.deps.Notify.SendTestEmail(strings.TrimSpace(input.Email)); err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminNotifyTestTelegram(w http.ResponseWriter, r *http.Request) {
	if err := h.deps.Notify.SendTestTelegram(); err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminSite(w http.ResponseWriter, r *http.Request) {
	st := h.deps.Settings.SiteSettings()
	rawCopyright := h.deps.Settings.Get("site_copyright")
	if rawCopyright == "" {
		rawCopyright = "© {{year}} {{site_title}}. All rights reserved."
	}
	httpserver.WriteJSON(w, 200, map[string]any{
		"site_title":            st.Title,
		"site_subtitle":         st.Subtitle,
		"shop_public_base_url":  h.deps.Settings.PaymentConfig().PublicBaseURL,
		"site_announcement":     st.Announcement,
		"seo_description":       st.SEODescription,
		"seo_keywords":          st.SEOKeywords,
		"site_contact":          st.Contact,
		"site_friend_links":     st.FriendLinks,
		"site_copyright":        rawCopyright,
		"privacy_policy":        st.Privacy,
		"terms_of_service":      st.Terms,
		"turnstile_site_key":    h.deps.Settings.TurnstileSiteKey(),
		"turnstile_secret_set":  h.deps.Settings.TurnstileSecret() != "",
		"maintenance_enabled":   h.deps.Settings.Get("maintenance_enabled"),
		"maintenance_message":   h.deps.Settings.Get("maintenance_message"),
		"maintenance_pass_set":  h.deps.Settings.MaintenancePassSet(),
		"site_links":            h.deps.Settings.SiteLinks(),
		"default_product_image": h.deps.Settings.DefaultProductImage(),
		"site_logo":             h.deps.Settings.SiteLogoURL(),
		"site_favicon":          h.deps.Settings.SiteFaviconURL(),
		"site_locale":           st.Locale,
		"site_currency":         st.Currency,
		"site_timezone":         st.Timezone,
		"stock_display_mode":    st.StockDisplay,
		"home_view_mode":        h.deps.Settings.HomeViewMode(),
	})
}

func (h *Handlers) AdminSiteSave(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	if err := h.deps.Settings.SaveSite(input); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	h.deps.Audit(r, "site_update", "settings", "site", "", "站点配置已更新")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}
