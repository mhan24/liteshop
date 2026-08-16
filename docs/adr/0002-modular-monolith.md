# ADR-0002：为什么采用模块化单体

## 决策

后端按业务能力拆分为模块（order/product/inventory/coupon/settings/admin/audit），每个模块内部再分层（domain/application/transport/repository），由 `internal/app` 作为组合根组装，整体部署为单进程。

## 原因

- 依赖方向可强制：domain ← application ← transport，跨模块只走端口，避免“改订单要动五六个目录”
- 共享平台层（config/logging/security/scheduler/outbox）一次实现全模块复用
- 单进程部署与运维简单，不需要微服务的分布式复杂度
- 未来若某模块需要独立扩展，因边界清晰可以平滑拆分

## 权衡

- 模块间纪律靠约定与代码评审维持；组合根集中组装是唯一允许触碰具体实现的地方

## 状态

已接受。
