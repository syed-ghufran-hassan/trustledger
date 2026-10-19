"use client";

import dynamic from "next/dynamic";

const PortfolioContent = dynamic(() => import("./content"), {
  ssr: false,
  loading: () => (
    <div className="p-6 text-slate-400">Loading portfolio...</div>
  ),
});

export default function PortfolioPage() {
  return <PortfolioContent />;
}
