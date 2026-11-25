import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Globe2, Home, MapPin, Plane, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX, Building } from "lucide-react";
import { countryName } from "@/lib/countries";

export function SponsorshipBadge({ category }: { category: string }) {
  const map: Record<string, [BadgeVariant, React.ReactNode]> = {
    Confirmed: ["success", <ShieldCheck key="i" />],
    Likely: ["info", <ShieldCheck key="i" />],
    "Case-by-Case": ["warning", <ShieldAlert key="i" />],
    Unknown: ["muted", <ShieldQuestion key="i" />],
    "No Sponsorship": ["danger", <ShieldX key="i" />],
  };
  const [variant, icon] = map[category] ?? map.Unknown;
  return (
    <Badge variant={variant} title="Visa sponsorship">
      {icon}
      {category === "Unknown" ? "Sponsorship unknown" : category === "No Sponsorship" ? "No sponsorship" : `Sponsorship: ${category}`}
    </Badge>
  );
}

export function RemoteBadge({ category, countries }: { category: string; countries?: string[] }) {
  const label =
    category === "Country-only" && countries?.length
      ? `Remote – ${countries.map((c) => (c === "GB" ? "UK" : c === "US" ? "US" : countryName(c))).join("/")} only`
      : category === "Remote (unspecified)"
        ? "Remote (countries unclear)"
        : category === "Region"
          ? "Remote – region only"
          : category;
  const icon = category === "Worldwide" ? <Globe2 /> : category === "Onsite" ? <Building /> : category === "Hybrid" ? <Home /> : category === "Relocation required" ? <Plane /> : <MapPin />;
  const variant: BadgeVariant = category === "Worldwide" ? "success" : category === "Unknown" || category === "Remote (unspecified)" ? "muted" : "outline";
  return (
    <Badge variant={variant}>
      {icon}
      {label}
    </Badge>
  );
}

export function BandBadge({ band, score }: { band: string; score?: number }) {
  const v: Record<string, BadgeVariant> = { Excellent: "success", Strong: "info", Good: "default", Moderate: "warning", Poor: "muted", Ineligible: "danger" };
  return (
    <Badge variant={v[band] ?? "muted"}>
      {score != null && band !== "Ineligible" ? `${score} · ` : ""}
      {band}
    </Badge>
  );
}

export function EligibilityBadge({ status }: { status: string }) {
  const v: BadgeVariant = status === "Eligible" ? "success" : status === "Ineligible" ? "danger" : "warning";
  return <Badge variant={v}>{status}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const v: Record<string, BadgeVariant> = {
    Saved: "muted",
    Preparing: "info",
    "Needs you": "warning",
    Ready: "default",
    Submitted: "info",
    "Recruiter response": "success",
    Assessment: "success",
    Interview: "success",
    Offer: "success",
    Rejected: "danger",
    "No response": "muted",
  };
  return <Badge variant={v[status] ?? "muted"}>{status}</Badge>;
}

export function ScoreRing({ score, band }: { score: number; band: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const ineligible = band === "Ineligible";
  return (
    <div className="relative size-16 shrink-0" title={`Suitability score ${score}/100 – not an interview probability`}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} className="fill-none stroke-muted" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          className={ineligible ? "fill-none stroke-red-500/70" : "fill-none"}
          stroke={ineligible ? undefined : "url(#score-grad)"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (score / 100) * c}
        />
        <defs>
          <linearGradient id="score-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7C3AED" />
            <stop offset="1" stopColor="#2563EB" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center text-sm font-bold">{score}</div>
    </div>
  );
}
