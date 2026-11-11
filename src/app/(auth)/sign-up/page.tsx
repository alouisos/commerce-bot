import Link from "next/link";
import { connection } from "next/server";
import { contactEmail, SIGNUP_EMAIL, signupMailto } from "@/lib/brand";

export default async function SignUpPage() {
  // Rendered per request: the contact address comes from the server's settings, which a build doesn't have.
  await connection();
  const contact = contactEmail();
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-5 text-3xl">Create your account</h1>
      <p>Concierge is invite-only for now.{contact ? ` Contact ${contact}.` : ""}</p>
      <a href={signupMailto} className="btn btn-primary mt-5 w-full whitespace-normal text-center">
        Email {SIGNUP_EMAIL}
      </a>
      <p className="mt-4">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
