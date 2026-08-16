import { cancelOrder, getOrderDetail, lookupOrders, sendLinks, sendSingleLink } from '../api'

// 订单查询用例：邮箱查单、单号查详情、发送/重发查看链接、取消。
export function useOrderQuery() {
  async function lookup(contact: string, token: string) {
    const data = await lookupOrders(contact, token)
    return data.orders || []
  }

  async function detail(orderNo: string, query?: Record<string, string | undefined>) {
    return getOrderDetail(orderNo, query)
  }

  async function sendAll(contact: string, token: string) {
    return sendLinks(contact, [], token)
  }

  async function sendSelected(contact: string, orderNos: string[], token: string) {
    return sendLinks(contact, orderNos, token)
  }

  async function sendOne(contact: string, orderNo: string, token: string) {
    return sendSingleLink(contact, orderNo, token)
  }

  async function cancel(orderNo: string, query: string) {
    return cancelOrder(orderNo, query)
  }

  return { lookup, detail, sendAll, sendSelected, sendOne, cancel }
}
