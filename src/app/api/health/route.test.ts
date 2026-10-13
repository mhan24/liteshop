import { expect, it, vi } from "vitest";
vi.mock("@/db",()=>({db:{get:vi.fn()}}));
import { db } from "@/db";
import { GET } from "./route";

it("数据库故障仅返回通用健康状态，详细异常保留在服务端",async()=>{
  const error=new Error("SQLITE_CANTOPEN /private/database/path");
  vi.mocked(db.get).mockImplementationOnce(()=>{throw error;});
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  try{
    const response=await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ok:false});
    expect(log).toHaveBeenCalledWith("[health] 数据库探测失败",error);
  }finally{log.mockRestore();}
});
it("健康探测成功仍返回 ok=true",async()=>{
  const response=await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ok:true});
});
