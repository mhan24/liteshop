// Package version 提供构建版本信息（可由 -ldflags 覆盖）。
package version

var (
	// Version 语义化版本号（如 0.3.0）。
	Version = "0.3.0"
	// Commit Git 提交哈希（构建时注入）。
	Commit = ""
	// Date 构建时间（构建时注入）。
	Date = ""
)

// String 返回完整版本标识，如 v0.2.0 (abc1234, 2026-08-09)。
func String() string {
	s := "v" + Version
	if Commit != "" {
		s += " (" + Commit
		if Date != "" {
			s += ", " + Date
		}
		s += ")"
	}
	return s
}
