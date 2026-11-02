import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/ide/Layout/Logo";
import { LEGAL_PATHS, OWNER, SERVICE_NAME, isPublicationReady, missingFields, ownerValue, type OwnerKey } from "@/lib/legal/config";

type Doc = "eula" | "privacy";

/** Owner-supplied value, or a loud, unmissable placeholder when it has not been supplied yet. */
export function Owner({ k }: { k: OwnerKey }) {
  const v = ownerValue(k);
  if (v) return <span className="whitespace-pre-line">{v}</span>;
  return (
    <mark
      data-owner-placeholder={k}
      className="rounded border border-amber-500/50 bg-amber-500/15 px-1.5 py-0.5 text-[0.92em] font-medium text-amber-200"
      title={OWNER[k].hint}
    >
      [OWNER TO COMPLETE: {OWNER[k].label}]
    </mark>
  );
}

/** Heading + body of one numbered section. */
export function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
        <span className="mr-2 text-accent-soft">{n}.</span>
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-subtle [&_a]:text-accent-soft [&_a]:underline [&_b]:font-semibold [&_b]:text-foreground [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.88em] [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6">
        {children}
      </div>
    </section>
  );
}

/** Table used for data inventories and retention schedules; scrolls horizontally on phones. */
export function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[34rem] border-collapse text-left text-[13.5px]">
        <thead className="bg-panel-2 text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? "px-3 py-2.5 font-medium text-foreground" : "px-3 py-2.5"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Honest status of the document: draft (with the exact list of missing facts) or ready. */
export function StatusBanner({ doc }: { doc: Doc }) {
  const missing = missingFields(doc);
  if (isPublicationReady(doc)) return null;
  return (
    <aside role="note" aria-label="Document status" className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-black">Draft</span>
        <strong className="text-base">Not ready for publication</strong>
      </div>
      <p>
        This document describes how {SERVICE_NAME} works today, but it is <b>incomplete</b>. Facts that only the owner can supply have not been filled in and are
        shown as <mark className="rounded bg-amber-500/20 px-1 text-amber-200">[OWNER TO COMPLETE: …]</mark>. Nothing has been guessed or invented. It has{" "}
        {OWNER_REVIEW_TEXT}
      </p>
      {missing.length > 0 && (
        <details className="rounded-xl border border-amber-500/30 bg-black/20 p-3">
          <summary className="cursor-pointer font-medium">
            {missing.length} required {missing.length === 1 ? "item is" : "items are"} missing from this document
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-amber-100/90">
            {missing.map(({ key, field }) => (
              <li key={key}>
                <b>{field.label}</b> — {field.hint}
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}

const OWNER_REVIEW_TEXT = "not been confirmed as reviewed by a qualified lawyer and must not be relied on as final legal terms.";

export function LegalLayout({ doc, title, intro, toc, children }: { doc: Doc; title: string; intro: ReactNode; toc: { id: string; title: string }[]; children: ReactNode }) {
  const other = doc === "eula" ? { href: LEGAL_PATHS.privacy, label: "Privacy Policy" } : { href: LEGAL_PATHS.eula, label: "End User License Agreement" };
  return (
    // The rest of the app is Russian-language; the legal documents are English.
    <div lang="en" className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold" aria-label={`${SERVICE_NAME} home`}>
            <Logo className="size-6" />
            {SERVICE_NAME}
          </Link>
          <nav aria-label="Legal documents" className="ml-auto flex items-center gap-1 text-xs sm:text-sm">
            <Link href={LEGAL_PATHS.eula} aria-current={doc === "eula" ? "page" : undefined} className={`rounded-lg px-2.5 py-2 ${doc === "eula" ? "bg-hover text-foreground" : "text-muted hover:text-foreground"}`}>
              EULA
            </Link>
            <Link href={LEGAL_PATHS.privacy} aria-current={doc === "privacy" ? "page" : undefined} className={`rounded-lg px-2.5 py-2 ${doc === "privacy" ? "bg-hover text-foreground" : "text-muted hover:text-foreground"}`}>
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-8 pb-[max(48px,env(safe-area-inset-bottom))] sm:py-12">
        <div className="space-y-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent-soft">Legal</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
            <div className="flex gap-1.5">
              <dt>Effective date:</dt>
              <dd className="text-subtle">
                <Owner k="effectiveDate" />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Service:</dt>
              <dd className="text-subtle">{SERVICE_NAME}, including Nexus Vercel Monitor</dd>
            </div>
          </dl>
          <div className="text-[15px] leading-relaxed text-subtle">{intro}</div>
        </div>

        <StatusBanner doc={doc} />

        <nav aria-label="Contents" className="rounded-2xl border border-border bg-panel p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Contents</div>
          <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {toc.map((t, i) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="block rounded py-1 text-subtle hover:text-foreground">
                  <span className="mr-1.5 text-muted">{i + 1}.</span>
                  {t.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="space-y-9">{children}</article>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link href={other.href} className="text-accent-soft underline">
            {other.label}
          </Link>
          <Link href="/" className="hover:text-foreground">
            Back to {SERVICE_NAME}
          </Link>
        </footer>
      </main>
    </div>
  );
}
