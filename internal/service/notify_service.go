package service

import (
	"shop/internal/config"
	"shop/internal/notify"
)

// NotifyService 通知测试/配置的统一入口（handler 不再直连 notifier）。
type NotifyService struct {
	notifier *notify.Notifier
}

func NewNotifyService(n *notify.Notifier) *NotifyService {
	return &NotifyService{notifier: n}
}

func (s *NotifyService) SendTestEvent(event, channel string) error {
	return s.notifier.SendTestEvent(event, channel)
}

func (s *NotifyService) SendTestEmail(to string) error {
	return s.notifier.SendTestEmail(to)
}

func (s *NotifyService) SendTestTelegram() error {
	return s.notifier.SendTestTelegram()
}

func (s *NotifyService) CurrentConfig() config.Config {
	return s.notifier.CurrentConfig()
}

func (s *NotifyService) EventTemplates() map[string]map[string]string {
	return s.notifier.EventTemplates()
}

// SystemError 发送系统异常通知（异步，不阻塞请求）。
func (s *NotifyService) SystemError(msg string) {
	s.notifier.NotifySystemError(msg)
}
