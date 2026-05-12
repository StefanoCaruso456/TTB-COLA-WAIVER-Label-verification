import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold">
              TT
            </span>
            <div className="leading-tight">
              <div className="text-base font-semibold">TTB LabelCheck AI</div>
              <div className="text-xs text-[var(--muted)]">
                AI-assisted alcohol label verification · prototype
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/"
              className="px-3 py-1.5 text-sm rounded-md hover:bg-slate-100"
            >
              History
            </Link>
            <Link
              href="/new"
              className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-95"
            >
              New verification
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">
        {children}
      </main>
      <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto max-w-6xl px-6 py-4 text-xs text-[var(--muted)]">
          Prototype only. Not affiliated with the U.S. Department of the Treasury
          or TTB. No labels are submitted to COLAs Online from this tool.
        </div>
      </footer>
    </div>
  );
}
