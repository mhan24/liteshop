package http

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	orderdomain "shop/internal/modules/order/domain"
	"shop/internal/platform/httpserver"
	"shop/internal/shared/clock"
	"strconv"
	"strings"
	"time"
)

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

func (h *Handlers) AdminOrdersExport(w http.ResponseWriter, r *http.Request) {
	where, args := orderFilterArgs(r)
	orders, err := h.deps.Orders.ListOrders(where, args, 5000)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	tz := clock.LocationFromTimezone(h.deps.Settings.SiteSettings().Timezone)
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", "attachment; filename=orders.csv")
	_, _ = w.Write([]byte("\xEF\xBB\xBF"))
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"ID", "订单号", "商品", "数量", "金额", "法币", "收款类型", "联系方式", "状态", "创建时间", "支付时间"})
	for _, o := range orders {
		_ = cw.Write([]string{
			strconv.FormatInt(o.ID, 10),
			csvSafe(o.OrderNo),
			csvSafe(o.ProductName),
			strconv.Itoa(o.Qty),
			fmt.Sprintf("%.2f", float64(o.AmountCents)/100),
			csvSafe(o.Fiat),
			csvSafe(o.TradeType),
			csvSafe(o.BuyerContact),
			csvSafe(string(o.Status)),
			time.Unix(o.CreatedAt, 0).In(tz).Format("2006-01-02 15:04:05"),
			map[bool]string{true: time.Unix(o.PaidAt, 0).In(tz).Format("2006-01-02 15:04:05"), false: "-"}[o.PaidAt > 0],
		})
	}
	cw.Flush()
}

// csvSafe 防止 CSV 公式注入：以 = + - @ 开头的单元格前缀单引号。

func (h *Handlers) AdminOrders(w http.ResponseWriter, r *http.Request) {
	where, args := orderFilterArgs(r)
	orders, err := h.deps.Orders.ListOrders(where, args, 500)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	out := []orderResponse{}
	role := h.currentRole(r)
	for _, o := range orders {
		item := h.toOrderResponse(o)
		if role == "viewer" {
			item = item.Public()
		}
		out = append(out, item)
	}
	httpserver.WriteJSON(w, 200, map[string]any{"orders": out})
}

func (h *Handlers) AdminOrder(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	o, err := h.deps.Orders.GetOrderByID(id)
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	cards, err := h.deps.Orders.GetOrderCards(o.ID)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	list := []cardResponse{}
	for _, c := range cards {
		list = append(list, toCardResponse(c))
	}
	logs, err := h.deps.Orders.Logs(o.ID)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	logList := []orderEventResponse{}
	for _, e := range logs {
		logList = append(logList, toOrderEventResponse(e))
	}
	httpserver.WriteJSON(w, 200, map[string]any{"order": h.toOrderResponse(o), "cards": list, "logs": logList})
}

func (h *Handlers) currentRole(r *http.Request) string {
	if h.deps.CurrentRole == nil {
		return "viewer"
	}
	return h.deps.CurrentRole(r)
}

func (h *Handlers) AdminOrderExpire(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	if err := h.deps.Orders.ExpireWithGateway(id); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	h.deps.Audit(r, "order_expire", "order", fmt.Sprintf("%d", id), "", "")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminOrderCancel 管理员取消订单（释放预留卡密并同步取消 BEpusdt 交易）。

func (h *Handlers) AdminOrderCancel(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	o, err := h.deps.Orders.GetOrderByID(id)
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	if err := h.deps.Orders.CancelWithGateway(id); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	h.deps.Audit(r, "order_cancel", "order", fmt.Sprintf("%d", id), string(o.Status), string(orderdomain.OrderCancelled))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminOrderSetStatus 管理员手动修改订单状态（必须在状态机合法迁移内）。

func (h *Handlers) AdminOrderSetStatus(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	var req adminOrderStatusRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	req.Status = strings.TrimSpace(req.Status)
	if !orderdomain.IsValidOrderStatus(orderdomain.Status(req.Status)) {
		httpserver.WriteError(w, 400, "invalid status")
		return
	}
	o, err := h.deps.Orders.GetOrderByID(id)
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	if o.Status == orderdomain.Status(req.Status) {
		httpserver.WriteJSON(w, 200, map[string]any{"ok": true, "noop": true})
		return
	}
	if err := h.deps.Orders.SetStatus(id, orderdomain.Status(req.Status), firstNonEmpty(req.Message, "管理员手动修改状态")); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	h.deps.Audit(r, "order_status", "order", fmt.Sprintf("%d", id), string(o.Status), req.Status)
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminOrderResend(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	if err := h.deps.Orders.Resend(id); err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminOrdersBatchResend 批量重发选中订单的通知（已支付且有卡密）。

func (h *Handlers) AdminOrdersBatchResend(w http.ResponseWriter, r *http.Request) {
	var req batchResendRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	if len(req.IDs) > 100 {
		httpserver.WriteError(w, 400, "批量重发最多 100 单")
		return
	}
	sent, err := h.deps.Orders.BatchResend(req.IDs)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "orders_batch_resend", "orders", "", "", fmt.Sprintf("sent=%d", sent))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true, "sent": sent})
}

func (h *Handlers) AdminOrderRedeliver(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	before, err := h.deps.Orders.GetOrderStatus(id)
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	if err := h.deps.Orders.Redeliver(id); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	h.deps.Audit(r, "order_redeliver", "order", fmt.Sprintf("%d", id), string(before), string(orderdomain.OrderDelivered))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminOrderDeliver 管理员人工发货（人工手动交付订单）：填写发货内容并通知买家。

func (h *Handlers) AdminOrderDeliver(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	var req adminDeliverRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		httpserver.WriteError(w, 400, "发货内容不能为空")
		return
	}
	before, err := h.deps.Orders.GetOrderStatus(id)
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	if err := h.deps.Orders.ManualDeliver(id, content); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	h.deps.Audit(r, "order_deliver", "order", fmt.Sprintf("%d", id), string(before), string(orderdomain.OrderDelivered))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}
