"use client";

import dynamic from "next/dynamic";

const MarketplaceContent = dynamic(() => import("./content"), {
  ssr: false,
  loading: () => (
    <div className="p-6 text-slate-400">Loading marketplace...</div>
  ),
});

export default function MarketplacePage() {
  return <MarketplaceContent />;
}
