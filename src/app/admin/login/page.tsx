import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentSession } from "@/server/auth";
import { getAdminBase } from "@/lib/admin-path";
import { takeFlash } from "@/lib/flash-store";
import { LoginForm } from "@/components/admin/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "管理员登录" };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; flash?: string }>;
}) {
  const jar = await cookies();
  if (await currentSession(jar.get("liteshop_admin")?.value)) {
    redirect(await getAdminBase());
  }
  const { next, flash: flashId } = await searchParams;
  const msg = takeFlash(flashId)?.ok;

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm border-border bg-card">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-3xl tracking-tight">liteshop</CardTitle>
          <p className="text-sm text-muted-foreground">管理后台登录</p>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} initialMsg={msg} />
        </CardContent>
      </Card>
    </main>
  );
}
