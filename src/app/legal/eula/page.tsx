import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout, Owner, Section } from "@/components/legal/LegalLayout";
import { INTEGRATION_NAME, LEGAL_PATHS, SERVICE_NAME, SERVICE_URL, isPublicationReady } from "@/lib/legal/config";

export const metadata: Metadata = {
  title: `End User License Agreement — ${SERVICE_NAME}`,
  description: `End User License Agreement for ${SERVICE_NAME} and the ${INTEGRATION_NAME} integration.`,
  alternates: { canonical: `${SERVICE_URL}${LEGAL_PATHS.eula}` },
  // A draft must not be indexed as if it were the final terms.
  robots: isPublicationReady("eula") ? { index: true, follow: true } : { index: false, follow: true },
};

const TOC = [
  { id: "parties", title: "Who this agreement is between" },
  { id: "service", title: "What the service is" },
  { id: "acceptance", title: "Acceptance and eligibility" },
  { id: "license", title: "License granted to you" },
  { id: "accounts", title: "Accounts and third-party connections" },
  { id: "monitor", title: "Nexus Vercel Monitor: scope and limits" },
  { id: "use", title: "Acceptable use" },
  { id: "ai", title: "AI features" },
  { id: "privacy", title: "Your data and privacy" },
  { id: "availability", title: "Availability, changes and support" },
  { id: "fees", title: "Fees" },
  { id: "ip", title: "Intellectual property" },
  { id: "warranty", title: "Disclaimer of warranties" },
  { id: "liability", title: "Limitation of liability" },
  { id: "termination", title: "Termination and end of access" },
  { id: "changes", title: "Changes to this agreement" },
  { id: "law", title: "Governing law" },
  { id: "contact", title: "Contact" },
];

