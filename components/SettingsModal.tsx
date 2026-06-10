"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_SOURCE,
  loadSource,
  saveSource,
  type DataSource,
} from "@/lib/datasource";
import { MicroLabel } from "./ui";

export function useDataSource(): DataSource {
  const [src, setSrc] = useState<DataSource>(DEFAULT_SOURCE);
  useEffect(() => {
    setSrc(loadSource());
    const onChange = (e: Event) =>
      setSrc((e as CustomEvent<DataSource>).detail);
    window.addEventListener("heuristic:source", onChange);
    return () => window.removeEventListener("heuristic:source", onChange);
  }, []);
  return src;
}

export default function SettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DataSource>(DEFAULT_SOURCE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) setDraft(loadSource());
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const isCustom = draft.mode === "custom";

  // Portalled to <body> so an ancestor's backdrop-filter (the header) can't
  // become the containing block and mis-position this fixed overlay.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[3px] border border-line-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Data source settings"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <MicroLabel>Settings</MicroLabel>
            <h2 className="font-sans text-[17px] font-medium tracking-tight text-ink">
              Data source &amp; privacy
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-[2px] border border-line px-2 py-1 font-mono text-[12px] text-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            esc
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-2">
            <SourceCard
              active={!isCustom}
              onClick={() => setDraft({ ...draft, mode: "public" })}
              title="Public"
              line1="mempool.space"
              line2="via this site's proxy"
            />
            <SourceCard
              active={isCustom}
              onClick={() => setDraft({ ...draft, mode: "custom" })}
              title="Your instance"
              line1="direct from browser"
              line2="full query privacy"
            />
          </div>

          {/* Privacy explainer */}
          <div className="rounded-[2px] border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-dim">
            {isCustom ? (
              <>
                <span className="text-clean">● Private.</span>{" "}
                Queries go{" "}
                <span className="text-ink">straight from your browser</span> to
                the instance below — they never touch our servers. Point this at
                an Esplora/mempool node on your LAN for a fully self-contained
                setup.
              </>
            ) : (
              <>
                <span className="text-warn">● Shared.</span>{" "}
                Queries route browser → this site&apos;s server → mempool.space.
                Convenient and cached, but the site operator and mempool.space
                can see what you look up. Switch to your own instance for
                privacy.
              </>
            )}
          </div>

          {/* Custom fields */}
          {isCustom && (
            <div className="space-y-3">
              <Field
                label="REST base URL"
                placeholder="http://your-node.local:3006/api"
                value={draft.customBase}
                onChange={(v) => setDraft({ ...draft, customBase: v })}
              />
              <Field
                label="WebSocket URL (optional, for live mempool)"
                placeholder="ws://your-node.local:3006/api/v1/ws"
                value={draft.customWs}
                onChange={(v) => setDraft({ ...draft, customWs: v })}
              />
              <p className="font-mono text-[11px] leading-relaxed text-faint">
                Your instance must allow CORS from this origin. Run{" "}
                <a
                  href="https://github.com/mempool/mempool"
                  target="_blank"
                  rel="noreferrer"
                  className="text-dim underline hover:text-accent"
                >
                  mempool/mempool
                </a>{" "}
                or{" "}
                <a
                  href="https://github.com/Blockstream/electrs"
                  target="_blank"
                  rel="noreferrer"
                  className="text-dim underline hover:text-accent"
                >
                  electrs
                </a>{" "}
                against your own Bitcoin node.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[2px] border border-line px-3.5 py-2 font-mono text-[12px] text-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={() => {
              saveSource(draft);
              onClose();
            }}
            className="rounded-[2px] bg-accent px-3.5 py-2 font-mono text-[12px] uppercase tracking-wider text-bg transition-opacity hover:opacity-90"
          >
            save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SourceCard({
  active,
  onClick,
  title,
  line1,
  line2,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  line1: string;
  line2: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[2px] border p-3 text-left transition-colors ${
        active
          ? "border-accent/60 bg-accent-dim"
          : "border-line hover:border-line-strong"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full border"
          style={{
            borderColor: active ? "var(--accent)" : "var(--line-strong)",
            background: active ? "var(--accent)" : "transparent",
          }}
        />
        <span
          className="font-sans text-[14px] font-medium"
          style={{ color: active ? "var(--accent)" : "var(--text)" }}
        >
          {title}
        </span>
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-dim">{line1}</p>
      <p className="font-mono text-[11px] text-faint">{line2}</p>
    </button>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <MicroLabel>{label}</MicroLabel>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="mt-1.5 w-full rounded-[2px] border border-line bg-bg px-3 py-2 font-mono text-[13px] text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none"
      />
    </label>
  );
}
