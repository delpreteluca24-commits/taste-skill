/**
 * RIGHTS-FIRST classification helper.
 *
 * Suggests GREEN / YELLOW / RED from the recorded facts about an asset and
 * explains why. A human always records the final classification; the database
 * independently refuses a GREEN without a documented basis
 * (rights_checks_green_requires_basis).
 *
 *   GREEN  may enter production under the recorded conditions
 *   YELLOW needs human review or more documentation — never used automatically
 *   RED    never enters automated production
 */

export const OWNERSHIP_OPTIONS = [
  { value: "owned", label: "Owned (our footage / graphics)" },
  { value: "licensed", label: "Licensed" },
  { value: "authorized", label: "Authorized in writing" },
  { value: "creator_provided", label: "Provided by creator / athlete" },
  { value: "public_domain", label: "Public domain" },
  { value: "third_party", label: "Third party, no permission" },
  { value: "unknown", label: "Unknown" },
] as const;

export type Ownership = (typeof OWNERSHIP_OPTIONS)[number]["value"];
export type RightsStatus = "green" | "yellow" | "red";

export type RightsFacts = {
  ownership: Ownership;
  /** null = unknown */
  commercialUse: boolean | null;
  evidenceUrl?: string | null;
  authorization?: string | null;
  license?: string | null;
  transformationRequired?: boolean;
  /** e.g. 'restricted' from the source's license_status */
  licenseStatus?: string | null;
  /** free-text red flags: takedown notice, broadcast footage, … */
  knownRisk?: string | null;
};

export type RightsSuggestion = {
  status: RightsStatus;
  reasons: string[];
  /** conditions that apply when the asset is used (shown next to GREEN/YELLOW) */
  conditions: string[];
  /** true when the DB would accept this status for these facts */
  greenAllowed: boolean;
};

const DOCUMENTED = new Set<Ownership>(["licensed", "authorized", "creator_provided"]);

/** Mirrors the DB rule: GREEN needs commercial use + a real basis (+ evidence unless owned/public domain). */
export function greenBasisMissing(f: RightsFacts): string[] {
  const missing: string[] = [];
  if (f.commercialUse !== true) missing.push("commercial use must be confirmed");
  if (f.ownership === "unknown" || f.ownership === "third_party") missing.push("ownership must be owned, licensed, authorized, creator-provided or public domain");
  if (!(f.ownership === "owned" || f.ownership === "public_domain") && !f.evidenceUrl?.trim()) {
    missing.push("an evidence link (license, contract or written permission) is required");
  }
  return missing;
}

export function suggestRightsStatus(f: RightsFacts): RightsSuggestion {
  const reasons: string[] = [];
  const conditions: string[] = [];
  if (f.transformationRequired) conditions.push("Use only transformed (commentary, edit, overlay) — never as-is.");

  // RED: explicit prohibitions or third-party material without permission
  if (f.licenseStatus === "restricted") reasons.push("Source license is marked restricted.");
  if (f.commercialUse === false) reasons.push("Commercial use is not allowed.");
  if (f.ownership === "third_party" && !f.authorization?.trim() && !f.evidenceUrl?.trim()) {
    reasons.push("Third-party material with no permission on file (e.g. league/broadcast footage).");
  }
  if (f.knownRisk?.trim() && /takedown|strike|claim|dmca|cease/i.test(f.knownRisk)) {
    reasons.push(`Known risk: ${f.knownRisk.trim()}`);
  }
  if (reasons.length > 0) {
    return {
      status: "red",
      reasons,
      conditions: ["Do not use in production. Tell the story with original formats instead."],
      greenAllowed: false,
    };
  }

  const missing = greenBasisMissing(f);
  if (missing.length === 0) {
    reasons.push(
      f.ownership === "owned"
        ? "We own this asset and commercial use is confirmed."
        : f.ownership === "public_domain"
          ? "Public-domain asset, commercial use confirmed."
          : `${labelFor(f.ownership)} with commercial use confirmed and evidence on file.`,
    );
    if (f.license?.trim()) conditions.push(`License terms: ${f.license.trim()}`);
    return { status: "green", reasons, conditions, greenAllowed: true };
  }

  // YELLOW: plausible but not documented enough
  if (DOCUMENTED.has(f.ownership) && !f.evidenceUrl?.trim()) reasons.push("Permission claimed but no evidence link on file.");
  if (f.commercialUse === null) reasons.push("Commercial use is unknown.");
  if (f.ownership === "unknown") reasons.push("Ownership is unknown.");
  if (f.ownership === "third_party") reasons.push("Third-party material: permission must be verified.");
  if (reasons.length === 0) reasons.push(...missing.map((m) => m.charAt(0).toUpperCase() + m.slice(1) + "."));
  conditions.push("Needs human review; usable only after a rights approval, never by automated workflows.");
  return { status: "yellow", reasons, conditions, greenAllowed: false };
}

function labelFor(o: Ownership): string {
  return OWNERSHIP_OPTIONS.find((x) => x.value === o)?.label ?? o;
}

/** Can an asset with this state be used? Mirrors the DB production gate. */
export function canUseInProduction(
  status: RightsStatus | "unchecked",
  opts: { yellowApproved: boolean; automated: boolean },
): boolean {
  if (status === "green") return true;
  if (status === "yellow") return !opts.automated && opts.yellowApproved;
  return false;
}
