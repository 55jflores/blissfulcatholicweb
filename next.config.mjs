/** @type {import('next').NextConfig} */
const nextConfig = {
  // The same app serves the iOS API today and the web frontend later.

  // romcal loads its country-calendar + locale files dynamically, which the
  // bundler can't trace. Keep it external (un-bundled) and force its calendar/
  // locale data into the function so /api/liturgy works on Vercel.
  serverExternalPackages: ["romcal"],
  outputFileTracingIncludes: {
    "/api/liturgy": [
      "./node_modules/romcal/dist/calendars/**",
      "./node_modules/romcal/dist/locales/**",
    ],
    // Privacy policy markdown read by app/privacy/page.tsx at build time.
    "/privacy": ["./docs/privacy.md"],
  },

  // Belt-and-suspenders trailing-slash handling. Vercel normalizes most of
  // these by default, but an explicit 308 redirect makes /privacy/ → /privacy
  // deterministic regardless of how an external link is formatted.
  async redirects() {
    return [
      { source: "/privacy/", destination: "/privacy", permanent: true },
    ];
  },
};

export default nextConfig;
