"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      email,
      password: String(form.get("password")),
      name: email.split("@")[0],
    });
    setPending(false);
    if (error) return setError(error.message ?? "Could not sign up");
    router.push("/app");
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          Email
          <input name="email" type="email" autoComplete="email" required className="border p-2" />
        </label>
        <label className="flex flex-col gap-1">
          Password (at least 10 characters)
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            className="border p-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="border p-2">
          Sign up
        </button>
      </form>
      <p className="mt-4">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
