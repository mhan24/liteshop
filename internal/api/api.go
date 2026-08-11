package api

import (
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"go.uber.org/zap"
	"io"
	"net/http"
	"os"
	"runtime"
	"shop/internal/logging"
	"shop/internal/models"
	"shop/internal/notify"
	"shop/internal/service"
	"shop/internal/version"
	"strconv"
	"strings"
	"time"
)

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

// writeInternalError 记录完整错误到日志，仅向客户端返回通用文案（避免泄露内部细节）。
func writeInternalError(w http.ResponseWriter, err error) {
	if err != nil {
		logging.App().Error("internal error", zap.Error(err))
	}
	writeError(w, 500, "internal server error")
}

func (s *Server) registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/maintenance/unlock", s.rateLimitMiddleware("maintenance_unlock", 10, s.apiMaintenanceUnlock))
	mux.HandleFunc("GET /api/v1/setup", s.apiSetupStatus)
	mux.HandleFunc("POST /api/v1/setup", s.rateLimitMiddleware("setup", 10, s.apiSetup))
	mux.HandleFunc("GET /api/v1/site", s.apiSite)
	mux.HandleFunc("GET /api/v1/products", s.rateLimitMiddleware("products_list", 60, s.apiProducts))
	mux.HandleFunc("GET /api/v1/products/{id}", s.rateLimitMiddleware("products_detail", 120, s.apiProduct))
	mux.HandleFunc("POST /api/v1/orders", s.rateLimitMiddleware("orders", 20, s.apiCreateOrder))
	mux.HandleFunc("GET /api/v1/orders", s.rateLimitMiddleware("orders_lookup", 20, s.apiOrdersByContact))
	mux.HandleFunc("GET /api/v1/orders/{orderNo}", s.rateLimitMiddleware("order_detail", 300, s.apiOrder))
	mux.HandleFunc("POST /api/v1/orders/{orderNo}/cancel", s.rateLimitMiddleware("order_cancel", 10, s.apiCancelOrder))
	mux.HandleFunc("POST /api/v1/orders/links", s.rateLimitMiddleware("order_links", 10, s.apiSendOrderLinks))
	mux.HandleFunc("GET /api/v1/pages/{slug}", s.apiPage)
	mux.HandleFunc("POST /api/v1/lang", s.apiSetLang)

	mux.HandleFunc("GET /api/v1/admin/session", s.requireAdminAPI(http.HandlerFunc(s.apiAdminSession)).ServeHTTP)
	mux.HandleFunc("POST /api/v1/admin/login", s.rateLimitMiddleware("login", 10, s.apiAdminLogin))
	mux.HandleFunc("POST /api/v1/admin/login/verify", s.rateLimitMiddleware("login_verify", 10, s.apiAdminLoginVerify))
	mux.Handle("POST /api/v1/admin/logout", s.requireAdminAPI(http.HandlerFunc(s.apiAdminLogout)))
	mux.Handle("GET /api/v1/admin/dashboard", s.requireAdminAPI(http.HandlerFunc(s.apiDashboard)))
	mux.Handle("GET /api/v1/admin/sales-report", s.requireAdminAPI(http.HandlerFunc(s.apiAdminSalesReport)))

	mux.Handle("GET /api/v1/admin/products", s.requireAdminAPI(http.HandlerFunc(s.apiAdminProducts)))
	mux.Handle("GET /api/v1/admin/products/{id}", s.requireAdminAPI(http.HandlerFunc(s.apiAdminProduct)))
	mux.Handle("POST /api/v1/admin/products", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminProductCreate)))
	mux.Handle("POST /api/v1/admin/products/{id}/edit", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminProductUpdate)))
	mux.Handle("GET /api/v1/admin/products/{id}/cards", s.requireAdminAPI(http.HandlerFunc(s.apiAdminCards)))
	mux.Handle("GET /api/v1/admin/products/{id}/cards/export", s.requireAdminAPI(http.HandlerFunc(s.apiAdminCardsExport)))
	mux.Handle("POST /api/v1/admin/products/{id}/cards", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminCardsImport)))
	mux.Handle("POST /api/v1/admin/cards/{id}/delete", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminCardDelete)))
	mux.Handle("POST /api/v1/admin/cards/{id}/status", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminCardStatus)))
	mux.Handle("GET /api/v1/admin/orders/export", s.requireAdminAPI(http.HandlerFunc(s.apiAdminOrdersExport)))
	mux.Handle("GET /api/v1/admin/orders", s.requireAdminAPI(http.HandlerFunc(s.apiAdminOrders)))
	mux.Handle("GET /api/v1/admin/orders/{id}", s.requireAdminAPI(http.HandlerFunc(s.apiAdminOrder)))
	mux.Handle("POST /api/v1/admin/orders/{id}/expire", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminOrderExpire)))
	mux.Handle("POST /api/v1/admin/orders/{id}/cancel", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminOrderCancel)))
	mux.Handle("POST /api/v1/admin/orders/{id}/status", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminOrderSetStatus)))
	mux.Handle("POST /api/v1/admin/orders/{id}/resend", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminOrderResend)))
	mux.Handle("POST /api/v1/admin/orders/batch-resend", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminOrdersBatchResend)))
	mux.Handle("POST /api/v1/admin/orders/{id}/redeliver", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminOrderRedeliver)))
	mux.Handle("GET /api/v1/admin/settings", s.requireAdminAPI(http.HandlerFunc(s.apiAdminSettings)))
	mux.Handle("POST /api/v1/admin/settings", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminSettingsSave)))
	mux.Handle("GET /api/v1/admin/notify", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminNotify)))
	mux.Handle("POST /api/v1/admin/notify", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminNotifySave)))
	mux.Handle("POST /api/v1/admin/notify/test-email", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminNotifyTestEmail)))
	mux.Handle("POST /api/v1/admin/notify/test-telegram", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminNotifyTestTelegram)))
	mux.Handle("POST /api/v1/admin/notify/test-event", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminNotifyTestEvent)))
	mux.Handle("GET /api/v1/admin/site", s.requireAdminAPI(http.HandlerFunc(s.apiAdminSite)))
	mux.Handle("POST /api/v1/admin/site", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminSiteSave)))
	mux.Handle("GET /api/v1/admin/account", s.requireAdminAPI(http.HandlerFunc(s.apiAdminAccount)))
	mux.Handle("POST /api/v1/admin/account", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminAccountSave)))
	mux.Handle("GET /api/v1/admin/totp", s.requireAdminAPI(http.HandlerFunc(s.apiAdminTotpStatus)))
	mux.Handle("POST /api/v1/admin/totp/generate", s.requireAdminAPI(http.HandlerFunc(s.apiAdminTotpGenerate)))
	mux.Handle("POST /api/v1/admin/totp/enable", s.requireAdminAPI(http.HandlerFunc(s.apiAdminTotpEnable)))
	mux.Handle("POST /api/v1/admin/totp/disable", s.requireAdminAPI(http.HandlerFunc(s.apiAdminTotpDisable)))
	mux.Handle("GET /api/v1/admin/system/backup", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminSystemBackup)))
	mux.Handle("GET /api/v1/admin/version", s.requireAdminAPI(http.HandlerFunc(s.apiAdminVersion)))
	mux.Handle("POST /api/v1/admin/system/restore", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminSystemRestore)))
	mux.Handle("POST /api/v1/admin/system/reset", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminSystemReset)))
	mux.Handle("GET /api/v1/admin/admins", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminListAdmins)))
	mux.Handle("POST /api/v1/admin/admins", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminCreateAdmin)))
	mux.Handle("POST /api/v1/admin/admins/{id}/role", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminSetRole)))
	mux.Handle("POST /api/v1/admin/admins/{id}/delete", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminDeleteAdmin)))
	mux.Handle("GET /api/v1/admin/audit-logs", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminAuditLogs)))
	mux.Handle("GET /api/v1/admin/jobs", s.requireAdminAPI(http.HandlerFunc(s.apiAdminJobs)))
	mux.Handle("GET /api/v1/admin/coupons", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminCoupons)))
	mux.Handle("POST /api/v1/admin/coupons", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminCouponCreate)))
	mux.Handle("POST /api/v1/admin/coupons/{id}/edit", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminCouponUpdate)))
	mux.Handle("POST /api/v1/admin/coupons/{id}/delete", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminCouponDelete)))
}

