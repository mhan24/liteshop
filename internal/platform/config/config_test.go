package config

import "testing"

func TestLoadListenAddrOverride(t *testing.T) {
	t.Setenv("LITESHOP_LISTEN_ADDR", "127.0.0.1:18080")
	if got := Load().ListenAddr; got != "127.0.0.1:18080" {
		t.Fatalf("ListenAddr = %q", got)
	}
}
