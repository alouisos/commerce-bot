import Link from "next/link";
import { contactEmail } from "@/lib/brand";

export default function SignUpPage() {
  const contact = contactEmail();
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-xl font-semibold">Create your account</h1>
      <p>Concierge is invite-only for now.{contact ? ` Contact ${contact}.` : ""}</p>
      <p className="mt-4">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
