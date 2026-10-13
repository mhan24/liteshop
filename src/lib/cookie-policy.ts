/** 生产 Secure 由服务端运行模式决定，请求头不能降级。 */
export function secureCookie(isProduction: boolean, forwardedProto?: string | null): boolean {
  return isProduction || forwardedProto === "https";
}
