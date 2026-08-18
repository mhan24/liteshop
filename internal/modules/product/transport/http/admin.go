package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	productdomain "shop/internal/modules/product/domain"
	"shop/internal/platform/httpserver"
	"strconv"
	"strings"
)

func (h *Handlers) AdminProducts(w http.ResponseWriter, r *http.Request) {
	views, err := h.deps.Products.List(false)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, v := range views {
		item := productJSONForRole(v.Product, h.currentRole(r))
		item["available"] = v.Available
		item["reserved"] = v.Reserved
		item["sold"] = v.Sold
		out = append(out, item)
	}
	httpserver.WriteJSON(w, 200, map[string]any{"products": out})
}

func (h *Handlers) AdminProduct(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	v, err := h.deps.Products.GetView(id)
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{"product": productJSONForRole(v.Product, h.currentRole(r)), "available": v.Available})
}

func (h *Handlers) currentRole(r *http.Request) string {
	if h.deps.CurrentRole == nil {
		return "viewer"
	}
	return h.deps.CurrentRole(r)
}

// centsFromYuan 元字符串 → 分（金额换算属商品模块传输层）。
func centsFromYuan(v string) (int64, error) {
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, errors.New("invalid price")
	}
	if f <= 0 || f > float64(math.MaxInt64)/100 {
		return 0, errors.New("price must be positive")
	}
	cents := f*100 + 0.5
	if cents > float64(math.MaxInt64) {
		return 0, errors.New("price too large")
	}
	return int64(cents), nil
}

func productFromJSON(input map[string]any) (productdomain.Product, error) {
	name := strings.TrimSpace(str(input["name"]))
	if name == "" {
		return productdomain.Product{}, errString("name required")
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
	price, err := centsFromYuan(priceText)
	if err != nil || price <= 0 {
		return productdomain.Product{}, errString("invalid price")
	}
	status := "disabled"
	if str(input["status"]) == "active" || input["status"] == true {
		status = "active"
	}
	sortOrder, _ := strconv.Atoi(strings.TrimSpace(str(input["sort_order"])))
	if sortOrder < 0 {
		sortOrder = 0
	}
	faq := []productdomain.FAQItem{}
	if items, ok := input["faq"].([]any); ok {
		for _, it := range items {
			if m, ok := it.(map[string]any); ok {
				q := strings.TrimSpace(str(m["q"]))
				a := strings.TrimSpace(str(m["a"]))
				if q != "" && a != "" {
					faq = append(faq, productdomain.FAQItem{Q: q, A: a})
				}
			}
		}
	}
	// 批发价/限购/成本价
	wholesale := []productdomain.WholesaleTier{}
	if items, ok := input["wholesale"].([]any); ok {
		for _, it := range items {
			if m, ok := it.(map[string]any); ok {
				minQty, _ := strconv.Atoi(str(m["min_qty"]))
				discount, _ := strconv.Atoi(str(m["discount"]))
				if minQty > 0 && discount > 0 && discount < 100 {
					wholesale = append(wholesale, productdomain.WholesaleTier{MinQty: minQty, Discount: discount})
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
	// 交付方式：auto（卡密自动发货，默认）/ manual（人工手动交付）
	deliveryType := strings.TrimSpace(str(input["delivery_type"]))
	if deliveryType != productdomain.DeliveryTypeManual {
		deliveryType = productdomain.DeliveryTypeAuto
	}
	return productdomain.Product{
		Name:         name,
		Description:  strings.TrimSpace(str(input["description"])),
		ImageURL:     strings.TrimSpace(str(input["image_url"])),
		PriceCents:   price,
		Status:       status,
		Category:     strings.TrimSpace(str(input["category"])),
		SortOrder:    sortOrder,
		IsPinned:     input["is_pinned"] == true,
		FAQ:          faq,
		Wholesale:    wholesale,
		MinQty:       minQty,
		MaxQty:       maxQty,
		CostCents:    costCents,
		DeliveryType: deliveryType,
	}, nil
}

type strErr string

func (h *Handlers) AdminProductCreate(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	p, err := productFromJSON(input)
	if err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	if err := h.deps.Products.Create(p); err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "product_create", "product", p.Name, "", fmt.Sprintf("price=%d status=%s", p.PriceCents, p.Status))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminProductUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	p, err := productFromJSON(input)
	if err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	oldName := h.deps.Products.GetName(id)
	if err := h.deps.Products.Update(p, id); err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "product_update", "product", fmt.Sprintf("%d", id), oldName, fmt.Sprintf("name=%s price=%d status=%s", p.Name, p.PriceCents, p.Status))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}
