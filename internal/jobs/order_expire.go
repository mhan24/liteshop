package jobs

import (
	"log"

	"shop/internal/service"
)

// OrderExpireJob 定时关闭超时未支付订单（created/waiting_payment），释放卡密并回滚优惠券。
// 由后台任务执行，不依赖用户访问触发。
func OrderExpireJob(orders *service.OrderService, timeoutSec func() int) func() {
	return func() {
		timeout := 1200
		if t := timeoutSec(); t > 0 {
			timeout = t
		}
		if n, err := orders.ExpireStale(timeout); err != nil {
			log.Printf("job order_expire: %v", err)
		} else if n > 0 {
			log.Printf("job order_expire: expired %d stale orders", n)
		}
	}
}
