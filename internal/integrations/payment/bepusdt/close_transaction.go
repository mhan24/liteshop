package bepusdt

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	orderapp "shop/internal/modules/order/application"
)

// CancelTransaction 关闭指定交易（取消/过期订单时调用）。
func (c *Client) CancelTransaction(tradeID string) error {
	if c.apiToken == "" {
		return orderapp.ErrGatewayNotConfigured
	}
	if tradeID == "" {
		return fmt.Errorf("trade_id is empty")
	}
	params := map[string]string{"trade_id": tradeID}
	params["signature"] = Sign(params, c.apiToken)
	body := map[string]any{
		"trade_id":  tradeID,
		"signature": params["signature"],
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/api/v1/order/cancel-transaction", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out cancelResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return fmt.Errorf("decode bepusdt cancel response: %w; body=%s", err, string(respBody))
	}
	if out.StatusCode != http.StatusOK {
		return fmt.Errorf("bepusdt cancel transaction failed: status=%d message=%s body=%s", out.StatusCode, out.Message, string(respBody))
	}
	return nil
}
