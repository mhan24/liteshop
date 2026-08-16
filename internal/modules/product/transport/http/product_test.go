package http

import (
	productdomain "shop/internal/modules/product/domain"
	"testing"
)

// TestProductFromJSONDeliveryType 保存商品时交付方式字段必须生效（回归：曾漏解析导致永远 auto）。
func TestProductFromJSONDeliveryType(t *testing.T) {
	base := map[string]any{
		"name":  "测试商品",
		"price": "10.00",
	}
	manual := map[string]any{}
	for k, v := range base {
		manual[k] = v
	}
	manual["delivery_type"] = "manual"
	p, err := productFromJSON(manual)
	if err != nil {
		t.Fatalf("productFromJSON(manual): %v", err)
	}
	if p.DeliveryType != productdomain.DeliveryTypeManual {
		t.Fatalf("delivery_type = %q, want manual", p.DeliveryType)
	}

	// 未传 / 非法值回退 auto
	for _, v := range []any{nil, "", "weird"} {
		m := map[string]any{"name": "测试商品", "price": "10.00"}
		if v != nil {
			m["delivery_type"] = v
		}
		p, err := productFromJSON(m)
		if err != nil {
			t.Fatalf("productFromJSON: %v", err)
		}
		if p.DeliveryType != productdomain.DeliveryTypeAuto {
			t.Fatalf("delivery_type = %q, want auto", p.DeliveryType)
		}
	}
}
