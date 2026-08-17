package sqlite

import "testing"

func TestSecretSettingKeysIncludesPaymentPrivateKeys(t *testing.T) {
	required := map[string]bool{
		"bepusdt_api_token":  false,
		"hashpay_private_key": false,
		"smtp_password":      false,
		"telegram_bot_token": false,
		"webhook_secret":     false,
		"turnstile_secret":   false,
		"maintenance_password": false,
	}
	for _, key := range SecretSettingKeys {
		if _, ok := required[key]; ok {
			required[key] = true
		}
	}
	for key, found := range required {
		if !found {
			t.Fatalf("secret key %q missing from SecretSettingKeys", key)
		}
	}
}
