package logging

import "context"

type requestIDKey struct{}

// WithRequestID 返回携带 request_id 的 context。
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestID 从 context 读取 request_id（无则返回空串）。
func RequestID(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey{}).(string); ok {
		return v
	}
	return ""
}
