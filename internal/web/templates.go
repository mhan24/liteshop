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

//go:embed templates static
var assets embed.FS

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
