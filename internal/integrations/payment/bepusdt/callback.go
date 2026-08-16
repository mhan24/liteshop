package bepusdt

import (
	"bytes"
	"crypto/hmac"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	orderapp "shop/internal/modules/order/application"
)

// VerifyCallback 校验回调签名并解析为归一化回调（状态已转内部 PaymentTxStatus）。
func (c *Client) VerifyCallback(body []byte) (orderapp.PaymentCallback, error) {
	params, err := ParseAndVerifyCallback(body, c.apiToken)
	if err != nil {
		return orderapp.PaymentCallback{}, err
	}
	return orderapp.PaymentCallback{
		OrderID:            params["order_id"],
		TradeID:            params["trade_id"],
		BlockTransactionID: params["block_transaction_id"],
		Amount:             params["amount"],
		Currency:           params["fiat"],
		Status:             normalizeStatus(params["status"]),
	}, nil
}

// Sign 计算 BEpusdt 协议签名（MD5；安全性依赖共享 Token 与恒定时间比较）。
func Sign(params map[string]string, token string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "signature" || params[k] == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(params[k])
	}
	b.WriteString(token)
	sum := md5.Sum([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

// ParseAndVerifyCallback 解析回调负载并验签，返回原始参数（供测试与回调使用）。
func ParseAndVerifyCallback(payload []byte, token string) (map[string]string, error) {
	dec := json.NewDecoder(bytes.NewReader(payload))
	dec.UseNumber()
	var raw map[string]any
	if err := dec.Decode(&raw); err != nil {
		return nil, err
	}
	params := make(map[string]string, len(raw))
	for k, v := range raw {
		if k == "signature" || v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			if t != "" {
				params[k] = t
			}
		case json.Number:
			if t.String() != "" {
				params[k] = t.String()
			}
		case float64:
			params[k] = strconv.FormatFloat(t, 'f', -1, 64)
		case bool:
			params[k] = strconv.FormatBool(t)
		default:
			s := fmt.Sprint(t)
			if s != "" && s != "<nil>" {
				params[k] = s
			}
		}
	}
	got, _ := raw["signature"].(string)
	want := Sign(params, token)
	if !hmac.Equal([]byte(strings.ToLower(got)), []byte(strings.ToLower(want))) {
		return nil, fmt.Errorf("invalid signature")
	}
	return params, nil
}
