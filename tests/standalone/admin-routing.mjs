import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { get } from "node:http";
import { text } from "node:stream/consumers";

const base = `http://127.0.0.1:${process.env.PORT}`;
const alias = process.env.ADMIN_PATH;
assert.ok(alias && alias !== "/admin", "test requires a custom ADMIN_PATH");
const buildId = (await readFile(".next/BUILD_ID", "utf8")).trim();

async function request(path, headers) {
  const response = await new Promise((resolve, reject) => {
    get(base + path, { headers }, resolve).once("error", reject);
  });
  return { status: response.statusCode, headers: response.headers, body: await text(response) };
}

for (const headers of [{}, { Host: "shop.example.test", "X-Forwarded-Proto": "https" }]) {
  const login = await request(`${alias}/login`, headers);
  assert.equal(login.status, 200);
  assert.ok(login.body.replaceAll('\\"', '"').includes(`"adminPath":"${alias}"`), "login form must use the runtime alias");
  const orders = await request(`${alias}/orders`, headers);
  assert.equal(orders.status, 307);
  assert.equal(orders.headers.location, `${alias}/login`);
  const rsc = await request(`${alias}/login.rsc`, headers);
  assert.equal(rsc.status, 200);
  assert.match(rsc.headers["content-type"], /text\/x-component/);
  for (const path of ["/admin/login", "/admin/orders", "/admin.rsc", "/admin/orders.rsc", `/_next/data/${buildId}/admin/login.json`]) {
    assert.equal((await request(path, headers)).status, 404, path);
  }
}
