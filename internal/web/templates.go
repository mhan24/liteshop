package web

import (
	"embed"
	"fmt"
	"html"
	"html/template"
	"io/fs"
	"net/http"
	"strings"

	"shop/internal/models"
)

//go:embed templates static spa
var assets embed.FS

func spaAssetsFS() http.FileSystem {
	sub, err := fs.Sub(assets, "spa")
	if err != nil {
		return http.FS(assets)
	}
	return http.FS(sub)
}

func (s *Server) spaIndex(w http.ResponseWriter, r *http.Request) {
	data, err := assets.ReadFile("spa/index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

var translations = map[string]map[string]string{
	"zh": {
		"nav_products":               "商品",
		"nav_order_query":            "订单查询",
		"back_home":                  "← 返回首页",
		"back_products":              "← 返回商品列表",
		"buy_now":                    "立即购买",
		"sold_out":                   "已售罄",
		"current_stock":              "当前库存",
		"stock":                      "库存",
		"quantity":                   "购买数量",
		"email_required":             "邮箱（必填，用于查询订单和接收卡密）",
		"payment_network":            "收款币种/网络",
		"pay_now":                    "去支付",
		"product_sold_out":           "商品已售罄。",
		"turnstile_failed":           "人机验证未通过，请完成验证后重试。",
		"invalid_trade_type":         "请选择有效的收款币种/网络。",
		"invalid_contact":            "请填写有效的邮箱地址（用于接收卡密），并确认购买数量不超过库存。",
		"out_of_stock":               "库存不足，请刷新后重试。",
		"create_payment_failed":      "创建支付订单失败：",
		"order_query":                "订单查询",
		"order_no":                   "订单号",
		"product_label":              "商品",
		"amount":                     "金额",
		"trade_type":                 "收款类型",
		"status":                     "状态",
		"created_at":                 "创建时间",
		"paid_at":                    "支付时间",
		"pay":                        "继续支付",
		"cards_label":                "卡密",
		"cards_hint":                 "请立即保存卡密；页面刷新后需再次通过订单号 + 邮箱查询。",
		"contact_mismatch":           "联系方式与订单不匹配。",
		"contact_placeholder":        "下单邮箱",
		"query_order":                "查询订单/卡密",
		"no_products":                "暂无上架商品。",
		"footer_contact":             "联系方式",
		"footer_links":               "友情链接",
		"footer_legal":               "法律信息",
		"privacy":                    "隐私政策",
		"terms":                      "服务条款",
		"footer_contact_placeholder": "请通过下单邮箱联系我们。",
		"pinned":                     "置顶",
		"default_category":           "默认分类",
		"admin_brand":                "LiteShop 后台",
		"dashboard":                  "后台首页",
		"admin_products":             "商品管理",
		"admin_orders":               "订单管理",
		"payment_settings":           "支付设置",
		"notification_settings":      "通知",
		"site_settings":              "站点设置",
		"account_settings":           "账号",
		"system":                     "系统",
		"sign_out":                   "退出",
		"view_site":                  "前台",
		"admin_login_title":          "后台登录",
		"login":                      "登录",
		"username":                   "用户名",
		"password":                   "密码",
		"login_error":                "用户名或密码错误。",
		"new_product":                "新建商品",
		"edit_product":               "编辑商品",
		"id":                         "ID",
		"name":                       "名称",
		"category":                   "分类",
		"price":                      "价格",
		"sort":                       "排序",
		"sold":                       "已售",
		"actions":                    "操作",
		"yes":                        "是",
		"edit":                       "编辑",
		"no_products_admin":          "暂无商品",
		"product_name":               "商品名称",
		"product_name_empty":         "商品名称不能为空",
		"price_invalid":              "价格必须是大于 0 的数字",
		"price_cny":                  "价格（CNY）",
		"description":                "描述",
		"category_optional":          "分类（留空归入默认分类）",
		"sort_value":                 "排序值（越小越靠前）",
		"pinned_display":             "置顶显示",
		"on_sale":                    "上架销售",
		"save":                       "保存",
		"cards_management":           "卡密管理",
		"back_to_products":           "返回商品",
		"available_stock":            "可用库存",
		"import_cards":               "导入卡密",
		"import":                     "导入",
		"content":                    "内容",
		"order_id":                   "订单ID",
		"created_time":               "创建时间",
		"sold_time":                  "售出时间",
		"delete":                     "删除",
		"no_cards":                   "暂无卡密",
		"delete_card_confirm":        "确定删除该可用卡密吗？",
		"contact":                    "联系方式",
		"detail":                     "详情",
		"no_orders":                  "暂无订单",
		"order_detail":               "订单详情",
		"back_orders":                "返回订单",
		"be_trade_id":                "BEpusdt Trade ID",
		"chain_tx":                   "链上交易",
		"checkout":                   "收银台",
		"mark_expired":               "标记过期并释放库存",
		"resend_notify":              "重发通知",
		"save_effect_now":            "保存后立即生效，优先级高于 .env。",
		"api_token_masked":           "API Token 不回显，留空表示保持不变。",
		"bepusdt_base_url":           "BEpusdt Base URL",
		"bepusdt_api_token":          "BEpusdt API Token",
		"fiat":                       "法币",
		"trade_types":                "收款类型（逗号分隔）",
		"payment_timeout":            "支付超时时间（秒）",
		"public_base_url":            "前台公开地址",
		"notify_url":                 "BEpusdt 回调地址",
		"contact_info":               "联系方式（显示在底部）",
		"friend_links":               "友情链接（每行一个：名称|https://example.com）",
		"copyright":                  "版权所有",
		"privacy_policy":             "隐私政策（/privacy）",
		"terms_service":              "服务条款（/terms）",
		"mail_subject_template":      "邮件主题模板",
		"mail_body_template":         "邮件正文模板",
		"telegram_body_template":     "Telegram 正文模板",
		"placeholders":               "可用占位符说明",
		"turnstile_site_key":         "Turnstile Site Key",
		"turnstile_secret":           "Turnstile Secret（留空保持不变）",
		"not_configured":             "未配置",
		"configured_keep":            "已配置，留空保持不变",
		"smtp_host":                  "SMTP Host",
		"smtp_port":                  "SMTP Port",
		"smtp_username":              "SMTP Username",
		"smtp_password":              "SMTP Password（留空保持不变）",
		"smtp_from":                  "SMTP From",
		"telegram_chat_id":           "Telegram Chat ID",
		"telegram_bot_token":         "Telegram Bot Token",
		"smtp_mail":                  "SMTP 邮件",
		"channel_and_template":       "通知渠道与文案",
		"test_push":                  "测试推送",
		"test_email":                 "测试邮箱",
		"send_test_email":            "发送测试邮件",
		"send_telegram_test":         "发送 Telegram 测试",
		"current_password":           "当前密码",
		"new_password":               "新密码（留空不修改）",
		"confirm_new_password":       "确认新密码",
		"current_password_wrong":     "当前密码错误。",
		"username_empty":             "用户名不能为空。",
		"password_too_short":         "新密码长度至少 8 位。",
		"password_mismatch":          "两次输入的新密码不一致。",
		"config_backup":              "配置备份 / 恢复",
		"backup_note":                "备份站点/支付/通知等配置（不含商品、卡密、订单）。恢复会覆盖同名配置。",
		"download_backup":            "下载配置备份",
		"restore_config":             "恢复配置",
		"backup_file":                "选择备份文件（.json）",
		"restore_ok":                 "配置已恢复",
		"restore_failed":             "恢复失败：请上传 liteshop-settings.json。",
		"danger_zone":                "危险区",
		"reset_warning":              "「清空所有数据并重新初始化」会删除：商品、卡密、订单、站点/支付/通知配置、管理员账号。此操作不可恢复。",
		"input_delete":               "输入 DELETE 确认",
		"clear_reset":                "清空所有数据并重新初始化",
		"setup_title":                "初始化设置",
		"setup_intro":                "首次部署时配置管理员账号和基础信息。完成后可登录后台修改所有配置。",
		"site_title":                 "站点标题",
		"admin_username":             "管理员用户名",
		"admin_password":             "管理员密码（至少 8 位）",
		"confirm_admin_password":     "确认管理员密码",
		"complete_setup":             "完成初始化",
		"field_too_long":             "字段长度超出限制。",
	},
	"en": {
		"nav_products":               "Products",
		"nav_order_query":            "Order lookup",
		"back_home":                  "← Home",
		"back_products":              "← Products",
		"buy_now":                    "Buy now",
		"sold_out":                   "Sold out",
		"current_stock":              "Current stock",
		"stock":                      "Stock",
		"quantity":                   "Quantity",
		"email_required":             "Email (required, for order lookup and card delivery)",
		"payment_network":            "Currency / Network",
		"pay_now":                    "Pay now",
		"product_sold_out":           "This product is sold out.",
		"turnstile_failed":           "Verification failed, please complete Turnstile and retry.",
		"invalid_trade_type":         "Please select a valid currency / network.",
		"invalid_contact":            "Please enter a valid email and keep quantity within stock.",
		"out_of_stock":               "Out of stock, please refresh and retry.",
		"create_payment_failed":      "Failed to create payment order: ",
		"order_query":                "Order lookup",
		"order_no":                   "Order number",
		"product_label":              "Product",
		"amount":                     "Amount",
		"trade_type":                 "Currency / Network",
		"status":                     "Status",
		"created_at":                 "Created at",
		"paid_at":                    "Paid at",
		"pay":                        "Continue payment",
		"cards_label":                "Cards",
		"cards_hint":                 "Save your cards now; after refresh, query again with order number + email.",
		"contact_mismatch":           "Contact does not match the order.",
		"contact_placeholder":        "Email used at checkout",
		"query_order":                "Query order / cards",
		"no_products":                "No products available.",
		"footer_contact":             "Contact",
		"footer_links":               "Links",
		"footer_legal":               "Legal",
		"privacy":                    "Privacy Policy",
		"terms":                      "Terms of Service",
		"footer_contact_placeholder": "Please contact us via your checkout email.",
		"pinned":                     "Pinned",
		"default_category":           "Default",
		"admin_brand":                "LiteShop Admin",
		"dashboard":                  "Dashboard",
		"admin_products":             "Products",
		"admin_orders":               "Orders",
		"payment_settings":           "Payment",
		"notification_settings":      "Notifications",
		"site_settings":              "Site",
		"account_settings":           "Account",
		"system":                     "System",
		"sign_out":                   "Sign out",
		"view_site":                  "View site",
		"admin_login_title":          "Admin login",
		"login":                      "Log in",
		"username":                   "Username",
		"password":                   "Password",
		"login_error":                "Incorrect username or password.",
		"new_product":                "New product",
		"edit_product":               "Edit product",
		"id":                         "ID",
		"name":                       "Name",
		"category":                   "Category",
		"price":                      "Price",
		"sort":                       "Sort",
		"sold":                       "Sold",
		"actions":                    "Actions",
		"yes":                        "Yes",
		"edit":                       "Edit",
		"no_products_admin":          "No products",
		"product_name":               "Product name",
		"product_name_empty":         "Product name cannot be empty.",
		"price_invalid":              "Price must be a positive number.",
		"price_cny":                  "Price (CNY)",
		"description":                "Description",
		"category_optional":          "Category (blank = default)",
		"sort_value":                 "Sort value (smaller first)",
		"pinned_display":             "Pin to top",
		"on_sale":                    "List for sale",
		"save":                       "Save",
		"cards_management":           "Cards",
		"back_to_products":           "Back to products",
		"available_stock":            "Available stock",
		"import_cards":               "Import cards",
		"import":                     "Import",
		"content":                    "Content",
		"order_id":                   "Order ID",
		"created_time":               "Created at",
		"sold_time":                  "Sold at",
		"delete":                     "Delete",
		"no_cards":                   "No cards",
		"delete_card_confirm":        "Delete this available card?",
		"contact":                    "Contact",
		"detail":                     "Detail",
		"no_orders":                  "No orders",
		"order_detail":               "Order detail",
		"back_orders":                "Back to orders",
		"be_trade_id":                "BEpusdt Trade ID",
		"chain_tx":                   "On-chain transaction",
		"checkout":                   "Checkout",
		"mark_expired":               "Mark expired and release stock",
		"resend_notify":              "Resend notification",
		"save_effect_now":            "Saved settings take effect immediately and override .env.",
		"api_token_masked":           "API Token is masked; leave blank to keep unchanged.",
		"bepusdt_base_url":           "BEpusdt Base URL",
		"bepusdt_api_token":          "BEpusdt API Token",
		"fiat":                       "Fiat",
		"trade_types":                "Currency types (comma separated)",
		"payment_timeout":            "Payment timeout (seconds)",
		"public_base_url":            "Public base URL",
		"notify_url":                 "BEpusdt notify URL",
		"contact_info":               "Contact (shown in footer)",
		"friend_links":               "Links (one per line: Name|https://example.com)",
		"copyright":                  "Copyright",
		"privacy_policy":             "Privacy policy (/privacy)",
		"terms_service":              "Terms of service (/terms)",
		"mail_subject_template":      "Email subject template",
		"mail_body_template":         "Email body template",
		"telegram_body_template":     "Telegram body template",
		"placeholders":               "Placeholders",
		"turnstile_site_key":         "Turnstile Site Key",
		"turnstile_secret":           "Turnstile Secret (leave blank to keep)",
		"not_configured":             "Not configured",
		"configured_keep":            "Configured; leave blank to keep",
		"smtp_host":                  "SMTP Host",
		"smtp_port":                  "SMTP Port",
		"smtp_username":              "SMTP Username",
		"smtp_password":              "SMTP Password (leave blank to keep)",
		"smtp_from":                  "SMTP From",
		"telegram_chat_id":           "Telegram Chat ID",
		"telegram_bot_token":         "Telegram Bot Token",
		"smtp_mail":                  "SMTP",
		"channel_and_template":       "Channels & templates",
		"test_push":                  "Test",
		"test_email":                 "Test email",
		"send_test_email":            "Send test email",
		"send_telegram_test":         "Send Telegram test",
		"current_password":           "Current password",
		"new_password":               "New password (leave blank to keep)",
		"confirm_new_password":       "Confirm new password",
		"current_password_wrong":     "Current password is incorrect.",
		"username_empty":             "Username cannot be empty.",
		"password_too_short":         "New password must be at least 8 characters.",
		"password_mismatch":          "New passwords do not match.",
		"config_backup":              "Backup / restore",
		"backup_note":                "Back up site/payment/notification config (excludes products, cards, orders). Restore overwrites same keys.",
		"download_backup":            "Download backup",
		"restore_config":             "Restore config",
		"backup_file":                "Backup file (.json)",
		"restore_ok":                 "Config restored",
		"restore_failed":             "Restore failed: upload liteshop-settings.json.",
		"danger_zone":                "Danger zone",
		"reset_warning":              "“Reset all data” deletes products, cards, orders, site/payment/notification config, and admins. This cannot be undone.",
		"input_delete":               "Type DELETE to confirm",
		"clear_reset":                "Reset all data and re-initialize",
		"setup_title":                "Initial setup",
		"setup_intro":                "Configure the admin account and basics. You can change everything later in the backend.",
		"site_title":                 "Site title",
		"admin_username":             "Admin username",
		"admin_password":             "Admin password (at least 8 characters)",
		"confirm_admin_password":     "Confirm admin password",
		"complete_setup":             "Complete setup",
		"field_too_long":             "Field length exceeds limit.",
	},
}

func tr(lang, key string) string {
	if m, ok := translations[lang]; ok {
		if v, ok := m[key]; ok {
			return v
		}
	}
	if v, ok := translations["zh"][key]; ok {
		return v
	}
	return key
}

func chooseLang(r *http.Request) string {
	if c, err := r.Cookie("lang"); err == nil {
		if c.Value == "en" || c.Value == "zh" {
			return c.Value
		}
	}
	accept := r.Header.Get("Accept-Language")
	if strings.Contains(accept, "zh") {
		return "zh"
	}
	if strings.Contains(accept, "en") {
		return "en"
	}
	return "zh"
}

func loadTemplates() (*template.Template, error) {
	funcs := template.FuncMap{
		"money": func(cents int64) string { return fmt.Sprintf("%.2f", float64(cents)/100) },
		"date": func(ts int64) string {
			return models.FormatBeijing(ts)
		},
		"statusText": func(status string) string {
			switch status {
			case "pending":
				return "待支付"
			case "paid":
				return "已支付"
			case "expired":
				return "已过期"
			case "failed":
				return "创建失败"
			default:
				return status
			}
		},
		"productStatusText": func(status string) string {
			if status == "active" {
				return "上架"
			}
			return "下架"
		},
		"cardStatusText": func(status string) string {
			switch status {
			case "available":
				return "可用"
			case "reserved":
				return "已锁定"
			case "sold":
				return "已售出"
			default:
				return status
			}
		},
		"contacthtml": func(contact string) template.HTML {
			return renderContactHTML(contact)
		},
		"t": func(lang, key string) string {
			return tr(lang, key)
		},
	}
	return template.New("shop").Funcs(funcs).ParseFS(assets,
		"templates/partials/*.html",
		"templates/public/*.html",
		"templates/admin/*.html",
	)
}

func renderContactHTML(contact string) template.HTML {
	contact = strings.TrimSpace(contact)
	if contact == "" {
		return template.HTML("")
	}
	var b strings.Builder
	for _, line := range strings.Split(contact, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		href := ""
		text := ""
		if name, url, ok := strings.Cut(line, "|"); ok {
			text = strings.TrimSpace(name)
			href = strings.TrimSpace(url)
			if href == "" {
				href = friendHref(text)
				if href == "" {
					href = friendURL(line)
				}
			}
			if text == "" {
				text = line
			}
		} else {
			text = line
			href = friendHref(line)
		}
		escapedText := html.EscapeString(text)
		if href == "" {
			b.WriteString("<p>")
			b.WriteString(escapedText)
			b.WriteString("</p>\n")
			continue
		}
		b.WriteString(`<p><a href="`)
		b.WriteString(html.EscapeString(href))
		b.WriteString(`" target="_blank" rel="noopener">`)
		b.WriteString(escapedText)
		b.WriteString("</a></p>\n")
	}
	return template.HTML(b.String())
}

func friendHref(line string) string {
	switch {
	case strings.HasPrefix(line, "http://"), strings.HasPrefix(line, "https://"):
		return line
	case strings.HasPrefix(line, "www."):
		return "https://" + line
	case strings.HasPrefix(line, "@"):
		return "https://t.me/" + strings.TrimPrefix(line, "@")
	case strings.Contains(line, "@"):
		return "mailto:" + line
	}
	return ""
}

func friendURL(line string) string {
	switch {
	case strings.HasPrefix(line, "http://"), strings.HasPrefix(line, "https://"):
		return line
	case strings.HasPrefix(line, "www."):
		return "https://" + line
	}
	return ""
}

func staticFS() http.FileSystem {
	sub, err := fs.Sub(assets, "static")
	if err != nil {
		return http.FS(assets)
	}
	return http.FS(sub)
}
