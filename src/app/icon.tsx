import { ImageResponse } from "next/og";

// The browser-tab icon: the brand mark (teal rounded square + speech
// bubble with a sparkle), matching src/components/brand/logo.tsx. Next.js renders
// this at build time and auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f7e78", // brand teal (globals.css --primary)
          borderRadius: 8,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M4.5 11.2c0-3.7 3.36-6.7 7.5-6.7s7.5 3 7.5 6.7-3.36 6.7-7.5 6.7c-.86 0-1.69-.13-2.46-.37L5.7 19l.86-3.05A6.4 6.4 0 0 1 4.5 11.2Z"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M12 8.2l.75 1.9 1.95.75-1.95.75L12 13.5l-.75-1.9-1.95-.75 1.95-.75L12 8.2Z" fill="#ffffff" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
