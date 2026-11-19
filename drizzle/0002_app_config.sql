-- 站点配置：settings 键值表（全部字符串）→ app_config 单行 JSON（有类型）。
-- 结构与默认值以 src/server/settings.ts 的 configSchema 为准；这里只做存量数据的一次性转换。
-- 凭据只搬运 enc:v1 密文（明文凭据丢弃，需在后台重新录入）；空值不写入，读取时回落默认值。
CREATE TABLE "app_config" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_config_singleton" CHECK (id = 1)
);
--> statement-breakpoint
WITH kv AS (
	SELECT key, NULLIF(btrim(value), '') AS v FROM "settings"
),
pick AS (
	SELECT
		max(v) FILTER (WHERE key = 'site_name') AS site_name,
		max(v) FILTER (WHERE key = 'site_url') AS site_url,
		max(v) FILTER (WHERE key = 'support_url') AS support_url,
		max(v) FILTER (WHERE key = 'card_low_stock_threshold') AS low_stock,
		max(v) FILTER (WHERE key = 'admin_session_version') AS session_version,
		max(v) FILTER (WHERE key = 'litepay_enabled') AS lp_enabled,
		max(v) FILTER (WHERE key = 'litepay_api_base') AS lp_api_base,
		max(v) FILTER (WHERE key = 'litepay_token_enc') AS lp_token,
		max(v) FILTER (WHERE key = 'litepay_timeout_seconds') AS lp_timeout,
		max(v) FILTER (WHERE key = 'litepay_currencies') AS lp_currencies,
		max(v) FILTER (WHERE key = 'litepay_reselect') AS lp_reselect,
		max(v) FILTER (WHERE key = 'smtp_enabled') AS smtp_enabled,
		max(v) FILTER (WHERE key = 'smtp_host') AS smtp_host,
		max(v) FILTER (WHERE key = 'smtp_port') AS smtp_port,
		max(v) FILTER (WHERE key = 'smtp_secure') AS smtp_secure,
		max(v) FILTER (WHERE key = 'smtp_user') AS smtp_user,
		max(v) FILTER (WHERE key = 'smtp_pass') AS smtp_pass,
		max(v) FILTER (WHERE key = 'smtp_from') AS smtp_from,
		max(v) FILTER (WHERE key = 'turnstile_enabled') AS ts_enabled,
		max(v) FILTER (WHERE key = 'turnstile_site_key') AS ts_site_key,
		max(v) FILTER (WHERE key = 'turnstile_secret_key') AS ts_secret,
		max(v) FILTER (WHERE key = 'turnstile_fallback_enabled') AS ts_fallback
	FROM kv
)
INSERT INTO "app_config" ("id", "data")
SELECT 1, jsonb_strip_nulls(jsonb_build_object(
	'siteName', site_name,
	'siteUrl', site_url,
	'supportUrl', support_url,
	'lowStockThreshold', CASE WHEN low_stock ~ '^\d{1,9}$' THEN low_stock::int END,
	'adminSessionVersion', CASE WHEN session_version ~ '^\d{1,9}$' THEN session_version::int END,
	'litepayEnabled', CASE WHEN lp_enabled IS NOT NULL THEN lp_enabled = '1' END,
	'litepayApiBase', lp_api_base,
	'litepayTokenEnc', CASE WHEN lp_token LIKE 'enc:v1:%' THEN lp_token END,
	'litepayTimeoutSeconds', CASE WHEN lp_timeout ~ '^\d{1,9}$' THEN lp_timeout::int END,
	'litepayCurrencies', lp_currencies,
	'litepayReselect', CASE WHEN lp_reselect IS NOT NULL THEN lp_reselect <> '0' END,
	'smtpEnabled', CASE WHEN smtp_enabled IS NOT NULL THEN smtp_enabled = '1' END,
	'smtpHost', smtp_host,
	'smtpPort', CASE WHEN smtp_port ~ '^\d{1,5}$' THEN smtp_port::int END,
	'smtpSecure', CASE WHEN smtp_secure IS NOT NULL THEN smtp_secure <> '0' END,
	'smtpUser', smtp_user,
	'smtpPassEnc', CASE WHEN smtp_pass LIKE 'enc:v1:%' THEN smtp_pass END,
	'smtpFrom', smtp_from,
	'turnstileEnabled', CASE WHEN ts_enabled IS NOT NULL THEN ts_enabled = '1' END,
	'turnstileSiteKey', ts_site_key,
	'turnstileSecretEnc', CASE WHEN ts_secret LIKE 'enc:v1:%' THEN ts_secret END,
	'turnstileFallback', CASE WHEN ts_fallback IS NOT NULL THEN ts_fallback = '1' END
))
FROM pick;
--> statement-breakpoint
DROP TABLE "settings" CASCADE;
