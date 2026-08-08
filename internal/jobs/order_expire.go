package jobs

import (

	"shop/internal/service"

	"shop/internal/logging"
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
			logging.App().Sugar().Errorf("job order_expire: %v", err)
		} else if n > 0 {
			logging.App().Sugar().Infof("job order_expire: expired %d stale orders", n)
		}
	}
}
