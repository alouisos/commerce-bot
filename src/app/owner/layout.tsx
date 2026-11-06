import { notFound } from "next/navigation";
import { isPlatformOwner } from "@/lib/access";
import { requireUser } from "@/lib/session";

export default async function OwnerLayout({ children }: LayoutProps<"/owner">) {
  const user = await requireUser();
  if (!isPlatformOwner(user.email)) notFound();
  return <main className="p-6">{children}</main>;
}
