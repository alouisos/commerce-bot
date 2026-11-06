import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/brand";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-8">
      <h1 className="text-3xl font-semibold">{PRODUCT_NAME}</h1>
      <p>A chatbot for your website.</p>
      <nav className="flex gap-4">
        <Link href="/sign-in" className="underline">Sign in</Link>
        <Link href="/sign-up" className="underline">Sign up</Link>
      </nav>
    </main>
  );
}
