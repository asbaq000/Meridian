/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `next build` and `next dev` share .next by default, so building while the
  // dev server is running swaps the webpack runtime chunk underneath the open
  // page and it dies with "Cannot read properties of undefined (reading
  // 'call')". Giving builds their own directory makes that impossible:
  //   NEXT_DIST_DIR=.next-build npx next build
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};
export default nextConfig;
