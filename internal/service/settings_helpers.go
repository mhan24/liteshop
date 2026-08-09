package service

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
)

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func str(v any) string {
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

func normalizeFiat(v string) (string, error) {
	v = strings.ToUpper(strings.TrimSpace(v))
	if len(v) < 3 || len(v) > 10 {
		return "", errors.New("法币代码长度需为 3-10 位，例如 CNY/USD")
	}
	for _, r := range v {
		if r < 'A' || r > 'Z' {
			return "", errors.New("法币代码只能包含英文字母，例如 CNY/USD")
		}
	}
	return v, nil
}

func validTradeType(v string) bool {
	if !strings.Contains(v, ".") {
		return false
	}
	for i, r := range v {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.'
		if !ok {
			return false
		}
		if r == '.' && (i == 0 || i == len(v)-1) {
			return false
		}
	}
	return true
}

func normalizeTradeTypes(v string) (string, error) {
	seen := make(map[string]bool)
	var out []string
	for _, part := range strings.Split(v, ",") {
		p := strings.ToLower(strings.TrimSpace(part))
		if p == "" {
			continue
		}
		if !validTradeType(p) {
			return "", errors.New("无效的收款类型：" + p)
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return "", errors.New("至少填写一个收款类型")
	}
	return strings.Join(out, ","), nil
}

func normalizeHTTPURL(v string, required bool) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		if required {
			return "", errors.New("URL 不能为空")
		}
		return "", nil
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("URL 必须是 http/https 格式")
	}
	return strings.TrimRight(v, "/"), nil
}
