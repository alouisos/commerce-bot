import Link from "next/link";
import { RequestAccessForm } from "./request-form";

export default function SignUpPage() {
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-3 text-3xl">Request an invite</h1>
      <p className="mb-5 text-ink-muted">Concierge is invite-only. Leave your email and we&apos;ll send you an invite.</p>
      <RequestAccessForm />
      <p className="mt-5 text-sm text-ink-muted">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
