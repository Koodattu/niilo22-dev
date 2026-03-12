import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchExperience } from "../components/search-experience";
import { createPreviewMetadata, getQueryPreviewData, getSearchParamValue, getSharedVideoPreviewData, type SearchParams } from "./share-metadata";

type HomePageProps = {
  searchParams: Promise<SearchParams>;
};

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const resolvedSearchParams = await searchParams;
  const sharedVideoId = getSearchParamValue(resolvedSearchParams.result);
  const sharedSnippetId = getSearchParamValue(resolvedSearchParams.snippet);

  if (sharedVideoId) {
    const sharedPreview = await getSharedVideoPreviewData(sharedVideoId, sharedSnippetId);

    if (sharedPreview) {
      return createPreviewMetadata(sharedPreview);
    }
  }

  const query = getSearchParamValue(resolvedSearchParams.q);

  if (query) {
    return createPreviewMetadata(getQueryPreviewData(query));
  }

  return {};
}

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
