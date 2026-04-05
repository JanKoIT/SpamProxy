"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  ShieldAlert,
  Mail,
  Terminal,
  Globe,
  Settings,
  Users,
  ChevronLeft,
  ChevronRight,
  Shield,
  ShieldCheck,
  Key,
  List,
  TrendingUp,
  Brain,
  Send,
  Network,
  Type,
  Database,
  Inbox,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/quarantine", label: "Quarantine", icon: ShieldAlert },
  { href: "/logs", label: "Mail Log", icon: Mail },
  { href: "/queue", label: "Mail Queue", icon: Inbox },
  { href: "/postfix-log", label: "Postfix Log", icon: Terminal },
  { href: "/settings/domains", label: "Domains", icon: Globe },
  { href: "/settings/security", label: "Security", icon: Shield },
  { href: "/settings/rspamd-symbols", label: "rspamd Rules", icon: Shield },
  { href: "/settings/blocklists", label: "Blocklists", icon: List },
  { href: "/settings/access-lists", label: "White-/Blacklist", icon: ShieldCheck },
  { href: "/settings/scoring", label: "Scoring", icon: TrendingUp },
  { href: "/settings/keywords", label: "Keywords", icon: Type },
  { href: "/settings/dkim", label: "DKIM", icon: Key },
  { href: "/settings/bayes", label: "Bayes Training", icon: Database },
  { href: "/settings/ai-test", label: "AI Test", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/users", label: "Outgoing Auth", icon: Users },
  { href: "/settings/sender-domains", label: "Sender Domains", icon: Send },
  { href: "/settings/federation", label: "Federation", icon: Network },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex flex-col h-screen bg-slate-900 border-r border-slate-700/50 transition-all duration-300 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Brand */}
      <div className="flex items-center h-16 px-4 border-b border-slate-700/50">
        <ShieldAlert className="h-7 w-7 text-blue-500 shrink-0" />
        {!collapsed && (
          <span className="ml-3 text-lg font-semibold text-slate-100 whitespace-nowrap">
            SpamProxy
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href || pathname.startsWith(href + "/");

          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/20 text-blue-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-slate-700/50 p-2">
        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="flex w-full items-center justify-center rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronLeft className="h-5 w-5" />
          )}
        </button>
      </div>
    </aside>
  );
}
