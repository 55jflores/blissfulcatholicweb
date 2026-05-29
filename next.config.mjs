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
  },
};

export default nextConfig;
