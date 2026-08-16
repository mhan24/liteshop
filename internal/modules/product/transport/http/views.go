package http

import "shop/internal/modules/product/domain"

// productJSON 商品管理视图（含成本等经营数据）。
func productJSON(p domain.Product) map[string]any {
	faq := []map[string]string{}
	for _, f := range p.FAQ {
		faq = append(faq, map[string]string{"q": f.Q, "a": f.A})
	}
	wholesale := []map[string]any{}
	for _, t := range p.Wholesale {
		wholesale = append(wholesale, map[string]any{"min_qty": t.MinQty, "discount": t.Discount})
	}
	return map[string]any{
		"id": p.ID, "name": p.Name, "slug": domain.Slugify(p.Name),
		"description": p.Description, "image_url": p.ImageURL,
		"price_cents": p.PriceCents, "status": p.Status, "category": p.Category,
		"sort_order": p.SortOrder, "is_pinned": p.IsPinned,
		"faq": faq, "wholesale": wholesale,
		"min_qty": p.MinQty, "max_qty": p.MaxQty,
		"cost_cents": p.CostCents, "delivery_type": p.DeliveryType,
		"created_at": p.CreatedAt, "updated_at": p.UpdatedAt,
	}
}

// productJSONPublic 公开商品视图（不含成本价等敏感数据）。
func productJSONPublic(p domain.Product) map[string]any {
	out := productJSON(p)
	delete(out, "cost_cents")
	return out
}
