"use client";

import dynamic from "next/dynamic";

// Regulator dashboard loads @coral-xyz/anchor which is CJS-only —
// must be dynamically imported client-side only to avoid SSR "exports is not defined"
const RegulatorContent = dynamic(() => import("./content"), {
  ssr: false,
  loading: () => (
    <div className="p-6 text-slate-400">Loading regulator dashboard...</div>
  ),
});

export default function RegulatorPage() {
  return <RegulatorContent />;
}