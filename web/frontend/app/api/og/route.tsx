import { ImageResponse } from "next/og";

import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE_PATH, OG_IMAGE_SIZE, SITE_NAME, getDefaultPreviewData, getQueryPreviewData, getSharedVideoPreviewData } from "../../share-metadata";

function renderPreviewImage(requestPreview = getDefaultPreviewData()) {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "52px",
        background: "linear-gradient(135deg, #1a3a33 0%, #245045 48%, #f0d6a5 100%)",
        color: "#fff7eb",
        fontFamily: "Segoe UI, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            maxWidth: "860px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              fontSize: 24,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              opacity: 0.9,
            }}
          >
            <div
              style={{
                display: "flex",
                padding: "10px 16px",
                borderRadius: "999px",
                background: "rgba(255, 247, 235, 0.16)",
                border: "1px solid rgba(255, 247, 235, 0.22)",
              }}
            >
              {SITE_NAME}
            </div>
            <div style={{ display: "flex" }}>{requestPreview.kicker}</div>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 68,
              lineHeight: 1.02,
              fontWeight: 700,
              textWrap: "balance",
            }}
          >
            {requestPreview.title}
          </div>

          <div
            style={{
              display: "flex",
              maxWidth: "900px",
              fontSize: 30,
              lineHeight: 1.35,
              color: "rgba(255, 247, 235, 0.9)",
            }}
          >
            {requestPreview.snippetText || DEFAULT_DESCRIPTION}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "14px",
            minWidth: "180px",
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "12px 18px",
              borderRadius: "20px",
              background: "rgba(9, 21, 18, 0.28)",
              border: "1px solid rgba(255, 247, 235, 0.18)",
              fontSize: 22,
            }}
          >
            {requestPreview.videoId ? `youtube.com/watch?v=${requestPreview.videoId}` : "niilo22.dev"}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            maxWidth: "860px",
            fontSize: 24,
            lineHeight: 1.4,
            color: "rgba(255, 247, 235, 0.82)",
          }}
        >
          {requestPreview.description}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "140px",
              height: "10px",
              borderRadius: "999px",
              background: "rgba(255, 247, 235, 0.2)",
            }}
          />
          <div
            style={{
              display: "flex",
              fontSize: 22,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(255, 247, 235, 0.76)",
            }}
          >
            Share preview
          </div>
        </div>
      </div>
    </div>,
    {
      width: OG_IMAGE_SIZE.width,
      height: OG_IMAGE_SIZE.height,
    },
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("result") ?? undefined;
    const snippetId = searchParams.get("snippet") ?? undefined;
    const query = searchParams.get("q") ?? undefined;
    const preview = videoId ? ((await getSharedVideoPreviewData(videoId, snippetId)) ?? getDefaultPreviewData()) : query ? getQueryPreviewData(query) : getDefaultPreviewData();

    return renderPreviewImage(preview);
  } catch {
    return renderPreviewImage(getDefaultPreviewData());
  }
}
