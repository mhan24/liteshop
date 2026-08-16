// Package value 提供 HTTP 传输层通用的值转换工具（无业务语义）。
package value

import "strconv"

// Str 任意值转字符串。
func Str(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	default:
		return ""
	}
}

type strErr string

func (e strErr) Error() string { return string(e) }

// ErrString 简单错误。
func ErrString(s string) error { return strErr(s) }

// FirstNonEmpty 返回第一个非空字符串。
func FirstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// CurrencySymbol 返回货币符号（未知回退代码）。
func CurrencySymbol(currency string) string {
	switch currency {
	case "USD":
		return "$"
	case "EUR":
		return "€"
	case "GBP":
		return "£"
	case "JPY", "CNY", "RMB":
		return "¥"
	default:
		return currency
	}
}
