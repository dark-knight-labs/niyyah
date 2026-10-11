import Link from "next/link";

interface Props {
  eyebrow: string;
  title: React.ReactNode;
  lead: string;
  facts: [string, string][];
  children: React.ReactNode;
  alt: React.ReactNode;
}

/** The sign-in / register page: an aside with the pitch and a few facts, and the form on the right. */
export function AuthSheet({ eyebrow, title, lead, facts, children, alt }: Props) {
  return (
    <div className="sheet">
      <div className="sheet-aside">
        <span className="mono text-[var(--muted-foreground)]">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="sheet-lead">{lead}</p>
        <div className="sheet-facts mono">
          {facts.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>
      </div>
      <div className="sheet-form">
        {children}
        <p className="sheet-alt">{alt}</p>
        <Link href="/" className="mono text-[var(--muted-foreground)] hover:text-[var(--foreground)]">← Back to Niyyah</Link>
      </div>
    </div>
  );
}
