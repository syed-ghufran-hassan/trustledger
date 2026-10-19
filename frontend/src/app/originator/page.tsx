"use client";

import dynamic from "next/dynamic";

const OriginatorContent = dynamic(() => import("./content"), {
  ssr: false,
  loading: () => (
    <div className="p-6 text-slate-400">Loading originator dashboard...</div>
  ),
});

export default function OriginatorPage() {
  return <OriginatorContent />;
}
