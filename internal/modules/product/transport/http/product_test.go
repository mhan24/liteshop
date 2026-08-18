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

func TestProductJSONForRoleHidesCostFromViewer(t *testing.T) {
	p := productdomain.Product{ID: 1, Name: "商品", PriceCents: 1000, CostCents: 400}
	viewer := productJSONForRole(p, "viewer")
	if _, ok := viewer["cost_cents"]; ok {
		t.Fatal("viewer product response must not include cost_cents")
	}
	operator := productJSONForRole(p, "operator")
	if operator["cost_cents"] != int64(400) {
		t.Fatalf("operator cost_cents = %#v, want 400", operator["cost_cents"])
	}
}

func TestCentsFromYuanRejectsNonFiniteAndOverflow(t *testing.T) {
	for _, input := range []string{"NaN", "+Inf", "-Inf", "1e300"} {
		if _, err := centsFromYuan(input); err == nil {
			t.Fatalf("centsFromYuan(%q) should fail", input)
		}
	}
	if got, err := centsFromYuan("1.23"); err != nil || got != 123 {
		t.Fatalf("centsFromYuan(1.23) = %d, %v; want 123", got, err)
	}
}
