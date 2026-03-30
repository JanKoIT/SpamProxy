import Sidebar from "@/components/layout/sidebar";
import Topbar from "@/components/layout/topbar";
import AuthSessionProvider from "@/components/layout/session-provider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthSessionProvider>
      <div className="flex h-screen bg-slate-950 text-slate-100">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </AuthSessionProvider>
  );
}
