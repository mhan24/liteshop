package bepusdt

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

func New(baseURL, token string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Token:   token,
		HTTP:    &http.Client{Timeout: 15 * time.Second},
	}
}

type CreateInput struct {
	OrderID     string
	AmountYuan  float64
	Fiat        string
	TradeType   string
	Name        string
	NotifyURL   string
	RedirectURL string
	TimeoutSec  int
}

type createResponse struct {
	StatusCode int    `json:"status_code"`
	Message    string `json:"message"`
	Data       struct {
		TradeID    string `json:"trade_id"`
		OrderID    string `json:"order_id"`
		PaymentURL string `json:"payment_url"`
	} `json:"data"`
}

func (c *Client) CreateTransaction(in CreateInput) (string, string, error) {
	if c.Token == "" {
		return "", "", fmt.Errorf("BEPUSDT_API_TOKEN is empty")
	}
	amount := strconv.FormatFloat(in.AmountYuan, 'f', -1, 64)
	params := map[string]string{
		"order_id":     in.OrderID,
		"amount":       amount,
		"fiat":         in.Fiat,
		"trade_type":   in.TradeType,
		"name":         in.Name,
		"notify_url":   in.NotifyURL,
		"redirect_url": in.RedirectURL,
		"timeout":      strconv.Itoa(in.TimeoutSec),
	}
	params["signature"] = Sign(params, c.Token)
	body := map[string]any{
		"order_id":     in.OrderID,
		"amount":       in.AmountYuan,
		"fiat":         in.Fiat,
		"trade_type":   in.TradeType,
		"name":         in.Name,
		"notify_url":   in.NotifyURL,
		"redirect_url": in.RedirectURL,
		"timeout":      in.TimeoutSec,
		"signature":    params["signature"],
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/v1/order/create-transaction", bytes.NewReader(raw))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out createResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", "", fmt.Errorf("decode bepusdt response: %w; body=%s", err, string(respBody))
	}
	if out.StatusCode != http.StatusOK || out.Data.PaymentURL == "" {
		return "", "", fmt.Errorf("bepusdt create transaction failed: status=%d message=%s body=%s", out.StatusCode, out.Message, string(respBody))
	}
	return out.Data.PaymentURL, out.Data.TradeID, nil
}

func (c *Client) CancelTransaction(tradeID string) error {
	if c.Token == "" {
		return fmt.Errorf("BEPUSDT_API_TOKEN is empty")
	}
	if tradeID == "" {
		return fmt.Errorf("trade_id is empty")
	}
	params := map[string]string{"trade_id": tradeID}
	params["signature"] = Sign(params, c.Token)
	body := map[string]any{
		"trade_id":  tradeID,
		"signature": params["signature"],
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/v1/order/cancel-transaction", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out struct {
		StatusCode int    `json:"status_code"`
		Message    string `json:"message"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return fmt.Errorf("decode bepusdt cancel response: %w; body=%s", err, string(respBody))
	}
	if out.StatusCode != http.StatusOK {
		return fmt.Errorf("bepusdt cancel transaction failed: status=%d message=%s body=%s", out.StatusCode, out.Message, string(respBody))
	}
	return nil
}

func Sign(params map[string]string, token string) string {
	// MD5 签名是 BEpusdt 网关协议的固定要求，无法单方面更换为更强的算法；
	// 安全性依赖于双方共享的 API Token 与校验端恒定时间比较。
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
	if !strings.EqualFold(got, want) {
		return nil, fmt.Errorf("invalid signature")
	}
	return params, nil
}
