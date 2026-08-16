// Package domain 卡密库存领域模型。
package domain

import "errors"

// Card 卡密。
type Card struct {
	ID            int64
	ProductID     int64
	ReservedOrder int64
	SoldOrder     int64
	Content       string
	Status        string
	CreatedAt     int64
	UpdatedAt     int64
	SoldAt        int64
}

// 卡密状态值。
const (
	CardAvailable = "available"
	CardLocked    = "locked"
	CardSold      = "sold"
	CardDisabled  = "disabled"
)

// ErrCardBusy 卡密不存在或已绑定订单，无法手动修改/删除。
var ErrCardBusy = errors.New("卡密不存在或已绑定订单，无法手动修改")
