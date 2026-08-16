// Package domain 商品领域模型。
package domain

import (
	"strings"
	"unicode"
)

// Product 商品。
type Product struct {
	ID           int64
	Name         string
	Description  string
	ImageURL     string
	PriceCents   int64
	Status       string
	Category     string
	SortOrder    int
	IsPinned     bool
	FAQ          []FAQItem
	Wholesale    []WholesaleTier
	MinQty       int
	MaxQty       int
	CostCents    int64
	DeliveryType string
	CreatedAt    int64
	UpdatedAt    int64
}

// 商品交付方式。
const (
	DeliveryTypeAuto   = "auto"
	DeliveryTypeManual = "manual"
)

// WholesaleTier 阶梯价档位。
type WholesaleTier struct {
	MinQty   int `json:"min_qty"`
	Discount int `json:"discount"`
}

// FAQItem 常见问题条目。
type FAQItem struct {
	Q string `json:"q"`
	A string `json:"a"`
}

// ProductView 商品视图（含库存统计）。
type ProductView struct {
	Product   Product
	Available int
	Reserved  int
	Sold      int
}

// Slugify 将商品名转为 URL 友好的 slug。
func Slugify(s string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
			prevDash = false
		} else {
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
			}
			prevDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "p"
	}
	return out
}
