import { redirect } from "next/navigation";

export default async function SitePage({ params }: PageProps<"/app/sites/[siteId]">) {
  const { siteId } = await params;
  redirect(`/app/sites/${siteId}/overview`);
}
