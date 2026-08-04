package models

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"hash"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type Product struct {
	ID          int64
	Name        string
	Description string
	ImageURL    string
	PriceCents  int64
	Status      string
	Category    string
	SortOrder   int
	IsPinned    bool
	FAQ         []FAQItem
	Wholesale   []WholesaleTier // 阶梯价
	MinQty      int
	MaxQty      int
	CostCents   int64
	CreatedAt   int64
	UpdatedAt   int64
}

// WholesaleTier 阶梯价档位。
type WholesaleTier struct {
	MinQty   int `json:"min_qty"`
	Discount int `json:"discount"` // 折扣百分比，如 95 表示 9.5 折
}

// FAQItem 商品常见问题条目。
type FAQItem struct {
	Q string `json:"q"`
	A string `json:"a"`
}

// Coupon 优惠券。
type Coupon struct {
	ID             int64
	Code           string
	Type           string // fixed | percent
	ValueCents     int64
	Percent        int
	MinAmountCents int64
	MaxUses        int
	UsedCount      int
	ProductID      int64
	Active         bool
	ExpiresAt      int64
	CreatedAt      int64
}

// 卡密状态值。
const (
	CardAvailable = "available" // 可用
	CardLocked    = "locked"    // 已被订单锁定（待支付）
	CardSold      = "sold"      // 已售出
	CardDisabled  = "disabled"  // 停用
)

type Card struct {
	ID            int64
	ProductID     int64
	ReservedOrder int64 // 锁定该卡密的订单（待支付）
	SoldOrder     int64 // 售出该卡密的订单
	Content       string
	Status        string
	CreatedAt     int64
	UpdatedAt     int64
	SoldAt        int64
}

type Order struct {
	ID                 int64
	OrderNo            string
	ProductID          int64
	ProductName        string
	Qty                int
	AmountCents        int64
	Fiat               string
	TradeType          string
	BuyerContact       string
	Status             string
	TradeID            string
	PaymentURL         string
	BlockTransactionID string
	CreatedAt          int64
	UpdatedAt          int64
	PaidAt             int64
}

// 订单状态机状态值。
const (
	OrderCreated        = "created"         // 订单记录已创建
	OrderWaitingPayment = "waiting_payment" // 已创建 BEpusdt 交易，等待支付
	OrderPaid           = "paid"            // 支付成功，开始发卡
	OrderProcessing     = "processing"      // 发卡处理中
	OrderDelivered      = "delivered"       // 卡密已发放
	OrderCompleted      = "completed"       // 已完成（终态）
	OrderPaymentFailed  = "payment_failed"  // 支付异常（如创建交易失败）
	OrderDeliveryFailed = "delivery_failed" // 发卡失败，待后台处理
	OrderCancelled      = "cancelled"       // 用户取消
	OrderExpired        = "expired"         // 支付超时过期
)

// validOrderTransitions 定义状态机的合法迁移。
var validOrderTransitions = map[string]map[string]bool{
	OrderCreated: {
		OrderWaitingPayment: true,
		OrderPaymentFailed:  true,
		OrderCancelled:      true,
		OrderExpired:        true,
	},
	OrderWaitingPayment: {
		OrderPaid:      true,
		OrderExpired:   true,
		OrderCancelled: true,
	},
	OrderPaid: {
		OrderProcessing:     true,
		OrderDeliveryFailed: true,
		OrderCompleted:      true,
	},
	OrderProcessing: {
		OrderDelivered:      true,
		OrderDeliveryFailed: true,
		OrderCompleted:      true,
	},
	OrderDelivered: {
		OrderCompleted: true,
	},
}

