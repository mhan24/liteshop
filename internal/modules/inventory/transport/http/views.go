package http

import inventorydomain "shop/internal/modules/inventory/domain"

// cardJSON 卡密视图。
func cardJSON(c inventorydomain.Card) map[string]any {
	return map[string]any{
		"id": c.ID, "product_id": c.ProductID,
		"reserved_order": c.ReservedOrder, "sold_order": c.SoldOrder,
		"content": c.Content, "status": c.Status,
		"created_at": c.CreatedAt, "updated_at": c.UpdatedAt, "sold_at": c.SoldAt,
	}
}
