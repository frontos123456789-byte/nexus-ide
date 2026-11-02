import { LEGAL_PATHS } from "@/lib/legal/config";

/**
 * Small "EULA · Privacy Policy" link row used across the interface (login, account settings, Vercel Monitor).
 * Plain anchors that open in a new tab so that an unfinished sign-in / connect flow is never interrupted.
 * Safe to import from both server and client components.
 */
export function LegalLinks({ className = "", prefix }: { className?: string; prefix?: string }) {
  const a = "underline decoration-dotted underline-offset-2 hover:text-foreground";
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 ${className}`} data-legal-links>
      {prefix && <span>{prefix}</span>}
      <a href={LEGAL_PATHS.eula} target="_blank" rel="noopener" className={a}>
        EULA
      </a>
      <span aria-hidden="true">·</span>
      <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener" className={a}>
        Privacy Policy
      </a>
    </span>
  );
}