export default function EulaPage() {
  return (
    <LegalLayout
      doc="eula"
      title="End User License Agreement"
      toc={TOC}
      intro={
        <p>
          This End User License Agreement (“<b className="text-foreground">Agreement</b>”) governs your use of {SERVICE_NAME} at{" "}
          <a href={SERVICE_URL} className="text-accent-soft underline">
            {SERVICE_URL.replace("https://", "")}
          </a>{" "}
          and of the {INTEGRATION_NAME} integration. Please read it together with the{" "}
          <Link href={LEGAL_PATHS.privacy} className="text-accent-soft underline">
            Privacy Policy
          </Link>
          .
        </p>
      }
    >
      <Section id="parties" n={1} title="Who this agreement is between">
        <p>
          The agreement is between you (“<b>you</b>”, the person or organisation using the service) and the operator of {SERVICE_NAME} (“<b>Operator</b>”, “<b>we</b>”):
        </p>
        <ul>
          <li>
            Operator: <Owner k="operatorName" />
          </li>
          <li>
            Address: <Owner k="operatorAddress" />
          </li>
          <li>
            Contact: <Owner k="contactEmail" />
          </li>
        </ul>
        <p>
          If you use the service on behalf of a company or team, you confirm that you are authorised to bind that organisation to this Agreement, and “you” then also
          means that organisation.
        </p>
      </Section>

      <Section id="service" n={2} title="What the service is">
        <p>
          {SERVICE_NAME} is a web-based development environment. It combines an AI assistant and multi-agent workflows (Chat, Work and Code modes), a browser code
          editor, “Code Studio” tools, a GitHub and Vercel control centre, and — the part this Agreement pays particular attention to — <b>{INTEGRATION_NAME}</b>.
        </p>
        <p>
          <b>{INTEGRATION_NAME}</b> is a read-only dashboard for your Vercel account. After you sign in to {SERVICE_NAME} and install the monitoring integration on Vercel,
          it shows your Vercel projects and deployments: status (queued, building, ready, error, canceled), Production or Preview environment, start time and build
          duration, Git branch and commit, links to the Vercel dashboard, a short excerpt of build logs on request, and in-browser alerts about failed deployments.
        </p>
        <p>
          The service is a tool for monitoring and development assistance. It is <b>not</b> a replacement for the Vercel dashboard, for Vercel’s own notifications, or for
          an incident-response or alerting system.
        </p>
      </Section>

      <Section id="acceptance" n={3} title="Acceptance and eligibility">
        <p>
          By signing in, connecting a third-party account, or otherwise using the service, you accept this Agreement. If you do not accept it, do not use the service.
        </p>
        <p>
          Eligibility: <Owner k="minimumAge" />
        </p>
      </Section>

      <Section id="license" n={4} title="License granted to you">
        <p>
          Subject to this Agreement, the Operator grants you a limited, non-exclusive, non-transferable, non-sublicensable and revocable licence to access and use the
          hosted service for your own development and monitoring purposes.
        </p>
        <p>
          This Agreement covers use of the hosted service. It does not by itself grant any rights in the {SERVICE_NAME} source code; any licence for source code is separate
          and, if none has been published, none is granted here.
        </p>
        <p>You may not, except where applicable law gives you that right regardless of this clause:</p>
        <ul>
          <li>sell, rent, lease or sublicense the service or resell access to it;</li>
          <li>copy, modify or create derivative works of the service as hosted by the Operator;</li>
          <li>reverse engineer or attempt to extract non-public source code or secrets from the hosted service;</li>
          <li>remove or obscure ownership or attribution notices.</li>
        </ul>
      </Section>

      <Section id="accounts" n={5} title="Accounts and third-party connections">
        <p>
          You can sign in with a GitHub or Vercel identity. Signing in lets {SERVICE_NAME} know who you are; it does not by itself give {SERVICE_NAME} access to your
          repositories or Vercel projects. Access is granted separately, on the provider’s official page, and you choose what to share.
        </p>
        <p>You are responsible for:</p>
        <ul>
          <li>the activity under your {SERVICE_NAME} account and your connected GitHub and Vercel accounts, and for keeping them secure;</li>
          <li>having the right to connect the Vercel account or team you select — for a team account, the permission of that team;</li>
          <li>complying with the terms of the third parties you use with the service, including Vercel, GitHub and the AI model provider used for AI features.</li>
        </ul>
        <p>
          Third-party names and marks (such as Vercel and GitHub) belong to their owners. Their use here identifies the services the product works with and does not imply
          sponsorship or endorsement by them.
        </p>
      </Section>

      <Section id="monitor" n={6} title="Nexus Vercel Monitor: scope and limits">
        <ul>
          <li>
            <b>Read-only access.</b> The integration is registered to request only <i>Read</i> access to Projects and Deployments (optionally Team and User, for display names
            only). The application is written so that its monitoring code sends only read requests to the Vercel API. It does not create, change, redeploy, cancel or delete
            projects or deployments and does not read or change environment variables.
          </li>
          <li>
            <b>Data comes from Vercel.</b> What you see is what the Vercel API returns at the moment of the request. It may be delayed, incomplete, rate-limited or wrong, and
            Vercel remains the authoritative source.
          </li>
          <li>
            <b>Alerts are best-effort and work only while {SERVICE_NAME} is open.</b> Failed-deployment alerts are shown inside the application and, if you allow it, as browser
            notifications while a {SERVICE_NAME} tab is open. There is no push notification, e-mail or SMS when the browser is closed. Do not rely on the monitor as your only way
            to learn about failed or degraded deployments.
          </li>
          <li>
            <b>Build logs may contain sensitive content.</b> Log excerpts are shown exactly as Vercel returns them. Avoid printing secrets in builds, and do not share your screen
            or exports of logs with people who should not see them.
          </li>
          <li>
            <b>Your Vercel limits apply.</b> Requests count against Vercel’s rate limits for your account. The monitor pauses refreshing when Vercel reports a limit.
          </li>
        </ul>
      </Section>

      <Section id="use" n={7} title="Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>connect an account, team or project you are not entitled to access, or use the monitor to view another person’s data without their authorisation;</li>
          <li>attempt to bypass authentication, rate limits, or the read-only restrictions of the service, or to probe, scan or test its security without written permission;</li>
          <li>interfere with or overload the service, its database or the connected third-party APIs, including by automated or abusive request patterns;</li>
          <li>use the service to violate law, to infringe the rights of others, or to build or distribute malware;</li>
          <li>upload or process content you have no right to use.</li>
        </ul>
      </Section>

      <Section id="ai" n={8} title="AI features">
        <p>
          Chat, Work and Code modes use large language models provided by a third party. Text you submit to those features (prompts, attached files, pasted code) is sent to
          that provider to generate a response. Do not submit secrets, credentials or personal data you are not allowed to share.
        </p>
        <p>
          AI output can be wrong, insecure, incomplete or infringing. You are responsible for reviewing, testing and deciding whether to use any output, including generated
          code, before running or deploying it.
        </p>
      </Section>

      <Section id="privacy" n={9} title="Your data and privacy">
        <p>
          How we handle personal data, Vercel project and deployment data and the encrypted connection token is described in the{" "}
          <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link>, which is part of this Agreement. You keep ownership of your code, projects, deployments and other content;
          you give the Operator only the permission needed to process it to provide the service as described.
        </p>
      </Section>

      <Section id="availability" n={10} title="Availability, changes and support">
        <p>
          The service is provided as available. The Operator makes no commitment to a particular uptime, response time, data-retention duration or support level, and may
          change, suspend or discontinue features (including {INTEGRATION_NAME}) at any time. Third-party outages — for example at Vercel, GitHub or the AI provider — are
          outside the Operator’s control.
        </p>
        <p>
          Support requests: <Owner k="contactEmail" />
        </p>
      </Section>

      <Section id="fees" n={11} title="Fees">
        <p>
          <Owner k="pricing" />
        </p>
      </Section>

      <Section id="ip" n={12} title="Intellectual property">
        <p>
          The service, its design, text, graphics and software, and the {SERVICE_NAME} and {INTEGRATION_NAME} names are owned by the Operator or its licensors and are
          protected by applicable law. Except for the licence in section 4, no rights are transferred to you.
        </p>
        <p>
          If you send feedback or suggestions, you allow the Operator to use them without obligation to you.
        </p>
      </Section>

      <Section id="warranty" n={13} title="Disclaimer of warranties">
        <p>
          To the maximum extent permitted by applicable law, the service is provided “<b>as is</b>” and “<b>as available</b>”, without warranties of any kind, express or
          implied, including warranties of merchantability, fitness for a particular purpose, accuracy, non-infringement, uninterrupted or error-free operation, and that
          monitoring data or alerts will be complete, timely or accurate. Nothing in this Agreement limits rights you have under mandatory consumer-protection law.
        </p>
      </Section>

      <Section id="liability" n={14} title="Limitation of liability">
        <p>
          To the maximum extent permitted by applicable law, the Operator is not liable for indirect, incidental, special, consequential or punitive damages, or for loss of
          profits, revenue, data, goodwill or business opportunity, arising from or related to the service. This includes losses caused by a missed, delayed or incorrect
          deployment status or alert, third-party outages, AI output, or unauthorised access that was not caused by the Operator’s wilful misconduct or gross negligence.
        </p>
        <p>
          Nothing in this Agreement excludes or limits liability that cannot be excluded or limited by law (for example liability for fraud, wilful misconduct, or death or
          personal injury caused by negligence, where the law so provides). Any further cap on liability, and whether the clauses above are enforceable in your
          jurisdiction, must be confirmed by the owner with qualified counsel before publication.
        </p>
      </Section>

      <Section id="termination" n={15} title="Termination and end of access">
        <p>
          <b>By you.</b> You may stop using the service at any time:
        </p>
        <ul>
          <li>
            use the disconnect button in the Vercel Monitor panel (Code Studio → Vercel). This removes the stored Vercel access token from {SERVICE_NAME} and marks the
            connection as revoked;
          </li>
          <li>
            uninstall the {INTEGRATION_NAME} integration on Vercel at <code>vercel.com/dashboard/integrations</code>. The monitor cannot remove the installation itself, because it has no
            permission to manage integrations;
          </li>
          <li>unlink GitHub or Vercel sign-in identities in account settings (one sign-in identity must remain), and sign out;</li>
          <li>
            to close your account entirely or have your data deleted, contact <Owner k="contactEmail" />. The application currently has no self-service “delete account” button.
          </li>
        </ul>
        <p>
          <b>By the Operator.</b> The Operator may suspend or end your access, with or without notice, if you breach this Agreement, if needed to protect the security or
          stability of the service or other users, to comply with law or a third-party requirement, or if the service or a feature is discontinued. No minimum notice period
          is promised. Refund rules, if the service is paid, belong in section 11 (Fees).
        </p>
        <p>
          <b>Automatic end of access.</b> A Vercel connection also ends if Vercel rejects the stored token (for example because you revoked or removed the integration), if the
          token can no longer be decrypted, or — where the Vercel webhook for <code>integration-configuration.removed</code> has been configured by the Operator — when Vercel reports
          that the integration was removed. In those cases the stored token is deleted and you must reconnect to use the monitor again.
        </p>
        <p>
          <b>Effect.</b> When access ends your licence ends. Sections that by their nature should survive (intellectual property, disclaimers, limitation of liability, governing
          law) survive. What happens to your data afterwards is described in the Privacy Policy.
        </p>
      </Section>

      <Section id="changes" n={16} title="Changes to this agreement">
        <p>
          The Operator may update this Agreement. The version in force is the one published at this address, with the effective date shown at the top. If you continue to use the
          service after an update takes effect you accept the updated Agreement; if you do not accept it, stop using the service and disconnect your accounts.
        </p>
      </Section>

      <Section id="law" n={17} title="Governing law">
        <p>
          <Owner k="governingLaw" />
        </p>
      </Section>

      <Section id="contact" n={18} title="Contact">
        <ul>
          <li>
            Operator: <Owner k="operatorName" />
          </li>
          <li>
            Address: <Owner k="operatorAddress" />
          </li>
          <li>
            E-mail: <Owner k="contactEmail" />
          </li>
        </ul>
      </Section>
    </LegalLayout>
  );
}
