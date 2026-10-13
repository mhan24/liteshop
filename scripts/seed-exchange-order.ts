import { db } from "../src/db/index";
import { paymentConfigs } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret } from "../src/server/exchange/credentials";

async function main() {
  const configJson = {
    accountId: "123456789",
    asset: "USDT",
    rate: "7.25",
    apiKey: "test-api-key",
    apiSecretEnc: encryptSecret("test-api-secret"),
  };
  db.insert(paymentConfigs)
    .values({ provider: "exchange:binance", enabled: true, configJson, updatedAt: new Date() })
    .onConflictDoUpdate({ target: paymentConfigs.provider, set: { enabled: true, configJson, updatedAt: new Date() } })
    .run();
  console.log("binance channel ready");
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
