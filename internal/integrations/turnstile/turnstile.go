// Package turnstile 封装 Cloudflare Turnstile 人机验证客户端。
package turnstile

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// HTTPClient siteverify 使用的 HTTP 客户端（测试可替换）。
var HTTPClient = &http.Client{Timeout: 10 * time.Second}

// Verify 调用 Cloudflare siteverify 校验令牌。
// secret 为空时返回未配置错误；token 为空返回缺少令牌错误。
func Verify(secret, token, remoteIP, host string) error {
	if secret == "" {
		return errors.New("TURNSTILE_SECRET is not configured")
	}
	if token == "" {
		return errors.New("missing cf-turnstile-response")
	}
	form := url.Values{}
	form.Set("secret", secret)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, err := http.NewRequest(http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var result struct {
		Success    bool     `json:"success"`
		ErrorCodes []string `json:"error-codes"`
		Hostname   string   `json:"hostname"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return err
	}
	if !result.Success {
		return fmt.Errorf("siteverify rejected token: %s", strings.Join(result.ErrorCodes, ","))
	}
	// hostname 校验：令牌必须签发自当前请求的主机，防止跨站复用；
	// 以 IP 直连/本地开发时不强制（避免非域名部署被误拒）。
	if result.Hostname != "" && host != "" {
		reqHost := host
		if h, _, err := net.SplitHostPort(host); err == nil {
			reqHost = h
		}
		if net.ParseIP(reqHost) == nil && !strings.EqualFold(result.Hostname, reqHost) {
			return fmt.Errorf("turnstile hostname mismatch: %s != %s", result.Hostname, reqHost)
		}
	}
	return nil
}
