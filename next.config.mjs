/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: "/skill.md", destination: "/api/skill?file=SKILL.md" },
      { source: "/heartbeat.md", destination: "/api/skill?file=HEARTBEAT.md" },
      { source: "/counselor-skill.md", destination: "/api/skill?file=COUNSELOR_SKILL.md" },
    ];
  },
};

export default nextConfig;
