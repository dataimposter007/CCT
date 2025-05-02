
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
       { // Added rule for Google Cloud Storage images
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
    ],
    // Adding unoptimized: true globally can impact performance.
    // It's better to apply it per-image if needed, but this is a workaround for potential issues.
    // unoptimized: true, // You might consider this if errors persist, but prefer per-image unoptimization
  },
};

export default nextConfig;