// IsValidOrderTransition 判断状态迁移是否合法。
func IsValidOrderTransition(from, to string) bool {
	next, ok := validOrderTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// IsOrderFinal 判断是否为终态。
func IsOrderFinal(status string) bool {
	switch status {
	case OrderCompleted, OrderPaymentFailed, OrderDeliveryFailed, OrderCancelled, OrderExpired:
		return true
	}
	return false
}

// OrderEvent 为订单事件日志。
type OrderEvent struct {
	ID        int64
	OrderID   int64
	Event     string
	Message   string
	From      string
	To        string
	AdminID   int64
	Metadata  string
	CreatedAt int64
}

// 管理员角色。
const (
	RoleAdmin    = "admin"    // 全部权限
	RoleOperator = "operator" // 运营操作，不可改系统设置/管理员
	RoleViewer   = "viewer"   // 只读
)

// AuditLog 管理员审计日志。
type AuditLog struct {
	ID         int64
	AdminID    int64
	Username   string
	Action     string
	TargetType string
	TargetID   string
	Before     string
	After      string
	CreatedAt  int64
}

// Now 返回当前 Unix 时间戳。
func Now() int64 { return time.Now().Unix() }

// StartOfDay 返回指定时间所在自然日的 00:00（默认北京时区）。
func StartOfDay(now int64) int64 {
	return StartOfDayIn(now, BeijingLocation)
}

// StartOfDayIn 返回指定时间在指定时区的自然日 00:00。
func StartOfDayIn(now int64, loc *time.Location) int64 {
	if loc == nil {
		loc = BeijingLocation
	}
	t := time.Unix(now, 0).In(loc)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc).Unix()
}

// LocationFromTimezone 从 IANA 时区名解析 Location，失败回退北京。
func LocationFromTimezone(name string) *time.Location {
	if name == "" {
		return BeijingLocation
	}
	if loc, err := time.LoadLocation(name); err == nil {
		return loc
	}
	return BeijingLocation
}

// Slugify 将商品名转为 URL 友好的 slug：小写、保留字母/数字/中文字符，
// 其余字符（空格、符号等）折叠为单个连字符，并去除首尾连字符。
func Slugify(s string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
			prevDash = false
		} else {
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
			}
			prevDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "p"
	}
	return out
}

var BeijingLocation = time.FixedZone("Asia/Shanghai", 8*3600)

func FormatBeijing(ts int64) string {
	if ts <= 0 {
		return "-"
	}
	return time.Unix(ts, 0).In(BeijingLocation).Format("2006-01-02 15:04:05")
}

func NewOrderNo() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return "S" + time.Now().Format("20060102150405") + "-" + base64.RawURLEncoding.EncodeToString(b[:])
}

func RandomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func CentsFromYuan(s string) (int64, error) {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, err
	}
	if f < 0 {
		return 0, fmt.Errorf("price must be positive")
	}
	return int64(f*100 + 0.5), nil
}

func pbkdf2(password, salt []byte, iter, keyLen int, h func() hash.Hash) []byte {
	prf := func(key, msg []byte) []byte {
		hm := hmacLike(key, msg, h)
		return hm
	}
	hLen := h().Size()
	numBlocks := (keyLen + hLen - 1) / hLen
	var dk []byte
	for block := 1; block <= numBlocks; block++ {
		blk := make([]byte, 4)
		blk[0] = byte(block >> 24)
		blk[1] = byte(block >> 16)
		blk[2] = byte(block >> 8)
		blk[3] = byte(block)
		u := prf(password, append(append([]byte{}, salt...), blk...))
		t := append([]byte{}, u...)
		for i := 1; i < iter; i++ {
			u = prf(password, u)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}

func hmacLike(key, msg []byte, h func() hash.Hash) []byte {
	const blockSize = 64
	if len(key) > blockSize {
		hh := h()
		hh.Write(key)
		key = hh.Sum(nil)
	}
	pad := make([]byte, blockSize)
	copy(pad, key)
	inner := make([]byte, blockSize)
	outer := make([]byte, blockSize)
	for i := range pad {
		inner[i] = pad[i] ^ 0x36
		outer[i] = pad[i] ^ 0x5c
	}
	ih := h()
	ih.Write(inner)
	ih.Write(msg)
	innerSum := ih.Sum(nil)
	oh := h()
	oh.Write(outer)
	oh.Write(innerSum)
	return oh.Sum(nil)
}

func HashPassword(password string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	dk := pbkdf2([]byte(password), salt, 100000, 32, sha256.New)
	return "pbkdf2$100000$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(dk)
}

func CheckPassword(password, encoded string) bool {
	parts := split4(encoded)
	if len(parts) != 4 || parts[0] != "pbkdf2" {
		return false
	}
	iters, err := strconv.Atoi(parts[1])
	if err != nil || iters <= 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(want) == 0 {
		return false
	}
	got := pbkdf2([]byte(password), salt, iters, len(want), sha256.New)
	return subtle.ConstantTimeCompare(got, want) == 1
}

func split4(s string) []string {
	parts := make([]string, 0, 4)
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '$' {
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	parts = append(parts, s[start:])
	return parts
}
