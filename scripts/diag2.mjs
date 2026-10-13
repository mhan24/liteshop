/* eslint-disable */
/* 直接加载目标页 → 查 React fiber → 提交 → 观察导航/错误 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const CHROME =
  process.env.CHROME_BIN ??
  path.join(
    process.env.HOME ?? "",
    "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  );

const targetUrl = process.argv[2] ?? "http://localhost:3100/products/pmv3u9uzzqw9m";
const email = process.argv[3] ?? "diag@liteshop.dev";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-diag2-"));
const headless = process.env.HEADLESS === "1";
const proc = spawn(CHROME, [
  ...(headless ? ["--headless=new"] : []),
  `--user-data-dir=${userDataDir}`,
  "--remote-debugging-port=0",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--host-resolver-rules=MAP challenges.cloudflare.com 127.0.0.1",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "about:blank",
]);

const wsUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("chrome start timeout")), 15000);
  proc.stderr.on("data", (d) => {
    const m = String(d).match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(timer); resolve(m[0]); }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleLogs = [];

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args?.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400);
    if (text) consoleLogs.push(`[${msg.params.type}] ${text}`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleLogs.push(`[EXC] ${String(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text).slice(0, 400)}`);
  }
  if (msg.method === "Log.entryAdded") {
    consoleLogs.push(`[LOG:${msg.params.entry.level}] ${String(msg.params.entry.text).slice(0, 300)}`);
  }
};

await new Promise((r) => setTimeout(r, 200));
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Log.enable", {}, sessionId);

await send("Page.navigate", { url: targetUrl }, sessionId);
await new Promise((r) => setTimeout(r, 6000));

const state = await send("Runtime.evaluate", {
  expression: `(() => {
    const form = document.querySelector('form');
    const fiberKey = form ? Object.keys(form).find(k => k.startsWith('__reactFiber')) : null;
    const propsKey = form ? Object.keys(form).find(k => k.startsWith('__reactProps')) : null;
    // 找任意元素的 react fiber，判断整树水合状态
    const anyEl = document.querySelector('h1');
    const anyFiber = anyEl ? Object.keys(anyEl).find(k => k.startsWith('__reactFiber')) : null;
    window.__sub = null;
    document.addEventListener('submit', (e) => { window.__sub = { prevented: e.defaultPrevented }; }, true);
    return JSON.stringify({
      url: location.href,
      hasForm: !!form,
      formFiber: !!fiberKey,
      formProps: !!propsKey,
      anyFiber: !!anyFiber,
      actionProp: form ? String(form.getAttribute('action')).slice(0, 40) : null,
      nextF: (window.__next_f ?? []).length,
      soldOut: !!document.querySelector('.text-pastel-red-text'),
      buyBtnDisabled: [...document.querySelectorAll('button')].find(b => b.textContent.includes('立即购买'))?.disabled ?? null,
    });
  })()`,
}, sessionId).then((r) => JSON.parse(r.result.value));
console.log("STATE:", JSON.stringify(state));

if (process.argv[4] === "manual-render") {
  const mr = await send("Runtime.evaluate", {
    expression: `(() => {
      try {
        const div = document.createElement('div');
        div.id = 'manual-ts';
        document.body.appendChild(div);
        const events = [];
        const id = window.turnstile.render(div, {
          sitekey: document.body.dataset.sitekey || '0x4AAAAAAFT6NQGpxAsRYzZr',
          callback: (t) => events.push('token:' + String(t).slice(0,8)),
          'error-callback': (c) => { events.push('error:' + c); return true; },
          'expired-callback': () => events.push('expired'),
        });
        window.__tsEvents = events;
        return 'render id=' + id;
      } catch (e) { return 'RENDER THREW: ' + e.message; }
    })()`,
  }, sessionId).then(r => r.result.value);
  console.log("MANUAL:", mr);
  await new Promise((r) => setTimeout(r, 8000));
  const res = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      events: window.__tsEvents,
      iframes: document.querySelectorAll('#manual-ts iframe').length,
      text: (document.getElementById('manual-ts')?.textContent ?? '').slice(0, 80),
    })`,
  }, sessionId).then(r => r.result.value);
  console.log("MANUAL+8s:", res);
  proc.kill();
  process.exit(0);
}
if (process.argv[4] === "observe-buy") {
  // 等降级生效（15s 预算）→ 填邮箱选交易所 → 提交 → 应跳转待支付页
  await new Promise((r) => setTimeout(r, 17000));
  const fill = await send("Runtime.evaluate", {
    expression: `(() => {
      const email = document.getElementById('buy-email');
      if (!email) return 'no email';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(email, 'fallback-buy@liteshop.dev');
      email.dispatchEvent(new Event('input', { bubbles: true }));
      const ex = [...document.querySelectorAll('input[type=radio][name=paymentMethod]')].find(r => r.value === 'exchange');
      if (ex) { ex.checked = true; ex.dispatchEvent(new Event('change', { bubbles: true })); }
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('购买') || b.textContent.includes('验证'));
      if (!b) return 'no button';
      if (b.disabled) return 'STILL DISABLED: ' + b.textContent;
      b.click();
      return 'clicked: ' + b.textContent.trim();
    })()`,
  }, sessionId).then(r => r.result.value);
  console.log("BUY:", fill);
  await new Promise((r) => setTimeout(r, 6000));
  const after = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      url: location.href,
      onPending: location.pathname === '/pay/pending',
      bodyHas订单状态: document.body.textContent.includes('订单状态'),
    })`,
  }, sessionId).then(r => r.result.value);
  console.log("AFTER:", after);
  proc.kill();
  process.exit(0);
}
if (process.argv[4] === "observe-lookup") {
  // 查单页：Turnstile 会失败（test-secret 会让 siteverify 拒绝 / 脚本可能加载），
  // 等超时降级后，提交按钮应可点击（fallback on）
  await new Promise((r) => setTimeout(r, 12000));
  const ts = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      errHint: document.body.textContent.includes('重试'),
      lookupBtnDisabled: [...document.querySelectorAll('button')].find(b => b.textContent.includes('查询'))?.disabled,
      hasFallbackField: !!document.querySelector('input[name=cfFallback]'),
      cfScript: (() => { const r = performance.getEntriesByType('resource').find(r => r.name.includes('challenges.cloudflare.com')); return r ? { dur: Math.round(r.duration), size: r.transferSize } : null; })(),
      turnstileDefined: typeof window.turnstile !== 'undefined',
      cfIframes: document.querySelectorAll('iframe').length,
      loadingText: document.body.textContent.includes('人机验证加载中'),
      snippet: (document.querySelector('form')?.textContent ?? '').slice(0, 200),
      widgetDom: (() => {
        // TurnstileWidget 容器 = 「人机验证加载中…」文本前一个兄弟 div
        const holder = [...document.querySelectorAll('div')].find(d => d.className === 'min-h-[65px]');
        return holder ? { children: holder.children.length, html: holder.innerHTML.slice(0, 120) } : 'holder-not-found';
      })(),
    })`,
  }, sessionId).then((r) => JSON.parse(r.result.value));
  console.log("LOOKUP+FALLBACK:", JSON.stringify(ts));
  proc.kill();
  process.exit(0);
}
if (process.argv[4] === "observe-turnstile") {
  const ts = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      iframeCount: document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').length,
      widgetDiv: !!document.querySelector('[class*="cf-turnstile"], div[style*="turnstile"]'),
      loadingHint: document.body.textContent.includes('人机验证加载中'),
      errHint: document.body.textContent.includes('无法连接人机验证') || document.body.textContent.includes('加载超时'),
    })`,
  }, sessionId).then((r) => JSON.parse(r.result.value));
  console.log("TURNSTILE:", JSON.stringify(ts));
  await new Promise((r) => setTimeout(r, 25000));
  const ts2 = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      iframeCount: document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').length,
      solved: !!document.querySelector('input[name="cf-turnstile-response"]') ? !!document.querySelector('input[name="cf-turnstile-response"]').value : 'no-input',
      errHint: document.body.textContent.includes('无法连接人机验证') || document.body.textContent.includes('加载超时'),
      cfScriptEntry: (() => {
        const r = performance.getEntriesByType('resource').find(r => r.name.includes('challenges.cloudflare.com'));
        return r ? { name: r.name.slice(0, 70), size: r.transferSize, dur: Math.round(r.duration), start: Math.round(r.startTime) } : null;
      })(),
    })`,
  }, sessionId).then((r) => JSON.parse(r.result.value));
  console.log("TURNSTILE+8s:", JSON.stringify(ts2));
  console.log("CONSOLE:", JSON.stringify(consoleLogs.slice(0, 6)));
  proc.kill();
  process.exit(0);
}
if (state.hasForm && !state.soldOut) {
  await send("Runtime.evaluate", {
    expression: `(() => {
      const email = document.getElementById('buy-email');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(email, ${JSON.stringify(email)});
      email.dispatchEvent(new Event('input', { bubbles: true }));
      const ex = [...document.querySelectorAll('input[type=radio][name=paymentMethod]')].find(r => r.value === 'exchange');
      if (ex) { ex.checked = true; ex.dispatchEvent(new Event('change', { bubbles: true })); }
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('立即购买'));
      b.click();
      return 'ok';
    })()`,
    awaitPromise: true,
  }, sessionId);
  await new Promise((r) => setTimeout(r, 5000));
  const after = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      url: location.href,
      navType: performance.getEntriesByType('navigation').slice(-1)[0]?.type,
      submitEvt: window.__sub,
      errorText: document.querySelector('.text-pastel-red-text')?.textContent ?? null,
      pendingVisible: !!document.querySelector('h1') && document.body.textContent.includes('订单状态'),
    })`,
  }, sessionId).then((r) => JSON.parse(r.result.value));
  console.log("AFTER:", JSON.stringify(after));
} else {
  console.log("SKIP submit (no form or sold out)");
}
console.log("CONSOLE:", JSON.stringify(consoleLogs.slice(0, 10)));
proc.kill();
process.exit(0);
