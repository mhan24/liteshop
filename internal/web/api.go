package web

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"shop/internal/db"
	"shop/internal/models"
	"shop/internal/notify"
	"shop/internal/product"
	"shop/internal/security"
	"strconv"
	"strings"
	"time"
)

type apiResponse struct {
	OK bool `json:"ok"`
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

func (s *Server) registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/maintenance/unlock", s.apiMaintenanceUnlock)
	mux.HandleFunc("GET /api/v1/setup", s.apiSetupStatus)
	mux.HandleFunc("POST /api/v1/setup", s.apiSetup)
	mux.HandleFunc("GET /api/v1/site", s.apiSite)
	mux.HandleFunc("GET /api/v1/products", s.apiProducts)
	mux.HandleFunc("GET /api/v1/products/{id}", s.apiProduct)
	mux.HandleFunc("POST /api/v1/orders", s.rateLimitMiddleware("orders", 20, s.apiCreateOrder))
	mux.HandleFunc("GET /api/v1/orders", s.apiOrdersByContact)
	mux.HandleFunc("GET /api/v1/orders/{orderNo}", s.apiOrder)
	mux.HandleFunc("POST /api/v1/orders/{orderNo}/cancel", s.apiCancelOrder)
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
	mux.Handle("GET /api/v1/admin/site", s.requireAdminAPI(http.HandlerFunc(s.apiAdminSite)))
	mux.Handle("POST /api/v1/admin/site", s.requireRole(models.RoleAdmin, http.HandlerFunc(s.apiAdminSiteSave)))
	mux.Handle("GET /api/v1/admin/account", s.requireAdminAPI(http.HandlerFunc(s.apiAdminAccount)))
	mux.Handle("POST /api/v1/admin/account", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminAccountSave)))
	mux.Handle("GET /api/v1/admin/totp", s.requireAdminAPI(http.HandlerFunc(s.apiAdminTotpStatus)))
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

func parseSiteLinks(raw string) []map[string]string {
	var arr []map[string]string
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return []map[string]string{}
	}
	return arr
}

