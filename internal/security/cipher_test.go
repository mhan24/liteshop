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
	c := NewCipher("")
	enc, err := c.Encrypt("secret")
	if err != nil {
		t.Fatalf("encrypt with empty key: %v", err)
	}
	dec, err := c.Decrypt(enc)
	if err != nil || dec != "secret" {
		t.Fatalf("round trip with empty key: %q %v", dec, err)
	}
}
