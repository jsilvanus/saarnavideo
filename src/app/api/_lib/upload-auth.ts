import { accessSecret } from "@/lib/access-gate";

export function uploadAuthRequired(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "production" && !accessSecret(env);
}
