import { createBinanceClient } from "./binance";
import { createOkxClient } from "./okx";
import type { ExchangeClient, ExchangeId } from "./types";

export * from "./types";
export { createBinanceClient } from "./binance";
export { createOkxClient } from "./okx";

/** 交易所客户端工厂 */
export function getExchangeClient(id: ExchangeId): ExchangeClient {
  switch (id) {
    case "binance":
      return createBinanceClient();
    case "okx":
      return createOkxClient();
  }
}
