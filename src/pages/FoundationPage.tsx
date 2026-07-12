type FoundationPageProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function FoundationPage({ eyebrow, title, description }: FoundationPageProps) {
  return (
    <div className="page page--placeholder">
      <section className="placeholder-panel" aria-labelledby={`${eyebrow.toLowerCase()}-title`}>
        <span className="eyebrow">{eyebrow}</span>
        <h1 id={`${eyebrow.toLowerCase()}-title`}>{title}</h1>
        <p>{description}</p>
        <span className="phase-label">Outside Phase 0</span>
      </section>
    </div>
  );
}
