import { Suspense } from "react";

import { SearchExperience } from "../components/search-experience";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <main className="page-shell">
          <section className="search-panel">
            <p className="status-banner">Ladataan hakunäkymää...</p>
          </section>
        </main>
      }
    >
      <SearchExperience />
    </Suspense>
  );
}
