import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { accessSecret, safeNext } from "@/lib/access-gate";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Nothing to log in to when the gate is off.
  if (!accessSecret()) redirect("/");
  return <LoginForm next={safeNext(next)} />;
}
