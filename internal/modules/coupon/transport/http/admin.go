package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"shop/internal/models"
	coupondomain "shop/internal/modules/coupon/domain"
	"shop/internal/platform/httpserver"
	"strconv"
	"strings"
)

func (h *Handlers) AdminCoupons(w http.ResponseWriter, r *http.Request) {
	coupons, err := h.deps.Coupons.ListCoupons()
	if err != nil {
		httpserver.WriteInternalError(w, err)
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
	httpserver.WriteJSON(w, 200, map[string]any{"coupons": out})
}

func couponFromJSON(input map[string]any) (coupondomain.Coupon, error) {
	code := strings.ToUpper(strings.TrimSpace(str(input["code"])))
	if code == "" {
		return coupondomain.Coupon{}, errString("code required")
	}
	cType := strings.TrimSpace(str(input["type"]))
	if cType != "fixed" && cType != "percent" {
		return coupondomain.Coupon{}, errString("type 必须为 fixed 或 percent")
	}
	value, _ := strconv.ParseInt(str(input["value_cents"]), 10, 64)
	percent, _ := strconv.Atoi(str(input["percent"]))
	minAmount, _ := strconv.ParseInt(str(input["min_amount_cents"]), 10, 64)
	maxUses, _ := strconv.Atoi(str(input["max_uses"]))
	productID, _ := strconv.ParseInt(str(input["product_id"]), 10, 64)
	expiresAt, _ := strconv.ParseInt(str(input["expires_at"]), 10, 64)
	active := str(input["active"]) != "false" && input["active"] != false
	if cType == "fixed" && value <= 0 {
		return coupondomain.Coupon{}, errString("fixed 券 value_cents 必须大于 0")
	}
	if cType == "percent" && (percent <= 0 || percent > 100) {
		return coupondomain.Coupon{}, errString("percent 券 percent 必须在 1-100 之间")
	}
	if minAmount < 0 {
		return coupondomain.Coupon{}, errString("min_amount_cents 不能为负数")
	}
	if maxUses < 0 {
		return coupondomain.Coupon{}, errString("max_uses 不能为负数")
	}
	if expiresAt != 0 && expiresAt <= models.Now() {
		return coupondomain.Coupon{}, errString("expires_at 必须是未来的时间")
	}
	return coupondomain.Coupon{
		Code: code, Type: cType, ValueCents: value, Percent: percent,
		MinAmountCents: minAmount, MaxUses: maxUses, ProductID: productID,
		Active: active, ExpiresAt: expiresAt,
	}, nil
}

func (h *Handlers) AdminCouponCreate(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	c, err := couponFromJSON(input)
	if err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	if err := h.deps.Coupons.CreateCoupon(c); err != nil {
		httpserver.WriteError(w, 400, "create failed (code may exist)")
		return
	}
	h.deps.Audit(r, "coupon_create", "coupon", c.Code, "", fmt.Sprintf("type=%s value=%d", c.Type, c.ValueCents))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminCouponUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	var input map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	c, err := couponFromJSON(input)
	if err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	c.ID = id
	if err := h.deps.Coupons.UpdateCoupon(c); err != nil {
		if errors.Is(err, coupondomain.ErrCouponExists) {
			httpserver.WriteError(w, 400, "券码已存在")
			return
		}
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "coupon_update", "coupon", c.Code, "", fmt.Sprintf("type=%s value=%d active=%v", c.Type, c.ValueCents, c.Active))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminCouponDelete(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	_ = h.deps.Coupons.DeleteCoupon(id)
	h.deps.Audit(r, "coupon_delete", "coupon", fmt.Sprintf("%d", id), "", "deleted")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}
