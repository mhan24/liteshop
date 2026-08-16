package app

import "net"

// cloudflarePrefixes Cloudflare 边缘 IP 段（来源：https://www.cloudflare.com/ips-v4 与 ips-v6）。
// 若 Cloudflare 更新段位，需同步刷新（站点经 Cloudflare 代理时，仅这些 IP 可以设置可信的
// CF-Connecting-IP，防止直连客户端伪造头部绕过限流）。
var cloudflarePrefixes = func() []*net.IPNet {
	var out []*net.IPNet
	for _, cidr := range []string{
		"173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
		"141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
		"197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
		"104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
		"2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
		"2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
	} {
		if _, ipnet, err := net.ParseCIDR(cidr); err == nil {
			out = append(out, ipnet)
		}
	}
	return out
}()

// isCloudflareIP 判断 IP 是否属于 Cloudflare 边缘。
func isCloudflareIP(ip net.IP) bool {
	for _, p := range cloudflarePrefixes {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}
