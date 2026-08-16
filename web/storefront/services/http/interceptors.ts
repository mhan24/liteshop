// 请求/响应拦截器（业务无关的 HTTP 基础件）。
export interface RequestContext {
  url: string
  init: RequestInit
}

export type RequestInterceptor = (ctx: RequestContext) => RequestContext
export type ResponseInterceptor = (data: any) => any

export class InterceptorChain {
  request: RequestInterceptor[] = []
  response: ResponseInterceptor[] = []

  applyRequest(ctx: RequestContext): RequestContext {
    return this.request.reduce((c, fn) => fn(c), ctx)
  }

  applyResponse(data: any): any {
    return this.response.reduce((d, fn) => fn(d), data)
  }
}
