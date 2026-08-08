// Package repository 提供全部数据访问（仓库层）。
//
// 业务代码不直接执行 SQL：订单/商品/卡密/优惠券通过结构化 Repository
// （OrderRepository / ProductRepository / KeyRepository），
// 配置/密钥/管理员/会话/邮件队列/日志通过本包函数访问。
// 换数据库只需替换 internal/db 的驱动与迁移方言，本层保持不变。
package repository
