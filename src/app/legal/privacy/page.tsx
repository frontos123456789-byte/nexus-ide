import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, LegalLayout, Owner, Section } from "@/components/legal/LegalLayout";
import { INTEGRATION_NAME, LEGAL_PATHS, SERVICE_NAME, SERVICE_URL, isPublicationReady } from "@/lib/legal/config";

export const metadata: Metadata = {
  title: `Privacy Policy — ${SERVICE_NAME}`,
  description: `Privacy Policy for ${SERVICE_NAME} and the ${INTEGRATION_NAME} integration: what Vercel data is read, how connection tokens are stored, retention, deletion and security.`,
  alternates: { canonical: `${SERVICE_URL}${LEGAL_PATHS.privacy}` },
  // A draft must not be indexed as if it were the final policy.
  robots: isPublicationReady("privacy") ? { index: true, follow: true } : { index: false, follow: true },
};

const TOC = [
  { id: "controller", title: "Who is responsible for your data" },
  { id: "data", title: "Data we process" },
  { id: "vercel", title: "Vercel project and deployment data" },
  { id: "use", title: "How we use data" },
  { id: "tokens", title: "Connection tokens and encryption" },
  { id: "sharing", title: "Who data is shared with" },
  { id: "retention", title: "Retention" },
  { id: "deletion", title: "Deleting your data and disconnecting" },
  { id: "security", title: "Security measures" },
  { id: "transfers", title: "Data location and transfers" },
  { id: "rights", title: "Your rights" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact" },
];

export default function PrivacyPage() {
  return (
    <LegalLayout
      doc="privacy"
      title="Privacy Policy"
      toc={TOC}
      intro={
        <p>
          This Privacy Policy explains what information {SERVICE_NAME} (at{" "}
          <a href={SERVICE_URL} className="text-accent-soft underline">
            {SERVICE_URL.replace("https://", "")}
          </a>
          ) and the {INTEGRATION_NAME} integration collect, why, how long it is kept, and how you can remove it. It describes the application’s actual behaviour in its current
          version. It applies together with the{" "}
          <Link href={LEGAL_PATHS.eula} className="text-accent-soft underline">
            End User License Agreement
          </Link>
          .
        </p>
      }
    >
      <Section id="controller" n={1} title="Who is responsible for your data">
        <ul>
          <li>
            Operator: <Owner k="operatorName" />
          </li>
          <li>
            Address: <Owner k="operatorAddress" />
          </li>
          <li>
            Contact for privacy requests: <Owner k="contactEmail" />
          </li>
        </ul>
      </Section>

      <Section id="data" n={2} title="Data we process">
        <p>The table lists everything the application stores or handles, and where.</p>
        <DataTable
          head={["Data", "What it contains", "Where it lives"]}
          rows={[
            [
              "Account profile",
              "Display name, avatar URL, optional e-mail address (informational only — never used to match or merge accounts), sign-in provider (GitHub or Vercel), provider account ID and login name, creation and last-login times.",
              "Operator’s database",
            ],
            [
              "Sessions",
              "A SHA-256 hash of your random session token (the token itself is only in your browser cookie), creation / last-seen / expiry times, revocation time and the browser’s user-agent string.",
              "Operator’s database; HttpOnly cookie in your browser",
            ],
            [
              "Vercel connection",
              `Vercel access token for the ${INTEGRATION_NAME} integration (encrypted), the Vercel integration configuration ID, team ID (or “personal”), a display label (team name or Vercel username), connection time, and a small metadata record (Vercel user ID and a read-only flag).`,
              "Operator’s database",
            ],
            [
              "Vercel project and deployment data",
              "Fetched live from Vercel while you use the monitor; see section 3 for the full list.",
              "Server memory during the request; your browser while the page is open — not stored in the database",
            ],
            [
              "Build log excerpts",
              "Lines of a deployment’s build log, fetched only when you open the logs of a deployment.",
              "Server memory during the request; your browser while displayed — not stored in the database",
            ],
            [
              "Audit log",
              "Your internal user ID, provider, actor name (your display name), action (for example connecting or disconnecting Vercel), target (such as the integration configuration ID), success flag, a short detail text (up to 500 characters) and the time.",
              "Operator’s database",
            ],
            [
              "Failed-deployment alert bookkeeping",
              "Only deployment IDs that were already notified or acknowledged (at most 300 of each), under a key specific to your connected account.",
              "Your browser’s localStorage — never sent to the Operator",
            ],
            [
              "Technical request data",
              "Your IP address (from standard proxy headers) is used transiently in server memory for rate limiting and is not written to the database by the application. The hosting platform may log requests under its own policy.",
              "Server memory; hosting provider’s infrastructure",
            ],
          ]}
        />
        <p>
          Not every row applies to every user. For example, if you never connect Vercel, no Vercel connection or deployment data exists. Other features of {SERVICE_NAME} (AI chat,
          GitHub connection, local project files in your browser) have their own data; the points most relevant to them are in sections 5 and 6.
        </p>
      </Section>

      <Section id="vercel" n={3} title="Vercel project and deployment data">
        <p>
          When you install the {INTEGRATION_NAME} integration on Vercel, you choose the account or team and the projects to share, and Vercel gives {SERVICE_NAME} an access
          token. The integration asks for <b>read-only</b> permissions: Projects (Read) and Deployments (Read), plus optionally Team (Read) and User (Read) for display names. It
          does not ask for access to environment variables, domains, billing, or any write permission.
        </p>
        <p>With that token the server requests the following from the Vercel API (only <code>GET</code> requests, limited to a fixed allow-list of read endpoints):</p>
        <ul>
          <li>
            <b>Projects:</b> project ID and name, framework, linked Git repository, production branch, primary production domain, last-update time and the status of the latest
            deployments.
          </li>
          <li>
            <b>Deployments:</b> deployment ID, project, state (queued, building, ready, error, canceled), Production or Preview environment, creation / build / ready times and
            duration, deployment URL, Git branch, commit SHA, commit message, commit author name or login, repository, the Vercel dashboard link, and any error code or message.
          </li>
          <li>
            <b>Build log excerpts</b> for a single deployment, only when you open its logs.
          </li>
          <li>
            <b>Display name</b> of the team or personal account, if you granted the optional scopes.
          </li>
        </ul>
        <p>
          Commit messages, author names and log lines are third-party content that may contain personal data or secrets that were written into your repository or build output.
          They are displayed to you exactly as Vercel returns them.
        </p>
        <p>
          These requests are made on the server so that the token never reaches your browser. The responses are passed to your browser for display and are{" "}
          <b>not saved to the Operator’s database</b>; the server requests them with caching disabled. The monitor does not send this data to the AI features of {SERVICE_NAME}.
        </p>
      </Section>

      <Section id="use" n={4} title="How we use data">
        <ul>
          <li>
            <b>Monitoring (the core purpose):</b> to show your projects, deployments, statuses and logs, refresh them automatically while the panel is open, and raise
            failed-deployment alerts inside the application and, if you allow it, as browser notifications while a {SERVICE_NAME} tab is open.
          </li>
          <li>
            <b>Sign-in and account security:</b> to recognise you, keep you signed in, keep connections separated per user, and prevent abuse (sessions, rate limiting, request
            verification).
          </li>
          <li>
            <b>Accountability:</b> the audit log records connect / disconnect and similar actions so that they can be reviewed in case of problems or security incidents.
          </li>
          <li>
            <b>Legal and operational:</b> to answer your requests and comply with legal obligations.
          </li>
        </ul>
        <p>
          The application contains no advertising features and does not use your Vercel data for advertising or profiling. The Operator does not sell personal data. Legal bases
          for each purpose, where the law requires them, are stated in section 11.
        </p>
      </Section>

      <Section id="tokens" n={5} title="Connection tokens and encryption">
        <ul>
          <li>
            <b>Encrypted at rest.</b> The Vercel access token is encrypted with AES-256-GCM before it is written to the database. The ciphertext is bound to its owner (the
            account and provider are used as authenticated data), so a stored token cannot be swapped between users. Each encryption uses a fresh random nonce.
          </li>
          <li>
            <b>Key kept outside the database.</b> The encryption key is a server environment secret (<code>NEXUS_ENCRYPTION_KEY</code>), not stored in the database. In production, if it
            is missing, the application refuses to store provider tokens instead of falling back to a built-in key. Key rotation is supported through a second “previous” key
            used only for decryption.
          </li>
          <li>
            <b>Never sent to your browser.</b> The decrypted token is used only inside server requests to Vercel. It is not returned by the monitor’s API responses, not put in
            URLs, and not written to the audit log.
          </li>
          <li>
            <b>Scoped to you.</b> The monitor uses only the token of the signed-in user’s own connection; there is no shared owner token and no fallback to another connection.
          </li>
          <li>
            <b>Short-lived by design where possible.</b> Sign-in credentials from GitHub and Vercel (used for sign-in) are stored encrypted in the same way. The GitHub App connection
            uses short-lived installation tokens that are not stored.
          </li>
        </ul>
      </Section>

      <Section id="sharing" n={6} title="Who data is shared with">
        <p>Data is not sold. It goes to the following parties only as needed to run the service:</p>
        <DataTable
          head={["Party", "Role", "Data involved"]}
          rows={[
            ["Vercel", "Source of the project and deployment data; also the platform on which the application is hosted.", "Requests made with your token; ordinary web-request data of the hosting platform."],
            ["GitHub", "Optional sign-in and repository connection.", "Sign-in identity and the repositories you choose to share."],
            ["Database provider", "Stores the data listed in section 2.", <Owner key="db" k="databaseHosting" />],
            ["AI model provider (OpenRouter)", "Generates answers in the AI features of the application.", "Only the text you submit to those features. Vercel monitoring data is not sent."],
          ]}
        />
        <p>
          Data may also be disclosed where the law requires it or to protect the rights, safety and security of users and the service. The exact list of the Operator’s other
          service providers, if any, has not been supplied and must be completed by the owner.
        </p>
      </Section>

      <Section id="retention" n={7} title="Retention">
        <p>
          Retention periods below marked “owner to complete” are business decisions that the code does not make for the owner. The current implementation does <b>not</b> purge
          them automatically; until a period is set and enforced, those records remain until deleted.
        </p>
        <DataTable
          head={["Data", "How long it is kept"]}
          rows={[
            ["Vercel project, deployment and log data", "Not stored by the Operator. It exists in server memory while a request is processed and in your browser while the page is open."],
            ["Encrypted Vercel token", "While the connection is active. It is deleted (set to empty) when you disconnect, when Vercel reports that the integration was removed (if the webhook is configured), or when the token can no longer be decrypted."],
            ["Record of a disconnected connection (without token)", <Owner key="rc" k="revokedConnectionRetention" />],
            ["Sessions", <span key="s">A session is valid for at most 30 days and ends after 7 days without use; signing out revokes it immediately. Retention of the expired or revoked rows: <Owner k="sessionRowRetention" /></span>],
            ["Audit log", <Owner key="al" k="auditLogRetention" />],
            ["Account profile", "Until the account is deleted on request (see section 8)."],
            ["Alert bookkeeping in your browser", "Until you clear your browser data; the list is capped at 300 deployment IDs per list."],
            ["Hosting platform request logs", "According to the hosting provider’s own policy."],
          ]}
        />
      </Section>

      <Section id="deletion" n={8} title="Deleting your data and disconnecting">
        <ol>
          <li>
            <b>Disconnect Vercel Monitor.</b> In Code Studio → Vercel use the disconnect button. The stored token is removed from {SERVICE_NAME}, the connection is marked revoked and
            its permission entries are deleted, and the action is written to the audit log.
          </li>
          <li>
            <b>Remove the integration on Vercel.</b> Disconnecting inside {SERVICE_NAME} does not uninstall the integration. Remove it at <code>vercel.com/dashboard/integrations</code> so that the
            token is also invalidated at Vercel. The monitor has no permission to do this itself.
          </li>
          <li>
            <b>Unlink sign-in identities / sign out.</b> In account settings you can unlink GitHub or Vercel sign-in (at least one must remain; unlinking GitHub also revokes the
            authorisation at GitHub) and sign out, which revokes your session.
          </li>
          <li>
            <b>Clear browser data.</b> Clearing site data in your browser removes the alert bookkeeping and the session cookie.
          </li>
          <li>
            <b>Full deletion or a copy of your data.</b> The application has no self-service account deletion or data export yet. Send a request to <Owner k="contactEmail" />. Procedure and
            response time: <Owner k="accountDeletionResponse" />
          </li>
        </ol>
        <p>
          Disconnecting does not by itself delete the account profile, the revoked-connection record or past audit-log entries, and it does not delete anything that Vercel or GitHub
          hold on their own systems — those are governed by their policies.
        </p>
      </Section>

      <Section id="security" n={9} title="Security measures">
        <ul>
          <li>AES-256-GCM encryption of provider tokens, with the key held outside the database (section 5).</li>
          <li>Session tokens are random 256-bit values; only their SHA-256 hash is stored, so a database leak does not expose usable sessions. A new session is issued at every sign-in.</li>
          <li>Session cookies are <code>HttpOnly</code>, <code>SameSite=Lax</code> and, on HTTPS deployments, <code>Secure</code> with the <code>__Host-</code> prefix. The site is served over HTTPS with HSTS.</li>
          <li>Sign-in and connection flows use a one-time state value bound to your session and expire after 10 minutes; redirects are limited to same-site paths.</li>
          <li>State-changing endpoints check the request origin (CSRF protection) and are rate-limited.</li>
          <li>The monitor can only make read (<code>GET</code>) requests to an allow-listed set of Vercel endpoints, which limits the damage of any bug or misuse.</li>
          <li>Vercel webhooks are accepted only if their HMAC signature verifies against the integration secret.</li>
          <li>Each user can reach only their own connection; there is no shared credential.</li>
        </ul>
        <p>
          No system is perfectly secure and no absolute guarantee is given. Commitments on notifying you and authorities about a data breach: <Owner k="incidentNotification" />
        </p>
      </Section>

      <Section id="transfers" n={10} title="Data location and transfers">
        <p>
          <Owner k="dataLocation" />
        </p>
      </Section>

      <Section id="rights" n={11} title="Your rights">
        <p>
          Depending on where you live, you may have rights over your personal data, such as access, correction, deletion, restriction, objection and portability, and the right to
          complain to a supervisory authority. You can exercise them by contacting <Owner k="contactEmail" />.
        </p>
        <p>
          Applicable regime, legal bases for each purpose, and the rights the Operator will honour: <Owner k="legalBasis" />
        </p>
      </Section>

      <Section id="children" n={12} title="Children">
        <p>
          Eligibility and minimum age: <Owner k="minimumAge" />. The service is not intended for anyone below that age, and the Operator does not knowingly collect their data.
        </p>
      </Section>

      <Section id="changes" n={13} title="Changes to this policy">
        <p>
          This policy may be updated when the application or the law changes. The version published at this address, with the effective date at the top, is the one in force. If a
          change materially affects how Vercel data is used, the Operator should tell connected users before it takes effect.
        </p>
      </Section>

      <Section id="contact" n={14} title="Contact">
        <ul>
          <li>
            Operator: <Owner k="operatorName" />
          </li>
          <li>
            Address: <Owner k="operatorAddress" />
          </li>
          <li>
            E-mail for privacy requests: <Owner k="contactEmail" />
          </li>
        </ul>
      </Section>
    </LegalLayout>
  );
}