func faqJSON(faq []models.FAQItem) string {
	if len(faq) == 0 {
		return ""
	}
	raw, err := json.Marshal(faq)
	if err != nil {
		return ""
	}
	return string(raw)
}

func productJSON(p models.Product) map[string]any {
	faq := []map[string]string{}
	for _, f := range p.FAQ {
		faq = append(faq, map[string]string{"q": f.Q, "a": f.A})
	}
	wholesale := []map[string]any{}
	for _, t := range p.Wholesale {
		wholesale = append(wholesale, map[string]any{"min_qty": t.MinQty, "discount": t.Discount})
	}
	return map[string]any{
		"id":          p.ID,
		"name":        p.Name,
		"slug":        models.Slugify(p.Name),
		"description": p.Description,
		"image_url":   p.ImageURL,
		"price_cents": p.PriceCents,
		"status":      p.Status,
		"category":    p.Category,
		"sort_order":  p.SortOrder,
		"is_pinned":   p.IsPinned,
		"faq":         faq,
		"wholesale":   wholesale,
		"min_qty":     p.MinQty,
		"max_qty":     p.MaxQty,
		"cost_cents":  p.CostCents,
		"created_at":  p.CreatedAt,
		"updated_at":  p.UpdatedAt,
	}
}

// productJSONPublic 公开商品视图：不包含成本价等敏感经营数据。
func productJSONPublic(p models.Product) map[string]any {
	out := productJSON(p)
	delete(out, "cost_cents")
	return out
}

func orderJSON(o models.Order) map[string]any {
	return map[string]any{
		"id":                   o.ID,
		"order_no":             o.OrderNo,
		"product_id":           o.ProductID,
		"product_name":         o.ProductName,
		"qty":                  o.Qty,
		"amount_cents":         o.AmountCents,
		"fiat":                 o.Fiat,
		"trade_type":           o.TradeType,
		"buyer_contact":        o.BuyerContact,
		"status":               o.Status,
		"payment_status":       o.PaymentStatus,
		"trade_id":             o.TradeID,
		"payment_url":          o.PaymentURL,
		"block_transaction_id": o.BlockTransactionID,
		"created_at":           o.CreatedAt,
		"updated_at":           o.UpdatedAt,
		"paid_at":              o.PaidAt,
	}
}

func cardJSON(c models.Card) map[string]any {
	return map[string]any{
		"id":             c.ID,
		"product_id":     c.ProductID,
		"reserved_order": c.ReservedOrder,
		"sold_order":     c.SoldOrder,
		"content":        c.Content,
		"status":         c.Status,
		"created_at":     c.CreatedAt,
		"updated_at":     c.UpdatedAt,
		"sold_at":        c.SoldAt,
	}
}

func (s *Server) apiSite(w http.ResponseWriter, r *http.Request) {
	st := s.settings.SiteSettings()
	maintenancePassword := s.settings.MaintenancePassword()
	enabled := s.settings.MaintenanceEnabled()
	if enabled && maintenancePassword != "" && s.maintenanceUnlocked(r, maintenancePassword) {
		enabled = false
	}
	writeJSON(w, 200, map[string]any{
		"title":                 st.Title,
		"subtitle":              st.Subtitle,
		"public_base_url":       s.settings.PaymentConfig().PublicBaseURL,
		"announcement":          st.Announcement,
		"seo_description":       st.SEODescription,
		"seo_keywords":          st.SEOKeywords,
		"links":                 s.settings.SiteLinks(),
		"copyright":             st.Copyright,
		"lang":                  chooseLang(r),
		"locale":                st.Locale,
		"currency":              st.Currency,
		"currency_symbol":       currencySymbol(st.Currency),
		"timezone":              st.Timezone,
		"stock_display_mode":    st.StockDisplay,
		"home_view_mode":        s.settings.HomeViewMode(),
		"default_product_image": s.settings.DefaultProductImage(),
		"turnstile_site_key":    s.settings.TurnstileSiteKey(),
		"logo_url":              s.settings.SiteLogoURL(),
		"favicon_url":           s.settings.SiteFaviconURL(),
		"maintenance": map[string]any{
			"enabled": enabled,
			"message": s.settings.Get("maintenance_message"),
		},
	})
}

// currencySymbol 返回货币符号。
func currencySymbol(currency string) string {
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "CNY", "RMB":
		return "¥"
	case "USD", "USDT", "EUR", "GBP", "JPY":
		// 常见符号; 其余回退为代码
	}
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "USD":
		return "$"
	case "EUR":
		return "€"
	case "GBP":
		return "£"
	case "JPY":
		return "¥"
	default:
		return strings.ToUpper(strings.TrimSpace(currency))
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// DefaultProductImage 是内置默认占位图（站内资源，前端兜底 /default-product.svg）。
const DefaultProductImage = ""

func (s *Server) maintenanceUnlocked(r *http.Request, password string) bool {
	c, err := r.Cookie("maint_unlock")
	if err != nil {
		return false
	}
	return hmacEqual(c.Value, s.maintToken(s.settings.NormalizeMaintenanceHash(password)))
}

