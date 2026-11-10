import type { Metadata } from "next";
import { invalidInviteText } from "@/lib/accept-invite";
import { findUsableInvite } from "@/lib/invites";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { robots: { index: false } };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await findUsableInvite(token);
  return (
    <main className="mx-auto max-w-sm p-6">
      {invite ? (
        <>
          <h1 className="text-xl font-semibold">Set up your Concierge account</h1>
          <p className="mb-4 text-sm">for {invite.email}</p>
          <AcceptForm token={token} />
        </>
      ) : (
        <p>{invalidInviteText()}</p>
      )}
    </main>
  );
}
