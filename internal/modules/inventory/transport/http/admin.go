package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"shop/internal/models"
	inventorydomain "shop/internal/modules/inventory/domain"
	productdomain "shop/internal/modules/product/domain"
	"shop/internal/platform/httpserver"
	"strings"
)

func (h *Handlers) AdminCards(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	cards, err := h.deps.Inventory.Cards(id)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, c := range cards {
		out = append(out, cardJSON(c))
	}
	httpserver.WriteJSON(w, 200, map[string]any{"cards": out})
}

func (h *Handlers) AdminCardsImport(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	if v, err := h.deps.Products.GetView(id); err == nil && v.Product.DeliveryType == productdomain.DeliveryTypeManual {
		httpserver.WriteError(w, 400, "人工交付商品无需卡密库存，请先切换为卡密自动发货")
		return
	}
	var input struct {
		Cards  string `json:"cards"`
		Dedupe bool   `json:"dedupe"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	lines := []string{}
	for _, line := range strings.Split(input.Cards, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	added, skipped, err := h.deps.Inventory.ImportCards(id, lines, input.Dedupe)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "cards_import", "product", fmt.Sprintf("%d", id), "", fmt.Sprintf("added=%d skipped=%d", added, skipped))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true, "added": added, "skipped": skipped})
}

// apiAdminCardsExport 导出商品卡密 CSV（可用 + 已售）。

func (h *Handlers) AdminCardsExport(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	cards, err := h.deps.Inventory.Cards(id)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
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

func (h *Handlers) AdminCardDelete(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	if err := h.deps.Inventory.DeleteCard(id); err != nil {
		if errors.Is(err, inventorydomain.ErrCardBusy) {
			httpserver.WriteError(w, 409, err.Error())
			return
		}
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "card_delete", "card", fmt.Sprintf("%d", id), "", "deleted")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminCardStatus 手动设置卡密状态（available/locked/sold/disabled）。

func (h *Handlers) AdminCardStatus(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	var input struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	status := strings.TrimSpace(input.Status)
	if err := h.deps.Inventory.SetCardStatus(id, status); err != nil {
		if errors.Is(err, inventorydomain.ErrCardBusy) {
			httpserver.WriteError(w, 409, err.Error())
			return
		}
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	h.deps.Audit(r, "card_status", "card", fmt.Sprintf("%d", id), "", "status="+status)
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}
