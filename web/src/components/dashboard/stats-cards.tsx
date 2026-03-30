"use client";

import { Mail, ShieldAlert, AlertTriangle, TrendingUp } from "lucide-react";

interface StatsCardsProps {
  totalToday: number;
  spamBlocked: number;
  quarantinePending: number;
  spamRate: number;
}

const cards = [
  {
    key: "totalToday" as const,
    label: "Total Mails Today",
    icon: Mail,
    color: "text-blue-400",
  },
  {
    key: "spamBlocked" as const,
    label: "Spam Blocked",
    icon: ShieldAlert,
    color: "text-red-400",
  },
  {
    key: "quarantinePending" as const,
    label: "Quarantine Pending",
    icon: AlertTriangle,
    color: "text-yellow-400",
  },
  {
    key: "spamRate" as const,
    label: "Spam Rate",
    icon: TrendingUp,
    color: "text-purple-400",
    suffix: "%",
  },
];

export function StatsCards(props: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ key, label, icon: Icon, color, suffix }) => (
        <div
          key={key}
          className="rounded-lg bg-slate-800 p-5 flex items-center gap-4"
        >
          <div className={`${color} shrink-0`}>
            <Icon className="h-8 w-8" />
          </div>
          <div>
            <p className="text-sm text-slate-400">{label}</p>
            <p className="text-2xl font-semibold text-white">
              {props[key]}
              {suffix ?? ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
