import type { Metadata } from "next";
import { LoginClient } from "@/components/account/LoginClient";
import { safeNext } from "@/lib/auth/crypto";

export const metadata: Metadata = { title: "Вход — Nexus AI" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined));
  return <LoginClient error={one("error")} provider={one("provider")} next={safeNext(one("next"), "/")} />;
}
