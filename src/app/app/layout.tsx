import { QuotaBanner } from "@/components/QuotaBanner";
import { SignStack } from "@/components/SignStack";
import { getAccountForUser } from "@/lib/accounts";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await requireUser();
  const account = await getAccountForUser(user.id);
  return (
    <div className="cx shell">
      <SignStack area="app" foot={<SignOutButton />} />
      <div className="main">
        <QuotaBanner account={account} />
        <main className="main-inner">{children}</main>
      </div>
    </div>
  );
}