func (s *Server) apiSite(w http.ResponseWriter, r *http.Request) {
	st := s.siteSettings()
	rawCopyright, _ := db.GetSetting(s.db, "site_copyright")
	if strings.TrimSpace(rawCopyright) == "" {
		rawCopyright = "© {{year}} {{site_title}}. All rights reserved."
	}
	maintenanceEnabled, _ := db.GetSetting(s.db, "maintenance_enabled")
	maintenanceMessage, _ := db.GetSetting(s.db, "maintenance_message")
	maintenancePassword, _ := db.GetSetting(s.db, "maintenance_password")
	enabled := strings.TrimSpace(maintenanceEnabled) == "1"
	if enabled && maintenancePassword != "" && s.maintenanceUnlocked(r, maintenancePassword) {
		enabled = false
	}
	writeJSON(w, 200, map[string]any{
		"title":                 st.Title,
		"subtitle":              st.Subtitle,
		"announcement":          st.Announcement,
		"seo_description":       firstNonEmpty(st.SEODescription, st.Subtitle),
		"seo_keywords":          st.SEOKeywords,
		"links":                 parseSiteLinks(mustGetSetting(s, "site_links")),
		"copyright":             renderSiteVars(rawCopyright, st.Title),
		"lang":                  chooseLang(r),
		"locale":                st.Locale,
		"currency":              st.Currency,
		"currency_symbol":       currencySymbol(st.Currency),
		"timezone":              st.Timezone,
		"stock_display_mode":    st.StockDisplay,
		"default_product_image": s.defaultProductImage(),
		"maintenance": map[string]any{
			"enabled": enabled,
			"message": maintenanceMessage,
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

// DefaultProductImage 是内置默认占位图。
const DefaultProductImage = "https://storage.moegirl.org.cn/moegirl/commons/0/0d/%E8%B1%86%E5%8C%85AI.png"

func (s *Server) defaultProductImage() string {
	if v := strings.TrimSpace(mustGetSetting(s, "default_product_image")); v != "" {
		return v
	}
	return DefaultProductImage
}

func (s *Server) maintenanceUnlocked(r *http.Request, password string) bool {
	c, err := r.Cookie("maint_unlock")
	if err != nil {
		return false
	}
	return c.Value == maintToken(password)
}

func maintToken(password string) string {
	sum := sha256.Sum256([]byte(password))
	return hex.EncodeToString(sum[:])
}

func (s *Server) apiMaintenanceUnlock(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	maintenanceEnabled, _ := db.GetSetting(s.db, "maintenance_enabled")
	if strings.TrimSpace(maintenanceEnabled) != "1" {
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	maintenancePassword, _ := db.GetSetting(s.db, "maintenance_password")
	if maintenancePassword == "" || strings.TrimSpace(input.Password) != strings.TrimSpace(maintenancePassword) {
		writeError(w, 403, "密码错误")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "maint_unlock", Value: maintToken(maintenancePassword), Path: "/", MaxAge: 43200, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiProducts(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	minPrice, _ := strconv.ParseFloat(r.URL.Query().Get("min_price"), 64)
	maxPrice, _ := strconv.ParseFloat(r.URL.Query().Get("max_price"), 64)
	groups, err := s.products.ListCategories(true, q, category, minPrice, maxPrice)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	out := []map[string]any{}
	for _, g := range groups {
		items := []map[string]any{}
		for _, p := range g.Products {
			items = append(items, map[string]any{"product": productJSON(p.Product), "available": p.Available, "reserved": p.Reserved, "sold": p.Sold})
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
		v   product.View
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
		"product":               productJSON(v.Product),
		"available":             v.Available,
		"trade_types":           s.tradeTypes(),
		"turnstile_site_key":    s.turnstileSiteKey(),
		"default_product_image": s.defaultProductImage(),
		"site_title":            s.siteSettings().Title,
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
	if err := s.verifyTurnstileToken(input.TurnstileResponse, clientIP(r)); err != nil {
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
		tradeType = s.tradeTypes()[0]
	}
	if !s.tradeTypeAllowed(tradeType) {
		writeError(w, 400, "invalid trade type")
		return
	}
	orderNo, paymentURL, _, _, err := s.orders.CreateOrder(p, input.Qty, input.Contact, tradeType, input.CouponCode)
	if err != nil {
		go s.notifier.NotifySystemError("创建支付交易失败: " + err.Error())
		// 若订单已创建（orderNo 非空）但支付网关失败，返回订单号供重试
		if orderNo != "" {
			writeJSON(w, 502, map[string]any{"error": err.Error(), "order_no": orderNo})
		} else {
			writeError(w, 502, err.Error())
		}
		return
	}
	// 订单创建事件通知 + 库存不足检查
	go func() {
		if o, oerr := s.orders.Repo().GetOrderByNo(orderNo); oerr == nil {
			payload := s.notifier.OrderPayload(notify.EventOrderCreated, o, nil, nil)
			s.notifier.Notify(notify.EventOrderCreated, payload)
		}
		var remain int
		_ = s.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE product_id = ? AND status = 'available'`, p.ID).Scan(&remain)
		s.notifier.NotifyLowStock(p.ID, p.Name, remain, s.lowStockThreshold())
	}()
	writeJSON(w, 200, map[string]any{"order_no": orderNo, "payment_url": paymentURL})
}

func (s *Server) apiOrdersByContact(w http.ResponseWriter, r *http.Request) {
	contact := strings.TrimSpace(r.URL.Query().Get("contact"))
	if !validEmail(contact) {
		writeError(w, 400, "invalid email")
		return
	}
	orders, err := s.orders.Repo().OrdersByContact(contact, 10)
	if err != nil {
		writeError(w, 500, err.Error())
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
		if o.Status == models.OrderWaitingPayment {
			item["order_no"] = o.OrderNo
			item["url"] = "/order/" + o.OrderNo + "?contact=" + contact
			item["payment_url"] = o.PaymentURL
		} else if o.Status != models.OrderPaid {
			item["order_no"] = o.OrderNo
			item["url"] = "/order/" + o.OrderNo + "?contact=" + contact
		}
		out = append(out, item)
	}
	writeJSON(w, 200, map[string]any{"orders": out})
}

func (s *Server) apiCancelOrder(w http.ResponseWriter, r *http.Request) {
	orderNo := r.PathValue("orderNo")
	o, err := s.orders.Repo().GetOrderByNo(orderNo)
	if err != nil {
		writeError(w, 404, "订单不存在")
		return
	}
	if o.Status != models.OrderWaitingPayment {
		writeError(w, 400, "当前状态不可取消")
		return
	}
	// 同步取消 BEpusdt 交易（失败不阻塞本地取消）
	if o.TradeID != "" {
		go func(tradeID string) {
			_ = s.payClient().CancelTransaction(tradeID)
		}(o.TradeID)
	}
	if err := s.orders.Cancel(o.ID); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiOrder(w http.ResponseWriter, r *http.Request) {
	orderNo := r.PathValue("orderNo")
	order, err := s.orders.Repo().GetOrderByNo(orderNo)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	contact := strings.TrimSpace(r.URL.Query().Get("contact"))
	resp := map[string]any{"order": orderJSON(order)}
	if contact != "" && contact == order.BuyerContact {
		switch order.Status {
		case models.OrderPaid, models.OrderProcessing, models.OrderDelivered, models.OrderCompleted:
			cards, _ := s.orders.Repo().GetOrderCards(order.ID)
			list := []map[string]any{}
			for _, c := range cards {
				list = append(list, cardJSON(c))
			}
			resp["cards"] = list
		}
	}
	writeJSON(w, 200, resp)
}

func (s *Server) apiPage(w http.ResponseWriter, r *http.Request) {
	st := s.siteSettings()
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
	var username string
	_ = s.db.QueryRow(`SELECT username FROM admins WHERE id = ?`, id).Scan(&username)
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
	var adminID int64
	var hash, totpSecret string
	var totpEnabled bool
	err := s.db.QueryRow(`SELECT id, password_hash, totp_secret, totp_enabled FROM admins WHERE username = ?`, strings.TrimSpace(input.Username)).Scan(&adminID, &hash, &totpSecret, &totpEnabled)
	if err != nil || !models.CheckPassword(input.Password, hash) {
		writeError(w, 403, "invalid credentials")
		return
	}
	if totpEnabled {
		if strings.TrimSpace(input.Otp) == "" {
			// 未提供 OTP，返回待验证状态
			token := models.RandomToken(24)
			s.sessMu.Lock()
			s.sessions["2fa:"+token] = sessionInfo{AdminID: adminID, Expiry: time.Now().Add(5 * time.Minute)}
			s.sessMu.Unlock()
			writeJSON(w, 200, map[string]any{"ok": true, "totp_required": true, "token": token})
			return
		}
		decrypted, err := s.totpCipher.Decrypt(totpSecret)
		if err != nil {
			writeError(w, 500, "totp secret decrypt failed")
			return
		}
		if !security.VerifyTotp(decrypted, input.Otp, time.Now()) {
			writeError(w, 403, "invalid otp")
			return
		}
		// 旧明文升级为加密存储（首次验证成功后回写）；失败须中断，防止迁移失败被掩盖
		if !s.totpCipher.IsEncrypted(totpSecret) {
			enc, err := s.totpCipher.Encrypt(decrypted)
			if err != nil {
				writeError(w, 500, "totp secret encrypt failed")
				return
			}
			if _, err := s.db.Exec(`UPDATE admins SET totp_secret = ? WHERE id = ?`, enc, adminID); err != nil {
				s.notifier.NotifySystemError("TOTP 旧明文升级失败 admin=" + fmt.Sprint(adminID) + ": " + err.Error())
				writeError(w, 500, "totp secret upgrade failed")
				return
			}
		}
	}
	s.startSession(w, adminID, r.TLS != nil)
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
	s.sessMu.Lock()
	info, ok := s.sessions["2fa:"+input.Token]
	if ok {
		delete(s.sessions, "2fa:"+input.Token)
	}
	s.sessMu.Unlock()
	if !ok {
		writeError(w, 401, "invalid or expired token")
		return
	}
	var totpSecret string
	_ = s.db.QueryRow(`SELECT totp_secret FROM admins WHERE id = ?`, info.AdminID).Scan(&totpSecret)
	decrypted, err := s.totpCipher.Decrypt(totpSecret)
	if err != nil {
		writeError(w, 500, "totp secret decrypt failed")
		return
	}
	if !security.VerifyTotp(decrypted, input.Otp, time.Now()) {
		writeError(w, 403, "invalid otp")
		return
	}
	// 旧明文升级为加密存储（首次验证成功后回写）；失败须中断，防止迁移失败被掩盖
	if !s.totpCipher.IsEncrypted(totpSecret) {
		enc, err := s.totpCipher.Encrypt(decrypted)
		if err != nil {
			writeError(w, 500, "totp secret encrypt failed")
			return
		}
		if _, err := s.db.Exec(`UPDATE admins SET totp_secret = ? WHERE id = ?`, enc, info.AdminID); err != nil {
			s.notifier.NotifySystemError("TOTP 旧明文升级失败 admin=" + fmt.Sprint(info.AdminID) + ": " + err.Error())
			writeError(w, 500, "totp secret upgrade failed")
			return
		}
	}
	s.startSession(w, info.AdminID, r.TLS != nil)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminLogout(w http.ResponseWriter, r *http.Request) {
	if id, ok := s.sessionID(r); ok {
		s.sessMu.Lock()
		delete(s.sessions, id)
		s.sessMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "shop_session", Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiDashboard(w http.ResponseWriter, r *http.Request) {
	dayStart := models.StartOfDayIn(models.Now(), models.LocationFromTimezone(s.siteSettings().Timezone))

	// 今日/待处理指标（订单仓储）
	todayOrders, todaySales, pendingOrders, paymentFailed, deliveryFailed, todayRevenue, err := s.orders.Repo().OrderCounts()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	var todayPaidCards int
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE status = 'sold' AND sold_at >= ?`, dayStart).Scan(&todayPaidCards)

	// 今日毛利 = 今日营收 - 今日售出卡密的商品成本
	var todayCost int64
	_ = s.db.QueryRow(`SELECT COALESCE(SUM(cost_cents * qty), 0)
		FROM orders
		WHERE status IN ('paid','processing','delivered','completed') AND paid_at >= ?`, dayStart).Scan(&todayCost)
	todayProfit := todayRevenue - todayCost

	// 商品/卡密库存（商品仓储）
	products, availableCards, soldCards, lockedCards, err := s.products.Repo().CardStockStats()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	// 库存不足
	lowStock := []map[string]any{}
	lowViews, _ := s.products.Repo().LowStock(s.lowStockThreshold())
	for _, v := range lowViews {
		lowStock = append(lowStock, map[string]any{"id": v.Product.ID, "name": v.Product.Name, "price_cents": v.Product.PriceCents, "available": v.Available})
	}

	// 最近交易
	recent := []map[string]any{}
	recentOrders, _ := s.orders.Repo().RecentOrders(8)
	for _, o := range recentOrders {
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
		"today_orders":     todayOrders,
		"today_sales":      todaySales,
		"today_revenue":    todayRevenue,
		"today_cost":       todayCost,
		"today_profit":     todayProfit,
		"today_paid_cards": todayPaidCards,
		"pending_orders":   pendingOrders,
		"payment_failed":   paymentFailed,
		"delivery_failed":  deliveryFailed,
		"products":         products,
		"available_cards":  availableCards,
		"sold_cards":       soldCards,
		"locked_cards":     lockedCards,
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
	daily, err := s.orders.Repo().DailyRevenue(days)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	products, err := s.orders.Repo().ProductSales(10)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	// 成本来源统计：区分下单真实快照/迁移估算/未知，供财务口径警示
	var orderTime, migrationEstimate, unknown int
	rows, err := s.db.Query(`SELECT cost_snapshot_source, COUNT(1) FROM orders WHERE status IN ('paid','processing','delivered','completed') GROUP BY cost_snapshot_source`)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()
	for rows.Next() {
		var src string
		var cnt int
		if err := rows.Scan(&src, &cnt); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		switch src {
		case "order_time":
			orderTime += cnt
		case "migration_estimate":
			migrationEstimate += cnt
		default:
			unknown += cnt
		}
	}
	if err := rows.Err(); err != nil {
		writeError(w, 500, err.Error())
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

// lowStockThreshold 低库存告警阈值 (可用卡密数量)。
func (s *Server) lowStockThreshold() int {
	raw := strings.TrimSpace(mustGetSetting(s, "low_stock_threshold"))
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 10
	}
	return n
}

func (s *Server) apiAdminProducts(w http.ResponseWriter, r *http.Request) {
	views, err := s.products.Repo().ListViews(false)
	if err != nil {
		writeError(w, 500, err.Error())
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
		writeError(w, 500, err.Error())
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
	oldName := s.products.Repo().GetName(id)
	if err := s.products.Update(p, id); err != nil {
		writeError(w, 500, err.Error())
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
	cards, err := s.orders.Repo().ListCardsByProduct(id)
	if err != nil {
		writeError(w, 500, err.Error())
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
	added, skipped, err := s.orders.Repo().AddCards(id, lines, input.Dedupe)
	if err != nil {
		writeError(w, 500, err.Error())
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
	cards, err := s.orders.Repo().ListCardsByProduct(id)
	if err != nil {
		writeError(w, 500, err.Error())
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
	_ = s.orders.Repo().DeleteAvailableCard(id)
	s.audit(r, "card_delete", "card", fmt.Sprintf("%d", id), "", "deleted")
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
	orders, err := s.orders.Repo().ListOrders(where, args, 5000)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	tz := models.LocationFromTimezone(s.siteSettings().Timezone)
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
	orders, err := s.orders.Repo().ListOrders(where, args, 500)
	if err != nil {
		writeError(w, 500, err.Error())
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
	o, err := s.orders.Repo().GetOrderByID(id)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	cards, _ := s.orders.Repo().GetOrderCards(o.ID)
	list := []map[string]any{}
	for _, c := range cards {
		list = append(list, cardJSON(c))
	}
	logs, _ := s.orders.Repo().Logs(o.ID)
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
	if o, oerr := s.orders.Repo().GetOrderByID(id); oerr == nil && o.TradeID != "" {
		go func(tradeID string) {
			_ = s.payClient().CancelTransaction(tradeID)
		}(o.TradeID)
	}
	_ = s.orders.Expire(id)
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
	o, err := s.orders.Repo().GetOrderByID(id)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	if o.TradeID != "" {
		go func(tradeID string) {
			_ = s.payClient().CancelTransaction(tradeID)
		}(o.TradeID)
	}
	if err := s.orders.Cancel(id); err != nil {
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
	if input.Status == "" {
		writeError(w, 400, "status required")
		return
	}
	o, err := s.orders.Repo().GetOrderByID(id)
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
	o, err := s.orders.Repo().GetOrderByID(id)
	if err == nil && (o.Status == models.OrderDelivered || o.Status == models.OrderPaid || o.Status == models.OrderCompleted || o.Status == models.OrderDeliveryFailed) {
		cards, _ := s.orders.Repo().GetOrderCards(o.ID)
		if len(cards) > 0 {
			go s.notifier.SendPaid(o, cards)
			_ = s.orders.Repo().AddLog(o.ID, "resend", "管理员重新发送卡密", o.Status, o.Status, 0)
		}
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
	sent := 0
	for _, id := range input.IDs {
		o, err := s.orders.Repo().GetOrderByID(id)
		if err != nil {
			continue
		}
		if o.Status != models.OrderDelivered && o.Status != models.OrderPaid && o.Status != models.OrderCompleted && o.Status != models.OrderDeliveryFailed {
			continue
		}
		cards, _ := s.orders.Repo().GetOrderCards(o.ID)
		if len(cards) == 0 {
			continue
		}
		s.notifier.SendPaid(o, cards)
		_ = s.orders.Repo().AddLog(o.ID, "resend", "批量重发卡密", o.Status, o.Status, 0)
		sent++
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
	before, err := s.orders.Repo().GetOrderStatus(id)
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
	cfg := s.paymentConfig()
	writeJSON(w, 200, map[string]any{
		"bepusdt_base_url":      cfg.BepusdtBaseURL,
		"bepusdt_api_token_set": cfg.BepusdtToken != "",
		"fiat":                  s.fiat(),
		"trade_types":           strings.Join(s.tradeTypes(), ","),
		"bepusdt_timeout_sec":   cfg.BepusdtTimeoutSec,
		"shop_public_base_url":  cfg.PublicBaseURL,
		"bepusdt_notify_url":    cfg.NotifyURL,
	})
}

func (s *Server) apiAdminSettingsSave(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	setIfPresent := func(key, field string) {
		if v, ok := input[field]; ok {
			_ = db.SetSetting(s.db, key, strings.TrimSpace(str(v)))
		}
	}
	setIfPresent("bepusdt_base_url", "bepusdt_base_url")
	setIfPresent("fiat", "fiat")
	setIfPresent("bepusdt_trade_types", "trade_types")
	setIfPresent("bepusdt_timeout_sec", "bepusdt_timeout_sec")
	setIfPresent("shop_public_base_url", "shop_public_base_url")
	setIfPresent("bepusdt_notify_url", "bepusdt_notify_url")
	if v := strings.TrimSpace(str(input["bepusdt_api_token"])); v != "" {
		_ = db.SetSetting(s.db, "bepusdt_api_token", v)
	}
	s.audit(r, "payment_update", "settings", "payment", "", "支付配置已更新")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminNotify(w http.ResponseWriter, r *http.Request) {
	cfg := s.notifier.CurrentConfig()
	subject, mailBody, telegramBody := s.notifier.PaidTemplates()
	events, _ := db.GetSetting(s.db, "notify_events")
	if strings.TrimSpace(events) == "" {
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
		"mail_paid_subject":  subject,
		"mail_paid_body":     mailBody,
		"telegram_paid_body": telegramBody,
	})
}

func (s *Server) apiAdminNotifySave(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	setIfPresent := func(key, field string) {
		if v, ok := input[field]; ok {
			_ = db.SetSetting(s.db, key, strings.TrimSpace(str(v)))
		}
	}
	setIfPresent("smtp_host", "smtp_host")
	setIfPresent("smtp_port", "smtp_port")
	setIfPresent("smtp_from", "smtp_from")
	setIfPresent("telegram_chat_id", "telegram_chat_id")
	setIfPresent("webhook_url", "webhook_url")
	setIfPresent("notify_events", "notify_events")
	setIfPresent("mail_paid_subject", "mail_paid_subject")
	setIfPresent("mail_paid_body", "mail_paid_body")
	setIfPresent("telegram_paid_body", "telegram_paid_body")
	if v := strings.TrimSpace(str(input["smtp_username"])); v != "" {
		_ = db.SetSetting(s.db, "smtp_username", v)
	}
	if v := strings.TrimSpace(str(input["smtp_password"])); v != "" {
		_ = db.SetSetting(s.db, "smtp_password", v)
	}
	if v := strings.TrimSpace(str(input["telegram_bot_token"])); v != "" {
		_ = db.SetSetting(s.db, "telegram_bot_token", v)
	}
	if v := strings.TrimSpace(str(input["webhook_secret"])); v != "" {
		_ = db.SetSetting(s.db, "webhook_secret", v)
	}
	s.audit(r, "notify_update", "settings", "notify", "", "通知配置已更新")
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
	if err := s.notifier.SendTestEmail(strings.TrimSpace(input.Email)); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminNotifyTestTelegram(w http.ResponseWriter, r *http.Request) {
	if err := s.notifier.SendTestTelegram(); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminSite(w http.ResponseWriter, r *http.Request) {
	st := s.siteSettings()
	rawCopyright, _ := db.GetSetting(s.db, "site_copyright")
	if strings.TrimSpace(rawCopyright) == "" {
		rawCopyright = "© {{year}} {{site_title}}. All rights reserved."
	}
	writeJSON(w, 200, map[string]any{
		"site_title":            st.Title,
		"site_subtitle":         st.Subtitle,
		"site_announcement":     st.Announcement,
		"seo_description":       st.SEODescription,
		"seo_keywords":          st.SEOKeywords,
		"site_contact":          st.Contact,
		"site_friend_links":     st.FriendLinks,
		"site_copyright":        rawCopyright,
		"privacy_policy":        st.Privacy,
		"terms_of_service":      st.Terms,
		"turnstile_site_key":    s.turnstileSiteKey(),
		"turnstile_secret_set":  s.turnstileSecret() != "",
		"maintenance_enabled":   mustGetSetting(s, "maintenance_enabled"),
		"maintenance_message":   mustGetSetting(s, "maintenance_message"),
		"maintenance_password":  mustGetSetting(s, "maintenance_password"),
		"maintenance_pass_set":  mustGetSetting(s, "maintenance_password") != "",
		"site_links":            parseSiteLinks(mustGetSetting(s, "site_links")),
		"default_product_image": s.defaultProductImage(),
		"site_locale":           st.Locale,
		"site_currency":         st.Currency,
		"site_timezone":         st.Timezone,
		"stock_display_mode":    st.StockDisplay,
	})
}

func mustGetSetting(s *Server, key string) string {
	v, _ := db.GetSetting(s.db, key)
	return v
}

func (s *Server) apiAdminSiteSave(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	setIfPresent := func(key, field string) {
		if v, ok := input[field]; ok {
			_ = db.SetSetting(s.db, key, strings.TrimSpace(str(v)))
		}
	}
	for key, field := range map[string]string{
		"site_title": "site_title", "site_subtitle": "site_subtitle", "site_announcement": "site_announcement",
		"seo_description": "seo_description", "seo_keywords": "seo_keywords", "site_contact": "site_contact",
		"site_friend_links": "site_friend_links", "site_copyright": "site_copyright",
		"privacy_policy": "privacy_policy", "terms_of_service": "terms_of_service", "turnstile_site_key": "turnstile_site_key",
		"maintenance_message": "maintenance_message", "default_product_image": "default_product_image",
		"site_locale": "site_locale", "site_currency": "site_currency", "site_timezone": "site_timezone",
		"stock_display_mode": "stock_display_mode",
	} {
		setIfPresent(key, field)
	}
	if v, ok := input["site_links"]; ok {
		if items, ok := v.([]any); ok {
			clean := []map[string]string{}
			for _, item := range items {
				m, ok := item.(map[string]any)
				if !ok {
					continue
				}
				name := strings.TrimSpace(str(m["name"]))
				if name == "" {
					continue
				}
				category := "link"
				if c := strings.TrimSpace(str(m["category"])); c == "contact" || c == "联系方式" {
					category = "contact"
				}
				clean = append(clean, map[string]string{"name": name, "url": strings.TrimSpace(str(m["url"])), "category": category})
			}
			if raw, err := json.Marshal(clean); err == nil {
				_ = db.SetSetting(s.db, "site_links", string(raw))
			}
		}
	}
	if _, exists := input["maintenance_enabled"]; exists {
		_ = db.SetSetting(s.db, "maintenance_enabled", strings.TrimSpace(str(input["maintenance_enabled"])))
	}
	if v := strings.TrimSpace(str(input["maintenance_password"])); v != "" {
		_ = db.SetSetting(s.db, "maintenance_password", v)
	}
	if v := strings.TrimSpace(str(input["turnstile_secret"])); v != "" {
		_ = db.SetSetting(s.db, "turnstile_secret", v)
	}
	s.audit(r, "site_update", "settings", "site", "", "站点配置已更新")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminAccount(w http.ResponseWriter, r *http.Request) {
	id := s.currentAdminID(r)
	var username string
	_ = s.db.QueryRow(`SELECT username FROM admins WHERE id = ?`, id).Scan(&username)
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
	var hash string
	if err := s.db.QueryRow(`SELECT password_hash FROM admins WHERE id = ?`, id).Scan(&hash); err != nil {
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
	var oldUsername string
	_ = s.db.QueryRow(`SELECT username FROM admins WHERE id = ?`, id).Scan(&oldUsername)
	if input.NewPassword != "" {
		if len(input.NewPassword) < 8 {
			writeError(w, 400, "password too short")
			return
		}
		if input.NewPassword != input.ConfirmPassword {
			writeError(w, 400, "password mismatch")
			return
		}
		hash = models.HashPassword(input.NewPassword)
	}
	if _, err := s.db.Exec(`UPDATE admins SET username = ?, password_hash = ? WHERE id = ?`, username, hash, id); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	s.audit(r, "account_update", "admin", fmt.Sprintf("%d", id), oldUsername+" / "+(map[bool]string{true: "密码已修改", false: "密码未变"}[input.NewPassword != ""]), username+" / "+map[bool]string{true: "密码已修改", false: "密码未变"}[input.NewPassword != ""])
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- TOTP 双因素 ----------

func (s *Server) apiAdminTotpStatus(w http.ResponseWriter, r *http.Request) {
	id := s.currentAdminID(r)
	var enabled bool
	var secret string
	_ = s.db.QueryRow(`SELECT totp_enabled, totp_secret FROM admins WHERE id = ?`, id).Scan(&enabled, &secret)
	resp := map[string]any{"enabled": enabled, "issuer": s.siteSettings().Title}
	if !enabled && secret != "" {
		if plain, err := s.totpCipher.Decrypt(secret); err == nil {
			resp["secret"] = plain // 仅绑定时返回，用于扫码
		}
	}
	writeJSON(w, 200, resp)
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
	if !security.VerifyTotp(input.Secret, input.Otp, time.Now()) {
		writeError(w, 403, "invalid otp")
		return
	}
	encrypted, err := s.totpCipher.Encrypt(input.Secret)
	if err != nil {
		writeError(w, 500, "totp secret encrypt failed")
		return
	}
	if _, err := s.db.Exec(`UPDATE admins SET totp_secret = ?, totp_enabled = 1 WHERE id = ?`, encrypted, id); err != nil {
		writeError(w, 500, err.Error())
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
	var secret string
	_ = s.db.QueryRow(`SELECT totp_secret FROM admins WHERE id = ?`, id).Scan(&secret)
	decrypted, err := s.totpCipher.Decrypt(secret)
	if err != nil {
		writeError(w, 500, "totp secret decrypt failed")
		return
	}
	if !security.VerifyTotp(decrypted, input.Otp, time.Now()) {
		writeError(w, 403, "invalid otp")
		return
	}
	if _, err := s.db.Exec(`UPDATE admins SET totp_enabled = 0 WHERE id = ?`, id); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	s.audit(r, "totp_disable", "admin", fmt.Sprintf("%d", id), "", "TOTP disabled")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- 管理员管理 (仅 admin) ----------

func (s *Server) apiAdminListAdmins(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, username, role, created_at FROM admins ORDER BY id`)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int64
		var username, role string
		var createdAt int64
		if err := rows.Scan(&id, &username, &role, &createdAt); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{"id": id, "username": username, "role": role, "created_at": createdAt})
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
	if username == "" || len(input.Password) < 8 {
		writeError(w, 400, "username/password invalid")
		return
	}
	role := strings.TrimSpace(input.Role)
	if role != models.RoleAdmin && role != models.RoleOperator && role != models.RoleViewer {
		role = models.RoleOperator
	}
	if _, err := s.db.Exec(`INSERT INTO admins(username, password_hash, role, created_at) VALUES(?, ?, ?, ?)`, username, models.HashPassword(input.Password), role, models.Now()); err != nil {
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
	// 防止取消最后一个 admin
	if role != models.RoleAdmin {
		var admins int
		_ = s.db.QueryRow(`SELECT COUNT(1) FROM admins WHERE role = 'admin'`).Scan(&admins)
		if admins <= 1 {
			// 被改者若是唯一 admin, 拒绝
			var cur string
			_ = s.db.QueryRow(`SELECT role FROM admins WHERE id = ?`, id).Scan(&cur)
			if cur == models.RoleAdmin && admins == 1 {
				writeError(w, 400, "cannot demote the last admin")
				return
			}
		}
	}
	var before string
	_ = s.db.QueryRow(`SELECT role FROM admins WHERE id = ?`, id).Scan(&before)
	if _, err := s.db.Exec(`UPDATE admins SET role = ? WHERE id = ?`, role, id); err != nil {
		writeError(w, 500, err.Error())
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
	var cur string
	_ = s.db.QueryRow(`SELECT role FROM admins WHERE id = ?`, id).Scan(&cur)
	if cur == models.RoleAdmin {
		var admins int
		_ = s.db.QueryRow(`SELECT COUNT(1) FROM admins WHERE role = 'admin'`).Scan(&admins)
		if admins <= 1 {
			writeError(w, 400, "cannot delete the last admin")
			return
		}
	}
	var uname string
	_ = s.db.QueryRow(`SELECT username FROM admins WHERE id = ?`, id).Scan(&uname)
	if _, err := s.db.Exec(`DELETE FROM admins WHERE id = ?`, id); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	s.audit(r, "admin_delete", "admin", fmt.Sprintf("%d", id), uname, "deleted")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- 审计日志 (仅 admin) ----------

func (s *Server) apiAdminAuditLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := db.AuditLogs(s.db, 200)
	if err != nil {
		writeError(w, 500, err.Error())
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

func (s *Server) apiAdminCoupons(w http.ResponseWriter, r *http.Request) {
	coupons, err := s.orders.Repo().ListCoupons()
	if err != nil {
		writeError(w, 500, err.Error())
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
	if err := s.orders.Repo().CreateCoupon(c); err != nil {
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
	if err := s.orders.Repo().UpdateCoupon(c); err != nil {
		writeError(w, 500, err.Error())
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
	_ = s.orders.Repo().DeleteCoupon(id)
	s.audit(r, "coupon_delete", "coupon", fmt.Sprintf("%d", id), "", "deleted")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiAdminSystemBackup(w http.ResponseWriter, r *http.Request) {
	settings, err := db.AllSettings(s.db)
	if err != nil {
		writeError(w, 500, err.Error())
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
	count := 0
	for k, v := range payload.Settings {
		if len(k) > 80 || len(v) > 20000 {
			continue
		}
		// session_secret 用于签名与 TOTP 加密派生，禁止被备份覆盖，防止会话/TOTP 密钥失配
		if k == "session_secret" {
			continue
		}
		if err := db.SetSetting(s.db, k, v); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		count++
	}
	s.sessMu.Lock()
	s.sessions = make(map[string]sessionInfo)
	s.sessMu.Unlock()
	// 配置恢复后清空限流器，避免旧 IP 限制残留影响管理员操作
	s.limitersMu.Lock()
	s.limiters = make(map[string]*RateLimiter)
	s.limitersMu.Unlock()
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
	if err := db.ResetAllTables(s.db); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	s.sessMu.Lock()
	s.sessions = make(map[string]sessionInfo)
	s.sessMu.Unlock()
	s.audit(r, "system_reset", "system", "all", "all data", "reset")
	writeJSON(w, 200, map[string]any{"ok": true})
}

var _ = sql.ErrNoRows

func (s *Server) apiSetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"initialized": db.HasAdmin(s.db), "site_title": s.siteSettings().Title})
}

func (s *Server) apiSetup(w http.ResponseWriter, r *http.Request) {
	if db.HasAdmin(s.db) {
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
	if len(input.Password) < 8 {
		writeError(w, 400, "密码至少 8 位")
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
	if err := db.SeedAdmin(s.db, username, input.Password); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	settings := map[string]string{
		"site_title":          siteTitle,
		"site_copyright":      "© {{year}} {{site_title}}. All rights reserved.",
		"bepusdt_fiat":        "CNY",
		"bepusdt_timeout_sec": "1200",
	}
	if input.Fiat != "" {
		settings["bepusdt_fiat"] = strings.TrimSpace(input.Fiat)
	}
	if strings.TrimSpace(input.PublicBaseURL) != "" {
		settings["shop_public_base_url"] = strings.TrimSpace(input.PublicBaseURL)
	}
	if strings.TrimSpace(input.BepusdtBaseURL) != "" {
		settings["bepusdt_base_url"] = strings.TrimSpace(input.BepusdtBaseURL)
	}
	if strings.TrimSpace(input.BepusdtAPIToken) != "" {
		settings["bepusdt_api_token"] = strings.TrimSpace(input.BepusdtAPIToken)
	}
	if strings.TrimSpace(input.TradeTypes) != "" {
		settings["bepusdt_trade_types"] = strings.TrimSpace(input.TradeTypes)
	}
	if strings.TrimSpace(input.TurnstileSite) != "" {
		settings["turnstile_site_key"] = strings.TrimSpace(input.TurnstileSite)
	}
	if strings.TrimSpace(input.TurnstileSecret) != "" {
		settings["turnstile_secret"] = strings.TrimSpace(input.TurnstileSecret)
	}
	for k, v := range settings {
		if err := db.SetSetting(s.db, k, v); err != nil {
			writeError(w, 500, err.Error())
			return
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// Version 为构建版本号（可由 -ldflags 覆盖）。
var Version = "v1.2.0"

// apiAdminVersion 返回当前版本并异步检查 GitHub 最新 release。
func (s *Server) apiAdminVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"version": Version, "repo": "mhan24/liteshop"})
}
