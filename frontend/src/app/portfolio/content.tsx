"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { usePrograms } from "@/lib/program";
import { getIdentityPda, getRegistryPda } from "@/lib/pda";

type Holding = {
  mint: PublicKey;
  loanId: string;
  borrowerName: string;
  balance: bigint;
};

type IdentityInfo = {
  exists: boolean;
  kyc_verified: boolean;
  accredited: boolean;
  sanctioned: boolean;
  jurisdiction: string;
};

export default function PortfolioPage() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const programs = usePrograms();

  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [registeredWallets, setRegisteredWallets] = useState<
    Array<{ address: string; kyc_verified: boolean; jurisdiction: string }>
  >([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [registerWallet, setRegisterWallet] = useState("");
  const [registerJurisdiction, setRegisterJurisdiction] = useState("PK");

  const refresh = useCallback(async () => {
    if (!programs || !publicKey) return;

    try {
      const [identityPda] = getIdentityPda(publicKey);
      // @ts-ignore
      const id = await programs.registry.account.identity.fetch(identityPda);
      setIdentity({
        exists: true,
        kyc_verified: id.kycVerified,
        accredited: id.accredited,
        sanctioned: id.sanctioned,
        jurisdiction: id.jurisdiction,
      });
    } catch {
      setIdentity({
        exists: false,
        kyc_verified: false,
        accredited: false,
        sanctioned: false,
        jurisdiction: "",
      });
    }

    try {
      // @ts-ignore
      const allLoans = await programs.trustledger.account.loanAccount.all();
      const list: Holding[] = [];
      for (const l of allLoans) {
        // @ts-ignore
        const acct = l.account;
        const ata = getAssociatedTokenAddressSync(
          acct.mint,
          publicKey,
          false,
          TOKEN_2022_PROGRAM_ID
        );
        try {
          const ta = await getAccount(
            connection,
            ata,
            "confirmed",
            TOKEN_2022_PROGRAM_ID
          );
          if (ta.amount > 0n) {
            list.push({
              mint: acct.mint,
              loanId: acct.loanId,
              borrowerName: acct.borrowerName,
              balance: ta.amount,
            });
          }
        } catch {
          /* no ATA */
        }
      }
      setHoldings(list);
    } catch (e) {
      console.error(e);
    }

    try {
      // @ts-ignore
      const allIds = await programs.registry.account.identity.all();
      const regs = allIds.map((i: any) => ({
        address: i.account.wallet.toBase58(),
        kyc_verified: i.account.kycVerified,
        jurisdiction: i.account.jurisdiction,
      }));
      setRegisteredWallets(regs);
    } catch (e) {
      console.error(e);
    }
  }, [programs, publicKey, connection]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function registerMyself() {
    if (!programs || !publicKey) return;
    setBusy("register-self");
    setErr(null);
    setOk(null);
    try {
      const [registryPda] = getRegistryPda();
      const [identityPda] = getIdentityPda(publicKey);
      // @ts-ignore
      await programs.registry.methods
        .registerIdentity("PK", true)
        .accounts({
          registry: registryPda,
          identity: identityPda,
          wallet: publicKey,
          authority: publicKey,
        })
        .rpc();
      setOk("Registered your wallet as KYC-verified");
      await refresh();
    } catch (e: any) {
      setErr(e?.message?.slice(0, 400) || String(e));
    } finally {
      setBusy(null);
    }
  }

  async function registerAnother() {
    if (!programs || !publicKey) return;
    setBusy("register-other");
    setErr(null);
    setOk(null);
    try {
      let target: PublicKey;
      try {
        target = new PublicKey(registerWallet);
      } catch {
        throw new Error("Invalid wallet address");
      }
      const [registryPda] = getRegistryPda();
      const [identityPda] = getIdentityPda(target);
      // @ts-ignore
      await programs.registry.methods
        .registerIdentity(registerJurisdiction || "PK", true)
        .accounts({
          registry: registryPda,
          identity: identityPda,
          wallet: target,
          authority: publicKey,
        })
        .rpc();
      setOk(`Registered ${registerWallet.slice(0, 8)}... as KYC-verified`);
      setRegisterWallet("");
      await refresh();
    } catch (e: any) {
      setErr(e?.message?.slice(0, 400) || String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Portfolio</h1>
        <button
          onClick={refresh}
          className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-sm"
        >
          Refresh
        </button>
      </div>

      {!publicKey && (
        <div className="rounded-lg bg-yellow-900/30 border border-yellow-500/30 p-4 text-sm text-yellow-200">
          Connect a wallet to view your portfolio.
        </div>
      )}

      {identity && publicKey && (
        <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
          <h2 className="font-semibold mb-3">My KYC Status</h2>
          {identity.exists ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Row k="KYC Verified" v={identity.kyc_verified ? "✅ Yes" : "❌ No"} />
              <Row k="Accredited" v={identity.accredited ? "Yes" : "No"} />
              <Row k="Sanctioned" v={identity.sanctioned ? "⚠️ Yes" : "No"} />
              <Row k="Jurisdiction" v={identity.jurisdiction || "—"} />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-slate-400 text-sm">
                Your wallet is not yet registered in the Identity Registry.
              </p>
              <button
                onClick={registerMyself}
                disabled={busy !== null}
                className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium text-sm"
              >
                {busy === "register-self" ? "Registering..." : "Register My Wallet"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
        <h2 className="font-semibold mb-3">My Holdings ({holdings.length})</h2>
        {holdings.length === 0 ? (
          <p className="text-slate-400 text-sm">
            No token holdings yet. Mint tokens to yourself from the Originator page.
          </p>
        ) : (
          <div className="space-y-2">
            {holdings.map((h) => (
              <div
                key={h.mint.toBase58()}
                className="flex justify-between items-center p-3 rounded border border-white/10"
              >
                <div>
                  <div className="font-medium text-sm">{h.borrowerName}</div>
                  <div className="text-xs text-slate-400">{h.loanId}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">
                    {h.balance.toString()} tokens
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    {h.mint.toBase58().slice(0, 10)}...
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
        <h2 className="font-semibold mb-3">Register Another Wallet as KYC</h2>
        <p className="text-slate-400 text-sm mb-4">
          Register any wallet as KYC-verified. Use this to unblock the marketplace demo:
          transfer to a non-KYC wallet will revert, then register it here and retry —
          the transfer will succeed.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <Input
            label="Wallet Address"
            value={registerWallet}
            onChange={setRegisterWallet}
            placeholder="Paste any Solana pubkey"
          />
          <Input
            label="Jurisdiction (2-4 chars)"
            value={registerJurisdiction}
            onChange={setRegisterJurisdiction}
            placeholder="PK, US, AE"
          />
        </div>
        <button
          onClick={registerAnother}
          disabled={busy !== null || !registerWallet}
          className="mt-4 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-medium text-sm"
        >
          {busy === "register-other" ? "Registering..." : "Register This Wallet"}
        </button>
      </div>

      {registeredWallets.length > 0 && (
        <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
          <h2 className="font-semibold mb-3">
            All Registered Wallets ({registeredWallets.length})
          </h2>
          <div className="space-y-2 text-sm">
            {registeredWallets.map((r) => (
              <div
                key={r.address}
                className="flex justify-between border-b border-white/5 pb-2"
              >
                <span className="font-mono text-xs text-slate-300">
                  {r.address.slice(0, 6)}...{r.address.slice(-6)}
                </span>
                <span
                  className={r.kyc_verified ? "text-emerald-400" : "text-red-400"}
                >
                  {r.kyc_verified ? "KYC ✓" : "Not KYC"} · {r.jurisdiction}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && (
        <div className="rounded-lg bg-red-900/30 border border-red-500/30 p-4 text-sm text-red-300 whitespace-pre-wrap">
          <strong>Error:</strong> {err}
        </div>
      )}
      {ok && (
        <div className="rounded-lg bg-emerald-900/30 border border-emerald-500/30 p-4 text-sm text-emerald-300">
          <strong>✓</strong> {ok}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-b border-white/5 pb-2">
      <div className="text-slate-400 text-xs">{k}</div>
      <div className="text-slate-100">{v}</div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm"
      />
    </div>
  );
}