# ADR-0001：为什么继续使用 SQLite

## 决策

持久化继续使用 SQLite（modernc.org/sqlite 纯 Go 驱动），不引入独立数据库服务。

## 原因

- 单文件、零运维：备份（VACUUM INTO）、迁移、部署都简单
- 纯 Go 驱动，交叉编译无 CGO 依赖，arm64 服务器部署无压力
- 业务负载为中小型发卡站：写事务通过 `_txlock=immediate` + 单连接串行化，满足“并发不超卖”的强一致要求
- 支付/订单链路对写吞吐要求有限，SQLite 足够

## 权衡

- 写并发受限（串行化）；若未来出现高并发写瓶颈，再迁移到 PostgreSQL
- 仓储层全部面向接口（`application/ports.go`），替换数据库不需要改业务逻辑

## 状态

已接受。
