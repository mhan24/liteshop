// Package settings 提供站点级配置的聚合读取（消除散落 DB 查询）。
package settings

import (
	"database/sql"
	"strconv"
	"strings"
	"time"

	"shop/internal/db"
	"shop/internal/models"
)

// Settings 聚合常用配置。
type Settings struct {
	LowStockThreshold int
	Timezone          *time.Location
}

// Load 从 DB 读取全部配置。
func Load(database *sql.DB) *Settings {
	if database == nil {
		return &Settings{LowStockThreshold: 10, Timezone: models.BeijingLocation}
	}
	get := func(key string) string {
		v, err := db.GetSetting(database, key)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(v)
	}
	s := &Settings{LowStockThreshold: 10, Timezone: models.BeijingLocation}
	if v := get("low_stock_threshold"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			s.LowStockThreshold = n
		}
	}
	if v := get("site_timezone"); v != "" {
		if loc, err := time.LoadLocation(v); err == nil {
			s.Timezone = loc
		}
	}
	return s
}

// TimezoneName 返回站点时区名（默认 Asia/Shanghai）。
func (s *Settings) TimezoneName() string {
	return s.Timezone.String()
}
