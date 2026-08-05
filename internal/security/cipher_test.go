package security

import "testing"

func TestCipherRoundTrip(t *testing.T) {
	c := NewCipher("test-session-secret")
	plain := "JBSWY3DPEHPK3PXP"
	enc, err := c.Encrypt(plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if enc == plain {
		t.Fatalf("encrypted output must not equal plaintext")
	}
	dec, err := c.Decrypt(enc)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if dec != plain {
		t.Fatalf("decrypted = %q, want %q", dec, plain)
	}
	// 每次加密应产生不同密文（随机 nonce）
	enc2, _ := c.Encrypt(plain)
	if enc2 == enc {
		t.Fatalf("encrypt must be randomized")
	}
	// 错误密钥应解密失败
	other := NewCipher("wrong-secret")
	if _, err := other.Decrypt(enc); err == nil {
		t.Fatalf("decrypt with wrong key should fail")
	}
	// 篡改密文应失败
	if _, err := c.Decrypt(enc + "A"); err == nil {
		t.Fatalf("tampered ciphertext should fail")
	}
}

func TestCipherEmptySecretKey(t *testing.T) {
	// 空密钥应拒绝初始化，防止固定密钥
	c := NewCipher("")
	if c != nil {
		t.Fatalf("NewCipher with empty secret should return nil")
	}
}

func TestCipherLegacyPlaintextCompatibility(t *testing.T) {
	c := NewCipher("test-secret")
	plain := "JBSWY3DPEHPK3PXP"
	// 旧明文（无前缀）应原样返回，标记为未加密
	if c.IsEncrypted(plain) {
		t.Fatalf("plaintext should not be marked encrypted")
	}
	dec, err := c.Decrypt(plain)
	if err != nil || dec != plain {
		t.Fatalf("legacy plaintext should pass through: %q %v", dec, err)
	}
	// 升级：加密后应带前缀且可往返
	enc, err := c.Encrypt(plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !c.IsEncrypted(enc) {
		t.Fatalf("encrypted value should carry prefix")
	}
	if len(enc) <= len("aesgcm:v1:") {
		t.Fatalf("encrypted value too short")
	}
	dec2, err := c.Decrypt(enc)
	if err != nil || dec2 != plain {
		t.Fatalf("round trip: %q %v", dec2, err)
	}
}
