"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import SettingsModal, { useDataSource } from "./SettingsModal";

export default function Header() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const source = useDataSource();
  const pathname = usePathname();
  const isCustom = source.mode === "custom";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface/70 px-5 backdrop-blur-sm">
      <Link href="/" className="group flex items-center gap-3">
        <Mark />
        <span className="font-sans text-[17px] font-bold tracking-[-0.03em] text-ink">
          HEURISTIC
        </span>
        <span className="microlabel hidden sm:inline">chain forensics</span>
      </Link>

      <nav className="flex items-center gap-1 font-mono text-[13px]">
        <NavLink href="/check" active={pathname.startsWith("/check")}>
          Check a coin
        </NavLink>
        <NavLink href="/explore" active={pathname.startsWith("/explore")}>
          Explore
        </NavLink>
        <NavLink href="/mempool" active={pathname.startsWith("/mempool")}>
          Mempool
        </NavLink>
        <NavLink
          href="/methodology"
          active={pathname.startsWith("/methodology")}
        >
          <span className="hidden sm:inline">Methodology</span>
          <span className="sm:hidden">Docs</span>
        </NavLink>

        <span className="mx-1.5 h-5 w-px bg-line" />

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 rounded-[2px] border border-line px-2.5 py-1.5 text-dim transition-colors hover:border-line-strong hover:text-ink"
          title={`Data source: ${isCustom ? "your instance" : "mempool.space"}`}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: isCustom ? "var(--clean)" : "var(--warn)",
              boxShadow: `0 0 6px ${isCustom ? "var(--clean)" : "var(--warn)"}`,
            }}
          />
          <span className="hidden text-[12px] sm:inline">
            {isCustom ? "private node" : "public"}
          </span>
          <span aria-hidden>⚙</span>
        </button>
      </nav>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-[2px] px-3 py-1.5 transition-colors ${
        active
          ? "bg-surface-2 text-accent"
          : "text-dim hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function Mark() {
  // Three converging nodes — the clustering motif, in brand amber.
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden>
      <circle cx="4" cy="5" r="2" fill="var(--accent)" />
      <circle cx="4" cy="13" r="2" fill="var(--text-dim)" />
      <circle
        cx="14"
        cy="9"
        r="2.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <path
        d="M4 5 L14 9 M4 13 L14 9"
        stroke="var(--line-strong)"
        strokeWidth="1"
        fill="none"
      />
    </svg>
  );
}
