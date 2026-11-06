import Link from "next/link";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  await requireUser();
  return (
    <div className="min-h-screen">
      <nav aria-label="Main" className="flex items-center gap-6 border-b px-6 py-3">
        <Link href="/app">Websites</Link>
        <Link href="/app/usage">Usage</Link>
        <span className="ml-auto">
          <SignOutButton />
        </span>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  );
}
