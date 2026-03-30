export const dynamic = "force-dynamic";

import { fetchStats } from "@/lib/api";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { MailVolumeChart } from "@/components/dashboard/mail-volume-chart";

export default async function DashboardPage() {
  const stats = await fetchStats();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">SpamProxy Dashboard</h1>

      <StatsCards
        totalToday={stats.total_today}
        spamBlocked={stats.spam_today}
        quarantinePending={stats.quarantine_pending}
        spamRate={stats.spam_rate}
      />

      <MailVolumeChart hourlyStats={stats.hourly_stats} />
    </div>
  );
}
