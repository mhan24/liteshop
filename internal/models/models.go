// Package models 兼容层：共享工具函数（领域类型已迁移到各模块 domain 包）。
package models

import (
	"shop/internal/platform/security"
	"shop/internal/shared/clock"
	"shop/internal/shared/idgen"
)

var (
	Now                      = clock.Now
	StartOfDay               = clock.StartOfDay
	StartOfDayIn             = clock.StartOfDayIn
	LocationFromTimezone     = clock.LocationFromTimezone
	BeijingLocation          = clock.BeijingLocation
	FormatBeijing            = clock.FormatBeijing
	NewOrderNo               = idgen.NewOrderNo
	RandomToken              = idgen.RandomToken
	HashPassword             = security.HashPassword
	CheckPassword            = security.CheckPassword
	ValidatePasswordStrength = security.ValidatePasswordStrength
)
