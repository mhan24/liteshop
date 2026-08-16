package http

import (
	"net/http"
	productapp "shop/internal/modules/product/application"
	"shop/internal/platform/httpserver"
	"strconv"
	"strings"
)

func (h *Handlers) Products(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	minPrice, _ := strconv.ParseFloat(r.URL.Query().Get("min_price"), 64)
	maxPrice, _ := strconv.ParseFloat(r.URL.Query().Get("max_price"), 64)
	groups, err := h.deps.Products.ListCategories(true, q, category, minPrice, maxPrice)
	if err != nil {
		httpserver.WriteInternalError(w, err)
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
	cats, _ := h.deps.Products.AllCategories()
	httpserver.WriteJSON(w, 200, map[string]any{
		"categories":     out,
		"categories_all": cats,
	})
}

func (h *Handlers) Product(w http.ResponseWriter, r *http.Request) {
	param := r.PathValue("id")
	var (
		v   productapp.View
		err error
	)
	// 支持 /products/{id} 或 /products/{slug}
	if id, perr := strconv.ParseInt(param, 10, 64); perr == nil {
		v, err = h.deps.Products.GetActiveView(id)
	} else {
		v, err = h.deps.Products.GetBySlug(param)
	}
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{
		"product":               productJSONPublic(v.Product),
		"available":             v.Available,
		"trade_types":           h.deps.Settings.TradeTypes(),
		"payment_gateway":       h.deps.Settings.GatewayName(),
		"turnstile_site_key":    h.deps.Settings.TurnstileSiteKey(),
		"default_product_image": h.deps.Settings.DefaultProductImage(),
		"site_title":            h.deps.Settings.SiteSettings().Title,
		"payment_gateways":      h.deps.Settings.EnabledGateways(),
		"payment_gateway_meta":  h.deps.Settings.AllGatewayMeta(),
	})
}
