import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="page page--placeholder">
      <section className="placeholder-panel">
        <span className="eyebrow">Page not found</span>
        <h1>This path is not part of Planibly.</h1>
        <p>The address may be incomplete or may belong to a future phase.</p>
        <Link className="button button--primary" to="/">
          Return home
        </Link>
      </section>
    </div>
  );
}
