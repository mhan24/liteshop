// Package clock 提供时间相关的共享工具（模块领域不直接依赖具体时间实现）。
package clock

import "time"

// Now 返回当前 Unix 时间戳。
func Now() int64 { return time.Now().Unix() }

// BeijingLocation 北京时间固定时区（Asia/Shanghai）。
var BeijingLocation = time.FixedZone("Asia/Shanghai", 8*3600)

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

// FormatBeijing 将时间戳格式化为北京时间字符串。
func FormatBeijing(ts int64) string {
	if ts <= 0 {
		return "-"
	}
	return time.Unix(ts, 0).In(BeijingLocation).Format("2006-01-02 15:04:05")
}
