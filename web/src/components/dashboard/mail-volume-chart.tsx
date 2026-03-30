"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface HourlyStat {
  hour: string;
  total: number;
  spam: number;
  ham: number;
}

interface MailVolumeChartProps {
  hourlyStats: HourlyStat[];
}

export function MailVolumeChart({ hourlyStats }: MailVolumeChartProps) {
  return (
    <div className="rounded-lg bg-slate-800 p-5">
      <h2 className="mb-4 text-lg font-semibold text-white">
        Mail Volume (Last 24h)
      </h2>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={hourlyStats}>
          <defs>
            <linearGradient id="colorHam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorSpam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="hour"
            stroke="#94a3b8"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
          />
          <YAxis
            stroke="#94a3b8"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "0.5rem",
              color: "#f8fafc",
            }}
            labelStyle={{ color: "#94a3b8" }}
          />
          <Legend wrapperStyle={{ color: "#f8fafc" }} />

          <Area
            type="monotone"
            dataKey="ham"
            name="Ham"
            stroke="#22c55e"
            fill="url(#colorHam)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="spam"
            name="Spam"
            stroke="#ef4444"
            fill="url(#colorSpam)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
