import { AuthShell } from "@/components/AuthShell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
