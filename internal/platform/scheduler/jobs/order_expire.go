package jobs

import (
	"context"

	"shop/internal/platform/logging"
)

// OrderExpireService 订单过期用例（由订单应用层实现）。
type OrderExpireService interface {
	ExpireStale(timeoutSec int) (int, error)
}

// OrderExpireJob 触发器：到点调用订单应用层的过期用例，不定义过期规则、不写 SQL。
type OrderExpireJob struct {
	Service    OrderExpireService
	TimeoutSec func() int
}

func (j *OrderExpireJob) Run(ctx context.Context) error {
	timeout := 0
	if j.TimeoutSec != nil {
		timeout = j.TimeoutSec()
	}
	n, err := j.Service.ExpireStale(timeout)
	if err != nil {
		logging.App().Sugar().Errorf("job order_expire: %v", err)
		return err
	}
	if n > 0 {
		logging.App().Sugar().Infof("job order_expire: expired %d stale orders", n)
	}
	return nil
}
