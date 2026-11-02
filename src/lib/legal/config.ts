/**
 * Owner-supplied facts for the public legal pages (/legal/eula and /legal/privacy).
 *
 * NOTHING in this file may be guessed. Every value below starts empty on purpose: the legal pages render a clearly
 * marked "OWNER TO COMPLETE" placeholder for each empty value and show a "draft" banner until ALL required values are
 * filled in AND `legalReviewConfirmed` is set to true by the owner. Only then do the pages stop calling themselves a
 * draft and become indexable.
 *
 * Statements about how the application behaves (what is fetched, what is stored, how tokens are encrypted, session
 * lifetimes) come from the source code and are written directly in the documents. Everything that is a business or legal
 * decision (who the operator is, how long audit logs are kept, which law applies...) lives here.
 */

export const SERVICE_NAME = "Nexus IDE";
export const INTEGRATION_NAME = "Nexus Vercel Monitor";
export const SERVICE_URL = "https://nexus-ide-lime.vercel.app";
export const LEGAL_PATHS = { eula: "/legal/eula", privacy: "/legal/privacy" } as const;

export type OwnerKey =
  | "operatorName"
  | "operatorAddress"
  | "contactEmail"
  | "effectiveDate"
  | "minimumAge"
  | "pricing"
  | "governingLaw"
  | "databaseHosting"
  | "dataLocation"
  | "legalBasis"
  | "revokedConnectionRetention"
  | "sessionRowRetention"
  | "auditLogRetention"
  | "accountDeletionResponse"
  | "incidentNotification";

export interface OwnerField {
  /** Value supplied by the owner. Empty string = not supplied yet. */
  value: string;
  /** Short label used in placeholders and in the "what is missing" list. */
  label: string;
  /** What exactly the owner has to provide. */
  hint: string;
  /** Which document(s) need it. */
  docs: ("eula" | "privacy")[];
}

export const OWNER: Record<OwnerKey, OwnerField> = {
  operatorName: {
    value: "",
    label: "Operator legal name",
    hint: "Full legal name of the company or individual who operates Nexus IDE and is responsible for the data.",
    docs: ["eula", "privacy"],
  },
  operatorAddress: {
    value: "",
    label: "Operator postal address",
    hint: "Registered or postal address of the operator.",
    docs: ["eula", "privacy"],
  },
  contactEmail: {
    value: "",
    label: "Contact e-mail for legal and privacy requests",
    hint: "A monitored mailbox for support, legal notices, data-access and data-deletion requests.",
    docs: ["eula", "privacy"],
  },
  effectiveDate: {
    value: "",
    label: "Effective date",
    hint: "The date from which the published version applies (set it when you publish).",
    docs: ["eula", "privacy"],
  },
  minimumAge: {
    value: "",
    label: "Minimum age / eligibility",
    hint: "Minimum age (or other eligibility rule) for using the service, as required where you operate.",
    docs: ["eula", "privacy"],
  },
  pricing: {
    value: "",
    label: "Fees and pricing terms",
    hint: "State whether the service is free or paid and, if paid, the fee, billing and refund terms. Write 'free of charge' only if that is true.",
    docs: ["eula"],
  },
  governingLaw: {
    value: "",
    label: "Governing law and jurisdiction",
    hint: "Which law governs the EULA and which courts or dispute-resolution venue apply.",
    docs: ["eula"],
  },
  databaseHosting: {
    value: "",
    label: "Database / storage provider",
    hint: "The company that hosts the PostgreSQL database behind DATABASE_URL (this is not visible from the code).",
    docs: ["privacy"],
  },
  dataLocation: {
    value: "",
    label: "Data location and international transfers",
    hint: "Regions where the database and the application run, and the safeguards used if data leaves your jurisdiction.",
    docs: ["privacy"],
  },
  legalBasis: {
    value: "",
    label: "Data-protection regime, legal bases and user rights",
    hint: "Which data-protection laws apply (for example GDPR/UK GDPR/CCPA), the legal basis for each purpose, and the rights you will honour.",
    docs: ["privacy"],
  },
  revokedConnectionRetention: {
    value: "",
    label: "Retention of disconnected-connection records",
    hint: "How long the record of a disconnected Vercel connection (without the token) is kept before it is deleted. The current code keeps it until someone deletes it.",
    docs: ["privacy"],
  },
  sessionRowRetention: {
    value: "",
    label: "Retention of expired session records",
    hint: "How long expired or revoked session rows are kept. The current code never purges them automatically.",
    docs: ["privacy"],
  },
  auditLogRetention: {
    value: "",
    label: "Audit-log retention period",
    hint: "How long integration audit-log entries are kept. The current code has no automatic deletion.",
    docs: ["privacy"],
  },
  accountDeletionResponse: {
    value: "",
    label: "Account deletion / data request procedure and response time",
    hint: "How a user asks for full account deletion or a copy of their data (the app has no self-service account deletion yet) and how fast you will answer.",
    docs: ["privacy"],
  },
  incidentNotification: {
    value: "",
    label: "Security-incident notification commitment",
    hint: "What you commit to do (and by when) if personal data is breached, as required by the laws that apply to you.",
    docs: ["privacy"],
  },
};

/**
 * The owner must set this to true ONLY after the values above are filled in and a qualified lawyer has reviewed both
 * documents. Until then the pages stay marked as drafts and are excluded from search engines.
 */
export const OWNER_REVIEW = { legalReviewConfirmed: false };

export const ownerValue = (k: OwnerKey): string => OWNER[k].value.trim();

export function missingFields(doc?: "eula" | "privacy"): { key: OwnerKey; field: OwnerField }[] {
  return (Object.keys(OWNER) as OwnerKey[])
    .filter((k) => (!doc || OWNER[k].docs.includes(doc)) && !ownerValue(k))
    .map((key) => ({ key, field: OWNER[key] }));
}

/** A document may call itself final only if every field it needs is filled in and the owner confirmed the legal review. */
export const isPublicationReady = (doc: "eula" | "privacy"): boolean => missingFields(doc).length === 0 && OWNER_REVIEW.legalReviewConfirmed;
