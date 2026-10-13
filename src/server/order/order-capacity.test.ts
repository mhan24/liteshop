import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "@/db";
import { orders, products } from "@/db/schema";
import { MAX_ACTIVE_PENDING_ORDERS, MAX_RECONCILING_ORDERS, checkOrderRateLimit } from "@/server/security/rate-limit";
import { seedManual } from "./test-helpers";
import { createOrder } from "./create-order";

const seeded:string[]=[];
afterEach(()=>{
  if(seeded.length) db.delete(orders).where(inArray(orders.orderNo,seeded)).run();
  seeded.length=0;
});
it("两个请求均通过前置限流，最后一个名额只能被一单占用",async()=>{
  const existing=db.select({n:sql<number>`count(*)`}).from(orders)
    .where(inArray(orders.status,["pending","reconciling"])).get()!.n;
  for(let i=existing;i<MAX_ACTIVE_PENDING_ORDERS-1;i++){
    const no=randomUUID();seeded.push(no);
    db.insert(orders).values({orderNo:no,productName:"capacity",unitPriceCents:100,totalCents:100,
      quantity:1,currency:"USD",email:"seed@example.test",status:"pending"}).run();
  }
  const p=seedManual(2);
  const emailA=`${randomUUID()}@example.test`,emailB=`${randomUUID()}@example.test`;
  expect(checkOrderRateLimit(randomUUID(),emailA).ok).toBe(true);
  expect(checkOrderRateLimit(randomUUID(),emailB).ok).toBe(true);
  const results=await Promise.allSettled([
    createOrder({slug:p.slug,email:emailA,quantity:1}),
    createOrder({slug:p.slug,email:emailB,quantity:1}),
  ]);
  // 无论断言是否通过，都清理本例真实创建的订单，避免污染其它测试。
  const created=db.select({no:orders.orderNo}).from(orders).where(eq(orders.productId,p.id)).all();
  seeded.push(...created.map(o=>o.no));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  const active=db.select({n:sql<number>`count(*)`}).from(orders)
    .where(inArray(orders.status,["pending","reconciling"])).get()!.n;
  expect(active).toBe(MAX_ACTIVE_PENDING_ORDERS);
  expect(db.select().from(products).where(eq(products.id,p.id)).get()!.stockLimit).toBe(1);
});


it("独立连接在建单事务前占掉最后一个名额，不能继续扣库存",async()=>{
  const existing=db.select({n:sql<number>`count(*)`}).from(orders)
    .where(inArray(orders.status,["pending","reconciling"])).get()!.n;
  for(let i=existing;i<MAX_ACTIVE_PENDING_ORDERS-1;i++){
    const no=randomUUID();seeded.push(no);
    db.insert(orders).values({orderNo:no,productName:"capacity",unitPriceCents:100,totalCents:100,
      currency:"USD",email:"seed@example.test",status:"pending"}).run();
  }
  const p=seedManual(1);
  const second=new Database(db.$client.name);
  const original=db.transaction.bind(db);
  const spy=vi.spyOn(db,"transaction").mockImplementationOnce((...args)=>{
    const no=randomUUID();seeded.push(no);
    second.prepare("INSERT INTO orders(order_no,product_name,unit_price_cents,total_cents,email,status) VALUES(?,'capacity',100,100,'seed@example.test','pending')").run(no);
    return original(...args);
  });
  try{
    await expect(createOrder({slug:p.slug,email:"blocked@example.test",quantity:1})).rejects.toThrow(/人数较多/);
    expect(db.select().from(orders).where(eq(orders.productId,p.id)).all()).toHaveLength(0);
    expect(db.select().from(products).where(eq(products.id,p.id)).get()!.stockLimit).toBe(1);
  }finally{spy.mockRestore();second.close();}
});

it("待对账达到熔断阈值，直接调用建单服务同样不得占库",async()=>{
  for(let i=0;i<MAX_RECONCILING_ORDERS;i++){
    const no=randomUUID();seeded.push(no);
    db.insert(orders).values({orderNo:no,productName:"capacity",unitPriceCents:100,totalCents:100,
      currency:"USD",email:"seed@example.test",status:"reconciling"}).run();
  }
  const p=seedManual(1);
  await expect(createOrder({slug:p.slug,email:"reconciling@example.test",quantity:1})).rejects.toThrow(/待核对/);
  expect(db.select().from(orders).where(eq(orders.productId,p.id)).all()).toHaveLength(0);
  expect(db.select().from(products).where(eq(products.id,p.id)).get()!.stockLimit).toBe(1);
});
