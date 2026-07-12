import { Surface } from '../components/ui/Surface';

const foundations = [
  ['Offline shell', 'Cached after the first successful load'],
  ['Local storage', 'Versioned IndexedDB ready for future data'],
  ['Private by default', 'No account, analytics, backend, or external AI'],
] as const;

export function HomePage() {
  return (
    <div className="page page--home">
      <section className="welcome" aria-labelledby="welcome-title">
        <span className="eyebrow">A calmer place to plan</span>
        <h1 id="welcome-title">Make room for what matters.</h1>
        <p>
          Planibly is being built as a private, offline-first personal planner. The application
          foundation is ready; planning features will arrive one careful phase at a time.
        </p>
      </section>

      <section className="foundation-grid" aria-labelledby="foundation-title">
        <div className="section-heading">
          <span className="eyebrow">Phase 0</span>
          <h2 id="foundation-title">Foundation in place</h2>
        </div>
        {foundations.map(([title, description], index) => (
          <Surface key={title} className="foundation-card">
            <span className="foundation-card__number" aria-hidden="true">
              0{index + 1}
            </span>
            <h3>{title}</h3>
            <p>{description}</p>
          </Surface>
        ))}
      </section>
    </div>
  );
}
