package bepusdt

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	orderapp "shop/internal/modules/order/application"
)

// CreateTransaction 创建支付交易，返回收银台地址与交易 ID。
func (c *Client) CreateTransaction(in orderapp.CreateInput) (string, string, error) {
	if c.apiToken == "" {
		return "", "", orderapp.ErrGatewayNotConfigured
	}
	amount := strconv.FormatFloat(in.Amount, 'f', -1, 64)
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
	params["signature"] = Sign(params, c.apiToken)
	body := map[string]any{
		"order_id":     in.OrderID,
		"amount":       in.Amount,
		"fiat":         in.Fiat,
		"trade_type":   in.TradeType,
		"name":         in.Name,
		"notify_url":   in.NotifyURL,
		"redirect_url": in.RedirectURL,
		"timeout":      in.TimeoutSec,
		"signature":    params["signature"],
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/api/v1/order/create-transaction", bytes.NewReader(raw))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
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
