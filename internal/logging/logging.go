// Package logging 提供 zap 日志（app / payment / security 三通道 + 轮转）。
package logging

import (
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

var (
	appLog      *zap.Logger
	paymentLog  *zap.Logger
	securityLog *zap.Logger
)

// Init 初始化日志目录与三个日志文件（app.log / payment.log / security.log）。
func Init(logDir string) error {
	if logDir == "" {
		logDir = "logs"
	}
	if err := os.MkdirAll(logDir, 0o700); err != nil {
		return err
	}
	appLog = newLogger(filepath.Join(logDir, "app.log"))
	paymentLog = newLogger(filepath.Join(logDir, "payment.log"))
	securityLog = newLogger(filepath.Join(logDir, "security.log"))
	return nil
}

func newLogger(path string) *zap.Logger {
	encoder := zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig())
	writer := zapcore.AddSync(&lumberjack.Logger{
		Filename:   path,
		MaxSize:    50, // MB
		MaxBackups: 7,
		MaxAge:     30, // 天
		Compress:   true,
	})
	core := zapcore.NewCore(encoder, zapcore.NewMultiWriteSyncer(writer, os.Stdout), zapcore.InfoLevel)
	return zap.New(core)
}

// App 应用日志（未 Init 时为空实现）。
func App() *zap.Logger {
	if appLog == nil {
		return zap.NewNop()
	}
	return appLog
}

// Payment 支付日志（订单号 / 金额 / 交易 ID / 回调时间 / 结果）。
func Payment() *zap.Logger {
	if paymentLog == nil {
		return zap.NewNop()
	}
	return paymentLog
}

// Security 安全日志（登录 / 锁定 / TOTP / 权限变更）。
func Security() *zap.Logger {
	if securityLog == nil {
		return zap.NewNop()
	}
	return securityLog
}
