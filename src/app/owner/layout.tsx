import { notFound } from "next/navigation";
import { SignStack } from "@/components/SignStack";
import { isPlatformOwner } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "../app/sign-out-button";

export default async function OwnerLayout({ children }: LayoutProps<"/owner">) {
  const user = await requireUser();
  if (!isPlatformOwner(user)) notFound();
  return (
    <div className="cx shell">
      <SignStack area="owner" foot={<SignOutButton />} />
      <div className="main">
        <main className="main-inner">{children}</main>
      </div>
    </div>
  );
}
