"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Wallet button must render client-only (SSR would show "Select Wallet" then swap)
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const links = [
  { href: "/", label: "Home" },
  { href: "/originator", label: "Originator" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/regulator", label: "Regulator" },
];

export function Navbar() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-white/10 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <div className="w-7 h-7 rounded bg-blue-600 grid place-items-center">T</div>
            <span>TrustLedger</span>
            <span className="text-xs text-slate-500 ml-1 hidden md:inline">
              SoloNode Labs
            </span>
          </Link>
          <div className="hidden md:flex gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded text-sm ${
                  pathname === l.href
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-white/5"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        <WalletMultiButton className="!bg-blue-600 hover:!bg-blue-500 !h-9 !text-sm" />
      </div>
    </nav>
  );
}