func (s *Server) apiMaintenanceUnlock(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	if !s.settings.MaintenanceEnabled() {
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	maintenancePassword := s.settings.MaintenancePassword()
	if maintenancePassword == "" ||
		!hmacEqual(s.settings.HashMaintenancePassword(strings.TrimSpace(input.Password)), s.settings.NormalizeMaintenanceHash(maintenancePassword)) {
		writeError(w, 403, "密码错误")
		return
	}
	// 存量明文在解锁成功后升级为哈希存储。
	if normalized := s.settings.NormalizeMaintenanceHash(maintenancePassword); normalized != maintenancePassword {
		_ = s.settings.SetMaintenancePasswordHash(normalized)
		maintenancePassword = normalized
	}
	secure := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	http.SetCookie(w, &http.Cookie{Name: "maint_unlock", Value: s.maintToken(s.settings.NormalizeMaintenanceHash(maintenancePassword)), Path: "/", MaxAge: 43200, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiProducts(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	minPrice, _ := strconv.ParseFloat(r.URL.Query().Get("min_price"), 64)
	maxPrice, _ := strconv.ParseFloat(r.URL.Query().Get("max_price"), 64)
	groups, err := s.products.ListCategories(true, q, category, minPrice, maxPrice)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, g := range groups {
		items := []map[string]any{}
		for _, p := range g.Products {
			items = append(items, map[string]any{"product": productJSONPublic(p.Product), "available": p.Available, "reserved": p.Reserved, "sold": p.Sold})
		}
		out = append(out, map[string]any{"name": g.Name, "default_key": g.DefaultKey, "products": items})
	}
	cats, _ := s.products.AllCategories()
	writeJSON(w, 200, map[string]any{
		"categories":     out,
		"categories_all": cats,
	})
}

func (s *Server) apiProduct(w http.ResponseWriter, r *http.Request) {
	param := r.PathValue("id")
	var (
		v   service.View
		err error
	)
	// 支持 /products/{id} 或 /products/{slug}
	if id, perr := strconv.ParseInt(param, 10, 64); perr == nil {
		v, err = s.products.GetActiveView(id)
	} else {
		v, err = s.products.GetBySlug(param)
	}
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	writeJSON(w, 200, map[string]any{
		"product":               productJSONPublic(v.Product),
		"available":             v.Available,
		"trade_types":           s.settings.TradeTypes(),
		"turnstile_site_key":    s.settings.TurnstileSiteKey(),
		"default_product_image": s.settings.DefaultProductImage(),
		"site_title":            s.settings.SiteSettings().Title,
	})
}

func (s *Server) apiCreateOrder(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ProductID         int64  `json:"product_id"`
		Qty               int    `json:"qty"`
		Contact           string `json:"contact"`
		TradeType         string `json:"trade_type"`
		CouponCode        string `json:"coupon_code"`
		TurnstileResponse string `json:"cf-turnstile-response"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	if err := s.verifyTurnstileToken(input.TurnstileResponse, clientIP(r), r.Host); err != nil {
		writeError(w, 403, "turnstile failed")
		return
	}
	if input.Qty <= 0 {
		input.Qty = 1
	}
	if !validEmail(input.Contact) {
		writeError(w, 400, "invalid email")
		return
	}
	vw, err := s.products.GetActiveView(input.ProductID)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	p := vw.Product
	available := vw.Available
	if input.Qty > available {
		writeError(w, 400, "out of stock")
		return
	}
	tradeType := strings.TrimSpace(input.TradeType)
	if tradeType == "" {
		tradeType = s.settings.TradeTypes()[0]
	}
	if !s.settings.TradeTypeAllowed(tradeType) {
		writeError(w, 400, "invalid trade type")
		return
	}
	orderNo, paymentURL, _, _, err := s.orders.CreateOrder(p, input.Qty, input.Contact, tradeType, input.CouponCode)
	if err != nil {
		s.notifySvc.SystemError("创建支付交易失败: " + err.Error())
		logging.Payment().Warn("payment create failed",
			zap.String("request_id", logging.RequestID(r.Context())),
			zap.String("order_no", orderNo),
			zap.String("trade_type", tradeType),
			zap.String("result", "error"),
			zap.String("error", err.Error()),
		)
		// 业务错误（券码/库存/数量）可回显给买家；系统错误（网关/DB）只写日志并返回通用文案。
		msg := "下单失败，请重试或联系客服"
		var biz *service.BusinessError
		if errors.As(err, &biz) {
			msg = biz.Error()
		}
		if orderNo != "" {
			writeJSON(w, 502, map[string]any{"error": msg, "order_no": orderNo})
		} else {
			writeError(w, 502, msg)
		}
		return
	}
	token := ""
	if o, oerr := s.orders.GetOrderByNo(orderNo); oerr == nil {
		token = o.ViewToken
		logging.Payment().Info("payment create",
			zap.String("request_id", logging.RequestID(r.Context())),
			zap.String("order_no", orderNo),
			zap.Int64("amount_cents", o.AmountCents),
			zap.String("trade_type", o.TradeType),
			zap.String("trace_id", o.TradeID),
			zap.String("result", "ok"),
		)
	}
	writeJSON(w, 200, map[string]any{"order_no": orderNo, "payment_url": paymentURL, "token": token})
}

func (s *Server) apiOrdersByContact(w http.ResponseWriter, r *http.Request) {
	contact := strings.TrimSpace(r.URL.Query().Get("contact"))
	if !validEmail(contact) {
		writeError(w, 400, "invalid email")
		return
	}
	// 已配置 Turnstile 时，邮箱查询同样要求人机验证（防枚举/防刷）。
	if s.settings.TurnstileSecret() != "" {
		if err := s.verifyTurnstileToken(strings.TrimSpace(r.Header.Get("X-Turnstile-Response")), clientIP(r), r.Host); err != nil {
			writeError(w, 403, "turnstile failed")
			return
		}
	}
	orders, err := s.orders.OrdersByContact(contact, 10)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, o := range orders {
		item := map[string]any{
			"product_name": o.ProductName,
			"qty":          o.Qty,
			"amount":       fmt.Sprintf("%.2f", float64(o.AmountCents)/100),
			"fiat":         o.Fiat,
			"trade_type":   o.TradeType,
			"status":       o.Status,
			"created_at":   o.CreatedAt,
			"paid_at":      o.PaidAt,
		}
		// 不返回订单号/查看 URL（避免邮箱枚举与令牌外泄）：
		// 买家通过"发送查看链接到邮箱"接口获取访问链接（只发往登记邮箱）。
		if o.Status == models.OrderWaitingPayment {
			item["payment_url"] = o.PaymentURL
		}
		out = append(out, item)
	}
	writeJSON(w, 200, map[string]any{"orders": out})
}

// apiSendOrderLinks 把该邮箱下全部订单的查看链接发送到登记邮箱。
// 无订单也返回 ok（模糊响应，不泄露邮箱是否在本站下过单）。
func (s *Server) apiSendOrderLinks(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Contact string `json:"contact"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	contact := strings.TrimSpace(input.Contact)
	if !validEmail(contact) {
		writeError(w, 400, "invalid email")
		return
	}
	// 已配置 Turnstile 时同样要求人机验证。
	if s.settings.TurnstileSecret() != "" {
		if err := s.verifyTurnstileToken(strings.TrimSpace(r.Header.Get("X-Turnstile-Response")), clientIP(r), r.Host); err != nil {
			writeError(w, 403, "turnstile failed")
			return
		}
	}
	// 按邮箱冷却（5 分钟/邮箱，跨订单共享），防止向受害者邮箱轰炸。
	now := time.Now().Unix()
	key := strings.ToLower(contact)
	s.linkMu.Lock()
	last := s.linkSent[key]
	if now-last < 300 {
		s.linkMu.Unlock()
		writeError(w, 429, "发送过于频繁，请稍后再试")
		return
	}
	s.linkSent[key] = now
	s.linkMu.Unlock()
	if _, err := s.orders.SendViewLinks(contact); err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiCancelOrder(w http.ResponseWriter, r *http.Request) {
	orderNo := r.PathValue("orderNo")
	o, err := s.orders.GetOrderByNo(orderNo)
	if err != nil {
		writeError(w, 404, "订单不存在")
		return
	}
	// 订单号会出现在支付跳转/查询 URL 中，不能作为唯一凭证：
	// 新订单凭查看令牌操作；旧订单（无令牌）回退到邮箱匹配。
	if !s.orderOwned(r, o) {
		writeError(w, 403, "contact mismatch")
		return
	}
	if o.Status != models.OrderWaitingPayment {
		writeError(w, 400, "当前状态不可取消")
		return
	}
	if err := s.orders.CancelWithGateway(o.ID); err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiOrder(w http.ResponseWriter, r *http.Request) {
	orderNo := r.PathValue("orderNo")
	order, err := s.orders.GetOrderByNo(orderNo)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	owned := s.orderOwned(r, order)
	item := orderJSON(order)
	if !owned {
		// 未验证归属时不下发买家邮箱、支付地址等敏感字段。
		delete(item, "buyer_contact")
		delete(item, "payment_url")
		delete(item, "trade_id")
	}
	resp := map[string]any{"order": item}
	if owned {
		switch order.Status {
		case models.OrderPaid, models.OrderProcessing, models.OrderDelivered, models.OrderCompleted:
			cards, _ := s.orders.GetOrderCards(order.ID)
			list := []map[string]any{}
			for _, c := range cards {
				list = append(list, cardJSON(c))
			}
			resp["cards"] = list
		}
	}
	writeJSON(w, 200, resp)
}

// orderOwned 判断请求是否持有订单的访问凭证：
// 一律校验查看令牌（恒定时间比较）。存量订单已由迁移 014 回填令牌。
func (s *Server) orderOwned(r *http.Request, o models.Order) bool {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	return token != "" && hmacEqual(token, o.ViewToken)
}

// hmacEqual 恒定时间比较（用于订单查看令牌）。
func hmacEqual(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}

func (s *Server) apiPage(w http.ResponseWriter, r *http.Request) {
	st := s.settings.SiteSettings()
	slug := r.PathValue("slug")
	if slug == "privacy" {
		writeJSON(w, 200, map[string]any{"content": st.Privacy})
		return
	}
	writeJSON(w, 200, map[string]any{"content": st.Terms})
}

func (s *Server) apiSetLang(w http.ResponseWriter, r *http.Request) {
	lang := strings.TrimSpace(r.URL.Query().Get("lang"))
	if lang != "en" && lang != "zh" {
		lang = "zh"
	}
	http.SetCookie(w, &http.Cookie{Name: "lang", Value: lang, Path: "/", MaxAge: 31536000, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, 200, map[string]any{"ok": true, "lang": lang})
}

func (s *Server) apiAdminSession(w http.ResponseWriter, r *http.Request) {
	id, role, ok := s.currentSession(r)
	if !ok {
		writeError(w, 401, "unauthorized")
		return
	}
	username, _ := s.admin.AdminUsername(id)
	writeJSON(w, 200, map[string]any{"ok": true, "username": username, "role": role})
}

func (s *Server) apiAdminLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Otp      string `json:"otp"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	username := strings.TrimSpace(input.Username)
	ip := clientIP(r)
	adminID, totpEnabled, err := s.admin.Login(username, input.Password, ip)
	if err != nil {
		reason := "internal"
		msg := ""
		switch {
		case errors.Is(err, service.ErrLoginLocked):
			reason = "locked"
			msg = "尝试次数过多，账号已锁定，请 10 分钟后再试"
		case errors.Is(err, service.ErrBadCredentials):
			reason = "bad_credentials"
			msg = "invalid credentials"
		default:
			writeInternalError(w, err)
			return
		}
		logging.Security().Warn("admin login failed", zap.String("username", username), zap.String("ip", ip), zap.String("reason", reason))
		writeError(w, 403, msg)
		return
	}
	logging.Security().Info("admin login ok", zap.String("username", username), zap.String("ip", ip))
	if totpEnabled {
		if strings.TrimSpace(input.Otp) == "" {
			// 未提供 OTP，返回待验证状态
			logging.Security().Info("admin totp required", zap.String("username", username), zap.String("ip", ip))
			token := s.admin.BeginTotpPending(adminID)
			writeJSON(w, 200, map[string]any{"ok": true, "totp_required": true, "token": token})
			return
		}
		if err := s.admin.VerifyLoginTotp(adminID, strings.TrimSpace(input.Otp)); err != nil {
			if !errors.Is(err, service.ErrInvalidOtp) {
				writeInternalError(w, err)
				return
			}
			logging.Security().Warn("admin totp failed", zap.String("username", username), zap.String("ip", ip))
			writeError(w, 403, "invalid otp")
			return
		}
		logging.Security().Info("admin totp ok", zap.String("username", username), zap.String("ip", ip))
	}
	if err := s.startSession(w, r, adminID); err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "totp_required": false})
}

func (s *Server) apiAdminLoginVerify(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Token string `json:"token"`
		Otp   string `json:"otp"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	adminID, ok := s.admin.TakeTotpPending(input.Token)
	if !ok {
		writeError(w, 401, "invalid or expired token")
		return
	}
	if err := s.admin.VerifyLoginTotp(adminID, input.Otp); err != nil {
		if !errors.Is(err, service.ErrInvalidOtp) {
			writeInternalError(w, err)
			return
		}
		writeError(w, 403, "invalid otp")
		return
	}
	if err := s.startSession(w, r, adminID); err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminLogout(w http.ResponseWriter, r *http.Request) {
	if id, ok := s.sessionID(r); ok {
		_ = s.admin.DeleteSession(id)
	}
	// 同时清除两种名称（HTTPS 的 __Host- 与纯 HTTP 的普通名）。
	http.SetCookie(w, &http.Cookie{Name: "__Host-shop_session", Value: "", Path: "/", MaxAge: -1, Secure: true})
	http.SetCookie(w, &http.Cookie{Name: "shop_session", Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiDashboard(w http.ResponseWriter, r *http.Request) {
	dayStart := models.StartOfDayIn(models.Now(), models.LocationFromTimezone(s.settings.SiteSettings().Timezone))
	data, err := s.stats.Dashboard(dayStart, s.settings.LowStockThreshold())
	if err != nil {
		writeInternalError(w, err)
		return
	}
	lowStock := []map[string]any{}
	for _, v := range data.LowStock {
		lowStock = append(lowStock, map[string]any{"id": v.Product.ID, "name": v.Product.Name, "price_cents": v.Product.PriceCents, "available": v.Available})
	}
	recent := []map[string]any{}
	for _, o := range data.RecentOrders {
		recent = append(recent, map[string]any{
			"id": o.ID, "order_no": o.OrderNo, "product_name": o.ProductName,
			"qty": o.Qty, "amount": fmt.Sprintf("%.2f", float64(o.AmountCents)/100),
			"fiat": o.Fiat, "status": o.Status, "created_at": o.CreatedAt,
		})
	}

	// 系统状态
	var dbSize int64
	if st, err := os.Stat(s.dbPath); err == nil {
		dbSize = st.Size()
	}
	ver := runtime.Version()
	uptime := int64(time.Since(s.startTime).Seconds())

	writeJSON(w, 200, map[string]any{
		"today_orders":     data.TodayOrders,
		"today_sales":      data.TodaySales,
		"today_revenue":    data.TodayRevenue,
		"today_cost":       data.TodayCost,
		"today_profit":     data.TodayProfit,
		"today_paid_cards": data.TodayPaidCards,
		"pending_orders":   data.PendingOrders,
		"payment_failed":   data.PaymentFailed,
		"delivery_failed":  data.DeliveryFailed,
		"products":         data.Products,
		"available_cards":  data.AvailableCards,
		"sold_cards":       data.SoldCards,
		"locked_cards":     data.LockedCards,
		"low_stock":        lowStock,
		"recent_orders":    recent,
		"system": map[string]any{
			"go_version": ver,
			"db_size":    dbSize,
			"uptime":     uptime,
		},
	})
}

// apiAdminSalesReport 返回销售报表（近 N 日营收曲线 + 商品销售占比）。
func (s *Server) apiAdminSalesReport(w http.ResponseWriter, r *http.Request) {
	days := 14
	if d, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && d > 0 && d <= 90 {
		days = d
	}
	daily, products, orderTime, migrationEstimate, unknown, err := s.stats.SalesReport(days)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"daily":    daily,
		"products": products,
		"cost_source_stats": map[string]int{
			"order_time":         orderTime,
			"migration_estimate": migrationEstimate,
			"unknown":            unknown,
		},
	})
}

func (s *Server) apiAdminProducts(w http.ResponseWriter, r *http.Request) {
	views, err := s.products.List(false)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, v := range views {
		item := productJSON(v.Product)
		item["available"] = v.Available
		item["reserved"] = v.Reserved
		item["sold"] = v.Sold
		out = append(out, item)
	}
	writeJSON(w, 200, map[string]any{"products": out})
}

func (s *Server) apiAdminProduct(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	v, err := s.products.GetView(id)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	writeJSON(w, 200, map[string]any{"product": productJSON(v.Product), "available": v.Available})
}

func productFromJSON(input map[string]any) (models.Product, error) {
	name := strings.TrimSpace(str(input["name"]))
	if name == "" {
		return models.Product{}, errString("name required")
	}
	priceText := strings.TrimSpace(str(input["price"]))
	if priceText == "" {
		priceText = strings.TrimSpace(str(input["price_cents"]))
		if priceText != "" {
			if n, err := strconv.ParseInt(priceText, 10, 64); err == nil {
				priceText = strconv.FormatFloat(float64(n)/100, 'f', 2, 64)
			}
		}
	}
	price, err := models.CentsFromYuan(priceText)
	if err != nil || price <= 0 {
		return models.Product{}, errString("invalid price")
	}
	status := "disabled"
	if str(input["status"]) == "active" || input["status"] == true {
		status = "active"
	}
	sortOrder, _ := strconv.Atoi(strings.TrimSpace(str(input["sort_order"])))
	if sortOrder < 0 {
		sortOrder = 0
	}
	faq := []models.FAQItem{}
	if items, ok := input["faq"].([]any); ok {
		for _, it := range items {
			if m, ok := it.(map[string]any); ok {
				q := strings.TrimSpace(str(m["q"]))
				a := strings.TrimSpace(str(m["a"]))
				if q != "" && a != "" {
					faq = append(faq, models.FAQItem{Q: q, A: a})
				}
			}
		}
	}
	// 批发价/限购/成本价
	wholesale := []models.WholesaleTier{}
	if items, ok := input["wholesale"].([]any); ok {
		for _, it := range items {
			if m, ok := it.(map[string]any); ok {
				minQty, _ := strconv.Atoi(str(m["min_qty"]))
				discount, _ := strconv.Atoi(str(m["discount"]))
				if minQty > 0 && discount > 0 && discount < 100 {
					wholesale = append(wholesale, models.WholesaleTier{MinQty: minQty, Discount: discount})
				}
			}
		}
	}
	minQty, _ := strconv.Atoi(str(input["min_qty"]))
	if minQty < 1 {
		minQty = 1
	}
	maxQty, _ := strconv.Atoi(str(input["max_qty"]))
	if maxQty < minQty {
		maxQty = 100
	}
	costCents, _ := strconv.ParseInt(str(input["cost_cents"]), 10, 64)
	if costCents < 0 {
		costCents = 0
	}
	return models.Product{
		Name:        name,
		Description: strings.TrimSpace(str(input["description"])),
		ImageURL:    strings.TrimSpace(str(input["image_url"])),
		PriceCents:  price,
		Status:      status,
		Category:    strings.TrimSpace(str(input["category"])),
		SortOrder:   sortOrder,
		IsPinned:    input["is_pinned"] == true,
		FAQ:         faq,
		Wholesale:   wholesale,
		MinQty:      minQty,
		MaxQty:      maxQty,
		CostCents:   costCents,
	}, nil
}

type strErr string

func (e strErr) Error() string { return string(e) }
func errString(s string) error { return strErr(s) }

func str(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	default:
		return ""
	}
}

func (s *Server) apiAdminProductCreate(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	p, err := productFromJSON(input)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if err := s.products.Create(p); err != nil {
		writeInternalError(w, err)
		return
	}
	s.audit(r, "product_create", "product", p.Name, "", fmt.Sprintf("price=%d status=%s", p.PriceCents, p.Status))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminProductUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	p, err := productFromJSON(input)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	oldName := s.products.GetName(id)
	if err := s.products.Update(p, id); err != nil {
		writeInternalError(w, err)
		return
	}
	s.audit(r, "product_update", "product", fmt.Sprintf("%d", id), oldName, fmt.Sprintf("name=%s price=%d status=%s", p.Name, p.PriceCents, p.Status))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminCards(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	cards, err := s.products.Cards(id)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, c := range cards {
		out = append(out, cardJSON(c))
	}
	writeJSON(w, 200, map[string]any{"cards": out})
}

func (s *Server) apiAdminCardsImport(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	var input struct {
		Cards  string `json:"cards"`
		Dedupe bool   `json:"dedupe"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input)
	lines := []string{}
	for _, line := range strings.Split(input.Cards, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	added, skipped, err := s.products.ImportCards(id, lines, input.Dedupe)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	s.audit(r, "cards_import", "product", fmt.Sprintf("%d", id), "", fmt.Sprintf("added=%d skipped=%d", added, skipped))
	writeJSON(w, 200, map[string]any{"ok": true, "added": added, "skipped": skipped})
}

// apiAdminCardsExport 导出商品卡密 CSV（可用 + 已售）。
func (s *Server) apiAdminCardsExport(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	cards, err := s.products.Cards(id)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=cards_%d.csv", id))
	w.Write([]byte("\xEF\xBB\xBF"))
	w.Write([]byte("ID,内容,状态,售出时间\n"))
	for _, c := range cards {
		ts := "-"
		if c.SoldAt > 0 {
			ts = models.FormatBeijing(c.SoldAt)
		}
		fmt.Fprintf(w, "%d,%s,%s,%s\n", c.ID, csvSafe(c.Content), c.Status, ts)
	}
}

func (s *Server) apiAdminCardDelete(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	_ = s.products.DeleteCard(id)
	s.audit(r, "card_delete", "card", fmt.Sprintf("%d", id), "", "deleted")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminCardStatus 手动设置卡密状态（available/locked/sold/disabled）。
func (s *Server) apiAdminCardStatus(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	var input struct {
		Status string `json:"status"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input)
	status := strings.TrimSpace(input.Status)
	if err := s.products.SetCardStatus(id, status); err != nil {
		if errors.Is(err, models.ErrCardBusy) {
			writeError(w, 409, err.Error())
			return
		}
		writeError(w, 400, err.Error())
		return
	}
	s.audit(r, "card_status", "card", fmt.Sprintf("%d", id), "", "status="+status)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func orderFilterArgs(r *http.Request) (string, []any) {
	where := []string{"1=1"}
	args := []any{}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		where = append(where, "(order_no LIKE ? OR product_name LIKE ? OR buyer_contact LIKE ?)")
		like := "%" + q + "%"
		args = append(args, like, like, like)
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		where = append(where, "status = ?")
		args = append(args, status)
	}
	if start := strings.TrimSpace(r.URL.Query().Get("start")); start != "" {
		if ts, err := strconv.ParseInt(start, 10, 64); err == nil {
			where = append(where, "created_at >= ?")
			args = append(args, ts)
		}
	}
	if end := strings.TrimSpace(r.URL.Query().Get("end")); end != "" {
		if ts, err := strconv.ParseInt(end, 10, 64); err == nil {
			where = append(where, "created_at <= ?")
			args = append(args, ts)
		}
	}
	return strings.Join(where, " AND "), args
}

func (s *Server) apiAdminOrdersExport(w http.ResponseWriter, r *http.Request) {
	where, args := orderFilterArgs(r)
	orders, err := s.orders.ListOrders(where, args, 5000)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	tz := models.LocationFromTimezone(s.settings.SiteSettings().Timezone)
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=orders.csv")
	w.Write([]byte("\xEF\xBB\xBF"))
	w.Write([]byte("ID,订单号,商品,数量,金额,法币,收款类型,联系方式,状态,创建时间,支付时间\n"))
	for _, o := range orders {
		fmt.Fprintf(w, "%d,%s,%s,%d,%s,%s,%s,%s,%s,%s,%s\n",
			o.ID, csvSafe(o.OrderNo), csvSafe(o.ProductName), o.Qty,
			fmt.Sprintf("%.2f", float64(o.AmountCents)/100), csvSafe(o.Fiat), csvSafe(o.TradeType),
			csvSafe(o.BuyerContact), csvSafe(o.Status),
			time.Unix(o.CreatedAt, 0).In(tz).Format("2006-01-02 15:04:05"),
			map[bool]string{true: time.Unix(o.PaidAt, 0).In(tz).Format("2006-01-02 15:04:05"), false: "-"}[o.PaidAt > 0],
		)
	}
}

// csvSafe 防止 CSV 公式注入：以 = + - @ 开头的单元格前缀单引号。
func csvSafe(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@':
		return "'" + s
	}
	return s
}

func (s *Server) apiAdminOrders(w http.ResponseWriter, r *http.Request) {
	where, args := orderFilterArgs(r)
	orders, err := s.orders.ListOrders(where, args, 500)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, o := range orders {
		out = append(out, orderJSON(o))
	}
	writeJSON(w, 200, map[string]any{"orders": out})
}

func (s *Server) apiAdminOrder(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	o, err := s.orders.GetOrderByID(id)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	cards, _ := s.orders.GetOrderCards(o.ID)
	list := []map[string]any{}
	for _, c := range cards {
		list = append(list, cardJSON(c))
	}
	logs, _ := s.orders.Logs(o.ID)
	logList := []map[string]any{}
	for _, e := range logs {
		logList = append(logList, map[string]any{
			"id":         e.ID,
			"event":      e.Event,
			"message":    e.Message,
			"from":       e.From,
			"to":         e.To,
			"admin_id":   e.AdminID,
			"metadata":   e.Metadata,
			"created_at": e.CreatedAt,
		})
	}
	writeJSON(w, 200, map[string]any{"order": orderJSON(o), "cards": list, "logs": logList})
}

func (s *Server) apiAdminOrderExpire(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	if err := s.orders.ExpireWithGateway(id); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	s.audit(r, "order_expire", "order", fmt.Sprintf("%d", id), "", "")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminOrderCancel 管理员取消订单（释放预留卡密并同步取消 BEpusdt 交易）。
func (s *Server) apiAdminOrderCancel(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	o, err := s.orders.GetOrderByID(id)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	if err := s.orders.CancelWithGateway(id); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	s.audit(r, "order_cancel", "order", fmt.Sprintf("%d", id), o.Status, models.OrderCancelled)
	writeJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminOrderSetStatus 管理员手动修改订单状态（必须在状态机合法迁移内）。
func (s *Server) apiAdminOrderSetStatus(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	var input struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	input.Status = strings.TrimSpace(input.Status)
	if !models.IsValidOrderStatus(input.Status) {
		writeError(w, 400, "invalid status")
		return
	}
	o, err := s.orders.GetOrderByID(id)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	if o.Status == input.Status {
		writeJSON(w, 200, map[string]any{"ok": true, "noop": true})
		return
	}
	if err := s.orders.SetStatus(id, input.Status, firstNonEmpty(input.Message, "管理员手动修改状态")); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	s.audit(r, "order_status", "order", fmt.Sprintf("%d", id), o.Status, input.Status)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminOrderResend(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	if err := s.orders.Resend(id); err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminOrdersBatchResend 批量重发选中订单的通知（已支付且有卡密）。
func (s *Server) apiAdminOrdersBatchResend(w http.ResponseWriter, r *http.Request) {
	var input struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	if len(input.IDs) > 100 {
		writeError(w, 400, "批量重发最多 100 单")
		return
	}
	sent, err := s.orders.BatchResend(input.IDs)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	s.audit(r, "orders_batch_resend", "orders", "", "", fmt.Sprintf("sent=%d", sent))
	writeJSON(w, 200, map[string]any{"ok": true, "sent": sent})
}
func (s *Server) apiAdminOrderRedeliver(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	before, err := s.orders.GetOrderStatus(id)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	if err := s.orders.Redeliver(id); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	s.audit(r, "order_redeliver", "order", fmt.Sprintf("%d", id), before, models.OrderDelivered)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminSettings(w http.ResponseWriter, r *http.Request) {
	cfg := s.settings.PaymentConfig()
	writeJSON(w, 200, map[string]any{
		"bepusdt_base_url":      cfg.BepusdtBaseURL,
		"bepusdt_api_token_set": cfg.BepusdtToken != "",
		"fiat":                  s.settings.Fiat(),
		"trade_types":           strings.Join(s.settings.TradeTypes(), ","),
		"bepusdt_timeout_sec":   cfg.BepusdtTimeoutSec,
		"shop_public_base_url":  cfg.PublicBaseURL,
		"bepusdt_notify_path":   s.settings.NotifyPath(),
		"bepusdt_notify_url":    cfg.NotifyURL,
	})
}

func (s *Server) apiAdminSettingsSave(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	if err := s.settings.SavePayment(input); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	s.audit(r, "payment_update", "settings", "payment", "", "支付配置已更新")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminNotify(w http.ResponseWriter, r *http.Request) {
	cfg := s.notifySvc.CurrentConfig()
	events := s.settings.Get("notify_events")
	adminEmail := s.settings.Get("notify_admin_email")
	if events == "" {
		events = "order_created,payment_success,delivered,low_stock,system_error"
	}
	writeJSON(w, 200, map[string]any{
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
		"event_templates":    s.notifySvc.EventTemplates(),
	})
}

func (s *Server) apiAdminNotifySave(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	if err := s.settings.SaveNotify(input); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	s.audit(r, "notify_update", "settings", "notify", "", "通知配置已更新")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminNotifyTestEvent 发送指定事件的测试通知（channel: telegram / mail / 空=自动）。
func (s *Server) apiAdminNotifyTestEvent(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Event   string `json:"event"`
		Channel string `json:"channel"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	input.Event = strings.TrimSpace(input.Event)
	switch input.Event {
	case notify.EventOrderCreated, notify.EventPaymentSuccess, notify.EventDelivered,
		notify.EventLowStock, notify.EventSystemError:
	default:
		writeError(w, 400, "invalid event")
		return
	}
	if err := s.notifySvc.SendTestEvent(input.Event, strings.TrimSpace(input.Channel)); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminNotifyTestEmail(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email string `json:"test_email"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input)
	if !validEmail(strings.TrimSpace(input.Email)) {
		writeError(w, 400, "invalid email")
		return
	}
	if err := s.notifySvc.SendTestEmail(strings.TrimSpace(input.Email)); err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminNotifyTestTelegram(w http.ResponseWriter, r *http.Request) {
	if err := s.notifySvc.SendTestTelegram(); err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminSite(w http.ResponseWriter, r *http.Request) {
	st := s.settings.SiteSettings()
	rawCopyright := s.settings.Get("site_copyright")
	if rawCopyright == "" {
		rawCopyright = "© {{year}} {{site_title}}. All rights reserved."
	}
	writeJSON(w, 200, map[string]any{
		"site_title":            st.Title,
		"site_subtitle":         st.Subtitle,
		"shop_public_base_url":  s.settings.PaymentConfig().PublicBaseURL,
		"site_announcement":     st.Announcement,
		"seo_description":       st.SEODescription,
		"seo_keywords":          st.SEOKeywords,
		"site_contact":          st.Contact,
		"site_friend_links":     st.FriendLinks,
		"site_copyright":        rawCopyright,
		"privacy_policy":        st.Privacy,
		"terms_of_service":      st.Terms,
		"turnstile_site_key":    s.settings.TurnstileSiteKey(),
		"turnstile_secret_set":  s.settings.TurnstileSecret() != "",
		"maintenance_enabled":   s.settings.Get("maintenance_enabled"),
		"maintenance_message":   s.settings.Get("maintenance_message"),
		"maintenance_pass_set":  s.settings.MaintenancePassSet(),
		"site_links":            s.settings.SiteLinks(),
		"default_product_image": s.settings.DefaultProductImage(),
		"site_logo":             s.settings.SiteLogoURL(),
		"site_favicon":          s.settings.SiteFaviconURL(),
		"site_locale":           st.Locale,
		"site_currency":         st.Currency,
		"site_timezone":         st.Timezone,
		"stock_display_mode":    st.StockDisplay,
		"home_view_mode":        s.settings.HomeViewMode(),
	})
}

func (s *Server) apiAdminSiteSave(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	if err := s.settings.SaveSite(input); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	s.audit(r, "site_update", "settings", "site", "", "站点配置已更新")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminAccount(w http.ResponseWriter, r *http.Request) {
	id := s.currentAdminID(r)
	username, _ := s.admin.AdminUsername(id)
	writeJSON(w, 200, map[string]any{"username": username})
}

func (s *Server) apiAdminAccountSave(w http.ResponseWriter, r *http.Request) {
	id := s.currentAdminID(r)
	var input struct {
		Username        string `json:"username"`
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
		ConfirmPassword string `json:"confirm_password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	hash, err := s.admin.AdminPasswordHash(id)
	if err != nil {
		writeError(w, 500, "no admin")
		return
	}
	if !models.CheckPassword(input.CurrentPassword, hash) {
		writeError(w, 400, "current password wrong")
		return
	}
	username := strings.TrimSpace(input.Username)
	if username == "" {
		writeError(w, 400, "username empty")
		return
	}
	oldUsername, _ := s.admin.AdminUsername(id)
	if input.NewPassword != "" {
		if err := models.ValidatePasswordStrength(input.NewPassword); err != nil {
			writeError(w, 400, err.Error())
			return
		}
		if input.NewPassword != input.ConfirmPassword {
			writeError(w, 400, "password mismatch")
			return
		}
		hash = models.HashPassword(input.NewPassword)
	}
	if len(username) > 64 {
		writeError(w, 400, "username too long")
		return
	}
	if err := s.admin.UpdateAccount(id, username, hash); err != nil {
		if errors.Is(err, models.ErrUsernameTaken) {
			writeError(w, 400, "用户名已存在")
			return
		}
		writeInternalError(w, err)
		return
	}
	s.audit(r, "account_update", "admin", fmt.Sprintf("%d", id), oldUsername+" / "+(map[bool]string{true: "密码已修改", false: "密码未变"}[input.NewPassword != ""]), username+" / "+map[bool]string{true: "密码已修改", false: "密码未变"}[input.NewPassword != ""])
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- TOTP 双因素 ----------

func (s *Server) apiAdminTotpStatus(w http.ResponseWriter, r *http.Request) {
	id := s.currentAdminID(r)
	enabled, plainSecret, err := s.admin.TotpStatus(id)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	resp := map[string]any{"enabled": enabled, "issuer": s.settings.SiteSettings().Title}
	if !enabled && plainSecret != "" {
		resp["secret"] = plainSecret // 仅绑定时返回，用于扫码
	}
	writeJSON(w, 200, resp)
}

// apiAdminTotpGenerate 生成新的 TOTP 密钥（未启用时）。
func (s *Server) apiAdminTotpGenerate(w http.ResponseWriter, r *http.Request) {
	id := s.currentAdminID(r)
	secret, err := s.admin.GenerateTotp(id)
	if errors.Is(err, service.ErrTotpAlreadyEnabled) {
		writeError(w, 400, "TOTP already enabled")
		return
	}
	if err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"secret": secret, "issuer": s.settings.SiteSettings().Title})
}

func (s *Server) apiAdminTotpEnable(w http.ResponseWriter, r *http.Request) {
	id := s.currentAdminID(r)
	var input struct {
		Secret string `json:"secret"`
		Otp    string `json:"otp"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	if err := s.admin.EnableTotp(id, input.Secret, input.Otp); err != nil {
		if errors.Is(err, service.ErrInvalidOtp) {
			writeError(w, 403, "invalid otp")
			return
		}
		writeInternalError(w, err)
		return
	}
	s.audit(r, "totp_enable", "admin", fmt.Sprintf("%d", id), "", "TOTP enabled")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminTotpDisable(w http.ResponseWriter, r *http.Request) {
	id := s.currentAdminID(r)
	var input struct {
		Otp string `json:"otp"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input)
	if err := s.admin.DisableTotp(id, input.Otp); err != nil {
		if errors.Is(err, service.ErrInvalidOtp) {
			writeError(w, 403, "invalid otp")
			return
		}
		writeInternalError(w, err)
		return
	}
	s.audit(r, "totp_disable", "admin", fmt.Sprintf("%d", id), "", "TOTP disabled")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- 管理员管理 (仅 admin) ----------

func (s *Server) apiAdminListAdmins(w http.ResponseWriter, r *http.Request) {
	admins, err := s.admin.ListAdmins()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, a := range admins {
		out = append(out, map[string]any{"id": a.ID, "username": a.Username, "role": a.Role, "created_at": a.CreatedAt})
	}
	writeJSON(w, 200, map[string]any{"admins": out})
}

func (s *Server) apiAdminCreateAdmin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	username := strings.TrimSpace(input.Username)
	if username == "" {
		writeError(w, 400, "username required")
		return
	}
	if len(username) > 64 {
		writeError(w, 400, "username too long")
		return
	}
	if err := models.ValidatePasswordStrength(input.Password); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	role := strings.TrimSpace(input.Role)
	if role != models.RoleAdmin && role != models.RoleOperator && role != models.RoleViewer {
		role = models.RoleOperator
	}
	if err := s.admin.CreateAdmin(username, input.Password, role); err != nil {
		writeError(w, 400, "create failed (username may exist)")
		return
	}
	s.audit(r, "admin_create", "admin", username, "", role)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminSetRole(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	var input struct {
		Role string `json:"role"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input)
	role := strings.TrimSpace(input.Role)
	if role != models.RoleAdmin && role != models.RoleOperator && role != models.RoleViewer {
		writeError(w, 400, "invalid role")
		return
	}
	before, _ := s.admin.AdminRole(id)
	if err := s.admin.SetRole(id, role); err != nil {
		if errors.Is(err, service.ErrAdminNotFound) {
			writeError(w, 404, "admin not found")
			return
		}
		if errors.Is(err, service.ErrLastAdmin) {
			writeError(w, 400, "cannot demote the last admin")
			return
		}
		writeInternalError(w, err)
		return
	}
	s.audit(r, "admin_role", "admin", fmt.Sprintf("%d", id), before, role)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminDeleteAdmin(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	if id == s.currentAdminID(r) {
		writeError(w, 400, "cannot delete yourself")
		return
	}
	uname, _ := s.admin.AdminUsername(id)
	if err := s.admin.DeleteAdmin(id); err != nil {
		if errors.Is(err, service.ErrLastAdmin) {
			writeError(w, 400, "cannot delete the last admin")
			return
		}
		writeInternalError(w, err)
		return
	}
	s.audit(r, "admin_delete", "admin", fmt.Sprintf("%d", id), uname, "deleted")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- 审计日志 (仅 admin) ----------

func (s *Server) apiAdminAuditLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := s.admin.AuditLogs(200)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, l := range logs {
		out = append(out, map[string]any{
			"id": l.ID, "admin_id": l.AdminID, "username": l.Username,
			"action": l.Action, "target_type": l.TargetType, "target_id": l.TargetID,
			"before": l.Before, "after": l.After, "created_at": l.CreatedAt,
		})
	}
	writeJSON(w, 200, map[string]any{"logs": out})
}

// ---------- 优惠券管理 ----------

// apiAdminJobs 返回后台任务执行记录（每个任务最近一次）+ 邮件队列积压数。
func (s *Server) apiAdminJobs(w http.ResponseWriter, r *http.Request) {
	runs, pending, dead, err := s.jobsSvc.Runs()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, run := range runs {
		out = append(out, map[string]any{
			"job_name":    run.JobName,
			"status":      run.Status,
			"started_at":  run.StartedAt,
			"finished_at": run.FinishedAt,
			"error":       run.Error,
		})
	}
	writeJSON(w, 200, map[string]any{"jobs": out, "mail_queue_pending": pending, "dead_events": dead})
}

func (s *Server) apiAdminCoupons(w http.ResponseWriter, r *http.Request) {
	coupons, err := s.orders.ListCoupons()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, c := range coupons {
		out = append(out, map[string]any{
			"id": c.ID, "code": c.Code, "type": c.Type, "value_cents": c.ValueCents,
			"percent": c.Percent, "min_amount_cents": c.MinAmountCents, "max_uses": c.MaxUses,
			"used_count": c.UsedCount, "product_id": c.ProductID, "active": c.Active,
			"expires_at": c.ExpiresAt, "created_at": c.CreatedAt,
		})
	}
	writeJSON(w, 200, map[string]any{"coupons": out})
}

func couponFromJSON(input map[string]any) (models.Coupon, error) {
	code := strings.ToUpper(strings.TrimSpace(str(input["code"])))
	if code == "" {
		return models.Coupon{}, errString("code required")
	}
	cType := strings.TrimSpace(str(input["type"]))
	if cType != "fixed" && cType != "percent" {
		return models.Coupon{}, errString("type 必须为 fixed 或 percent")
	}
	value, _ := strconv.ParseInt(str(input["value_cents"]), 10, 64)
	percent, _ := strconv.Atoi(str(input["percent"]))
	minAmount, _ := strconv.ParseInt(str(input["min_amount_cents"]), 10, 64)
	maxUses, _ := strconv.Atoi(str(input["max_uses"]))
	productID, _ := strconv.ParseInt(str(input["product_id"]), 10, 64)
	expiresAt, _ := strconv.ParseInt(str(input["expires_at"]), 10, 64)
	active := str(input["active"]) != "false" && input["active"] != false
	if cType == "fixed" && value <= 0 {
		return models.Coupon{}, errString("fixed 券 value_cents 必须大于 0")
	}
	if cType == "percent" && (percent <= 0 || percent > 100) {
		return models.Coupon{}, errString("percent 券 percent 必须在 1-100 之间")
	}
	if minAmount < 0 {
		return models.Coupon{}, errString("min_amount_cents 不能为负数")
	}
	if maxUses < 0 {
		return models.Coupon{}, errString("max_uses 不能为负数")
	}
	if expiresAt != 0 && expiresAt <= models.Now() {
		return models.Coupon{}, errString("expires_at 必须是未来的时间")
	}
	return models.Coupon{
		Code: code, Type: cType, ValueCents: value, Percent: percent,
		MinAmountCents: minAmount, MaxUses: maxUses, ProductID: productID,
		Active: active, ExpiresAt: expiresAt,
	}, nil
}

func (s *Server) apiAdminCouponCreate(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	c, err := couponFromJSON(input)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if err := s.orders.CreateCoupon(c); err != nil {
		writeError(w, 400, "create failed (code may exist)")
		return
	}
	s.audit(r, "coupon_create", "coupon", c.Code, "", fmt.Sprintf("type=%s value=%d", c.Type, c.ValueCents))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminCouponUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	c, err := couponFromJSON(input)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	c.ID = id
	if err := s.orders.UpdateCoupon(c); err != nil {
		if errors.Is(err, models.ErrCouponExists) {
			writeError(w, 400, "券码已存在")
			return
		}
		writeInternalError(w, err)
		return
	}
	s.audit(r, "coupon_update", "coupon", c.Code, "", fmt.Sprintf("type=%s value=%d active=%v", c.Type, c.ValueCents, c.Active))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminCouponDelete(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	_ = s.orders.DeleteCoupon(id)
	s.audit(r, "coupon_delete", "coupon", fmt.Sprintf("%d", id), "", "deleted")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminSystemBackup(w http.ResponseWriter, r *http.Request) {
	settings, err := s.settings.BackupSettings()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=liteshop-settings.json")
	writeJSON(w, 200, map[string]any{"app": "liteshop", "settings": settings})
}

func (s *Server) apiAdminSystemRestore(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, 400, "bad upload")
		return
	}
	file, _, err := r.FormFile("backup_file")
	if err != nil {
		writeError(w, 400, "no file")
		return
	}
	defer file.Close()
	var payload struct {
		Settings map[string]string `json:"settings"`
	}
	if err := json.NewDecoder(io.LimitReader(file, 8<<20)).Decode(&payload); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	count, err := s.settings.RestoreSettings(payload.Settings)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	s.admin.ClearPendingTotps()
	_ = s.admin.DeleteAllSessions()
	// 配置恢复后清空限流器，避免旧 IP 限制残留影响管理员操作
	s.limitersMu.Lock()
	s.limiters = make(map[string]*RateLimiter)
	s.limitersMu.Unlock()
	s.audit(r, "system_restore", "settings", "system", "", fmt.Sprintf("restored %d settings", count))
	writeJSON(w, 200, map[string]any{"ok": true, "count": count})
}

func (s *Server) apiAdminSystemReset(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Confirm string `json:"confirm"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input)
	if strings.TrimSpace(input.Confirm) != "DELETE" {
		writeError(w, 400, "confirm required")
		return
	}
	if err := s.settings.ResetAll(); err != nil {
		writeInternalError(w, err)
		return
	}
	s.admin.ClearPendingTotps()
	_ = s.admin.DeleteAllSessions()
	s.audit(r, "system_reset", "system", "all", "all data", "reset")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiSetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"initialized": s.admin.HasAdmin(), "site_title": s.settings.SiteSettings().Title})
}

func (s *Server) apiSetup(w http.ResponseWriter, r *http.Request) {
	if s.admin.HasAdmin() {
		writeError(w, 400, "already initialized")
		return
	}
	var input struct {
		SiteTitle       string `json:"site_title"`
		Username        string `json:"username"`
		Password        string `json:"password"`
		Confirm         string `json:"confirm"`
		PublicBaseURL   string `json:"public_base_url"`
		BepusdtBaseURL  string `json:"bepusdt_base_url"`
		BepusdtAPIToken string `json:"bepusdt_api_token"`
		TradeTypes      string `json:"trade_types"`
		Fiat            string `json:"fiat"`
		TurnstileSite   string `json:"turnstile_site_key"`
		TurnstileSecret string `json:"turnstile_secret"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	username := strings.TrimSpace(input.Username)
	if username == "" {
		username = "admin"
	}
	if len(username) > 64 {
		writeError(w, 400, "用户名过长")
		return
	}
	if err := models.ValidatePasswordStrength(input.Password); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if input.Password != input.Confirm {
		writeError(w, 400, "两次密码不一致")
		return
	}
	siteTitle := strings.TrimSpace(input.SiteTitle)
	if siteTitle == "" {
		siteTitle = "LiteShop"
	}
	inserted, err := s.admin.SeedAdmin(username, input.Password)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if !inserted {
		writeError(w, 400, "already initialized")
		return
	}
	if err := s.settings.ApplySetup(service.SetupInput{
		SiteTitle:       siteTitle,
		PublicBaseURL:   input.PublicBaseURL,
		BepusdtBaseURL:  input.BepusdtBaseURL,
		BepusdtAPIToken: input.BepusdtAPIToken,
		TradeTypes:      input.TradeTypes,
		Fiat:            input.Fiat,
		TurnstileSite:   input.TurnstileSite,
		TurnstileSecret: input.TurnstileSecret,
	}); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminVersion 返回当前版本并异步检查 GitHub 最新 release。
func (s *Server) apiAdminVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"version":        version.Version,
		"build":          version.String(),
		"commit":         version.Commit,
		"date":           version.Date,
		"config_version": s.settings.ConfigVersion(),
		"repo":           "mhan24/liteshop",
	})
}
