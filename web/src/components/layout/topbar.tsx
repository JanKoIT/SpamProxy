"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Bell, LogOut, User } from "lucide-react";

export default function Topbar() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex items-center justify-between h-16 px-6 bg-slate-900 border-b border-slate-700/50">
      <h1 className="text-lg font-semibold text-slate-100">SpamProxy</h1>

      <div className="flex items-center gap-3">
        <button
          className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            aria-label="User menu"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700">
              <User className="h-4 w-4 text-slate-300" />
            </div>
            <span className="hidden sm:inline text-slate-300">
              {session?.user?.name ?? "Admin"}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg bg-slate-800 border border-slate-700 shadow-xl z-50">
              <div className="px-4 py-3 border-b border-slate-700">
                <p className="text-sm text-white">{session?.user?.name}</p>
                <p className="text-xs text-slate-400">{session?.user?.email}</p>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-slate-700 rounded-b-lg transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Abmelden
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
