"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) return setError(error.message ?? "Could not sign in");
    router.push("/app");
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-5 text-3xl">Sign in</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="flex flex-col gap-1">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
           
          />
        </label>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn-primary">
          Sign in
        </button>
      </form>
      <p className="mt-4">
        <Link href="/reset-password">Forgot password?</Link>
      </p>
    </main>
  );
}
