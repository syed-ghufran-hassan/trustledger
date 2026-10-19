"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { usePrograms } from "@/lib/program";

type LoanRow = {
  publicKey: PublicKey;
  account: {
    mint: PublicKey;
    loanId: string;
    borrowerName: string;
    principal: BN;
    interestRateBps: number;
    maturity: BN;
    paused: boolean;
  };
};

type Holder = {
  address: string;
  balance: bigint;
  pct: number;
  kyc: boolean;
  jurisdiction: string;
};

type Transfer = {
  from: string;
  to: string;
  amount: string;
  block: number;
  tx: string;
};

export default function RegulatorPage() {
  const { connection } = useConnection();
  const programs = usePrograms();

  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [selected, setSelected] = useState<LoanRow | null>(null);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [totalSupply, setTotalSupply] = useState<bigint>(0n);
  const [totalKyc, setTotalKyc] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!programs) return;
    setLoading(true);
    try {
      // @ts-ignore
      const all = await programs.trustledger.account.loanAccount.all();
      setLoans(all);
      setSelected((prev) => {
        if (!prev) return all[0] ?? null;
        return all.find((l: any) => l.publicKey.equals(prev.publicKey)) ?? all[0] ?? null;
      });
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [programs]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Load holders + transfers whenever selection changes
  useEffect(() => {
    (async () => {
      if (!programs || !selected) return;
      setLoading(true);
      try {
        const mint = selected.account.mint;

        // 1. Get all registered identities for KYC lookup
        // @ts-ignore
        const allIds = await programs.registry.account.identity.all();
        const kycMap = new Map<string, { kyc: boolean; jurisdiction: string }>();
        for (const i of allIds) {
          kycMap.set(i.account.wallet.toBase58(), {
            kyc: i.account.kycVerified,
            jurisdiction: i.account.jurisdiction,
          });
        }
        setTotalKyc(allIds.filter((i: any) => i.account.kycVerified).length);

        // 2. Get transfer history from the mint
        const sigs = await connection.getSignaturesForAddress(mint, { limit: 100 });
        const txs: Transfer[] = [];
        for (const s of sigs) {
          try {
            const tx = await connection.getParsedTransaction(s.signature, {
              maxSupportedTransactionVersion: 0,
              commitment: "confirmed",
            });
            if (!tx || tx.meta?.err) continue;
            const pre = tx.meta?.preTokenBalances ?? [];
            const post = tx.meta?.postTokenBalances ?? [];
            // Find ownership changes on this mint
            const accounts = new Map<
              string,
              { pre: bigint; post: bigint }
            >();
            for (const b of pre) {
              if (b.mint === mint.toBase58() && b.owner) {
                const cur = accounts.get(b.owner) ?? { pre: 0n, post: 0n };
                cur.pre = BigInt(b.uiTokenAmount.amount);
                accounts.set(b.owner, cur);
              }
            }
            for (const b of post) {
              if (b.mint === mint.toBase58() && b.owner) {
                const cur = accounts.get(b.owner) ?? { pre: 0n, post: 0n };
                cur.post = BigInt(b.uiTokenAmount.amount);
                accounts.set(b.owner, cur);
              }
            }
            let from = "";
            let to = "";
            let amount = 0n;
            for (const [owner, delta] of accounts) {
              const diff = delta.post - delta.pre;
              if (diff < 0n) {
                from = owner;
                amount = -diff;
              } else if (diff > 0n) {
                to = owner;
              }
            }
            if (from && to && amount > 0n) {
              txs.push({
                from,
                to,
                amount: amount.toString(),
                block: s.slot,
                tx: s.signature,
              });
            }
          } catch {
            /* skip unparseable tx */
          }
        }
        setTransfers(txs.reverse());

        // 3. Get current holders
        const seenWallets = new Set<string>();
        for (const t of txs) {
          seenWallets.add(t.from);
          seenWallets.add(t.to);
        }
        // Also include currently registered wallets
        for (const [w] of kycMap) seenWallets.add(w);

        const holderList: Holder[] = [];
        let supply = 0n;
        for (const wallet of seenWallets) {
          try {
            const owner = new PublicKey(wallet);
            const ata = getAssociatedTokenAddressSync(
              mint,
              owner,
              false,
              TOKEN_2022_PROGRAM_ID
            );
            const acct = await getAccount(
              connection,
              ata,
              "confirmed",
              TOKEN_2022_PROGRAM_ID
            );
            if (acct.amount > 0n) {
              const k = kycMap.get(wallet);
              holderList.push({
                address: wallet,
                balance: acct.amount,
                pct: 0,
                kyc: k?.kyc ?? false,
                jurisdiction: k?.jurisdiction ?? "—",
              });
              supply += acct.amount;
            }
          } catch {
            /* no ATA */
          }
        }
        for (const h of holderList) {
          h.pct = supply > 0n ? Number((h.balance * 10000n) / supply) / 100 : 0;
        }
        holderList.sort((a, b) => Number(b.balance - a.balance));
        setHolders(holderList);
        setTotalSupply(supply);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    })();
  }, [programs, selected, connection]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Regulator Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">
            Read-only oversight · no wallet required · live from on-chain state
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-sm disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Stat label="Loans on Ledger" value={loans.length.toString()} />
        <Stat label="KYC-Verified Wallets" value={totalKyc.toString()} />
        <Stat
          label="Total Supply (this loan)"
          value={totalSupply.toLocaleString()}
        />
      </div>

      <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
        <h2 className="font-semibold mb-3">Select Loan</h2>
        {loans.length === 0 ? (
          <p className="text-slate-400 text-sm">No loans on ledger yet.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-2">
            {loans.map((l) => (
              <button
                key={l.publicKey.toBase58()}
                onClick={() => setSelected(l)}
                className={`text-left p-3 rounded border ${
                  selected?.publicKey.equals(l.publicKey)
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-white/10 hover:bg-white/5"
                }`}
              >
                <div className="font-medium text-sm">{l.account.borrowerName}</div>
                <div className="text-xs text-slate-400">{l.account.loanId}</div>
                <div className="text-xs text-slate-500 mt-1">
                  ${(l.account.principal.toNumber() / 1_000_000).toFixed(2)}M ·{" "}
                  {(l.account.interestRateBps / 100).toFixed(2)}%
                  {l.account.paused && " · PAUSED"}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <>
          <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
            <h2 className="font-semibold mb-3">Ownership Concentration</h2>
            {holders.length === 0 ? (
              <p className="text-slate-400 text-sm">
                No holders yet — mint tokens first.
              </p>
            ) : (
              <div className="space-y-2">
                {holders.map((h) => (
                  <div
                    key={h.address}
                    className="border-b border-white/5 pb-2 last:border-0"
                  >
                    <div className="flex justify-between items-center text-sm mb-1">
                      <span className="font-mono text-xs text-slate-300">
                        {h.address.slice(0, 6)}...{h.address.slice(-6)}
                      </span>
                      <span className="font-semibold">
                        {h.balance.toString()} tokens
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span
                        className={
                          h.kyc ? "text-emerald-400" : "text-red-400"
                        }
                      >
                        {h.kyc ? "KYC ✓" : "Not KYC"} · {h.jurisdiction}
                      </span>
                      <span className="text-slate-400">
                        {h.pct.toFixed(2)}% of supply
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 bg-white/5 rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${Math.min(h.pct, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
            <h2 className="font-semibold mb-3">
              Transfer Audit Trail ({transfers.length})
            </h2>
            {transfers.length === 0 ? (
              <p className="text-slate-400 text-sm">No transfers recorded yet.</p>
            ) : (
              <div className="space-y-2 text-xs font-mono">
                {transfers.map((t, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center border-b border-white/5 pb-2 last:border-0 gap-2"
                  >
                    <span className="text-slate-400 shrink-0">
                      slot {t.block}
                    </span>
                    <span className="text-slate-300 truncate">
                      {t.from.slice(0, 6)}... → {t.to.slice(0, 6)}...
                    </span>
                    <span className="text-emerald-400 shrink-0">
                      {Number(t.amount).toLocaleString()} tokens
                    </span>
                    <a
                      href={`https://explorer.solana.com/tx/${t.tx}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:underline shrink-0"
                    >
                      explorer ↗
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
            <h2 className="font-semibold mb-3">On-Chain References</h2>
            <div className="space-y-2 text-xs font-mono">
              <RefRow
                label="Program: trustledger"
                value="E6iVUfnGNReT7RpueSs94yCX5S2Ua1mdh3FefD6HXZam"
              />
              <RefRow
                label="Program: identity_registry"
                value="36TAGDektyqi6FcmhD4TZLWFh4UKyCsLwvuVo4yDNn6r"
              />
              <RefRow
                label="Program: transfer_hook"
                value="6AfFptyoquTBmzWFCPm783az9PDWz7gmBNcGV9hTG7bG"
              />
              <RefRow label="Loan PDA" value={selected.publicKey.toBase58()} />
              <RefRow label="Mint" value={selected.account.mint.toBase58()} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
      <div className="text-slate-400 text-xs uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function RefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-white/5 pb-2 last:border-0">
      <span className="text-slate-400">{label}</span>
      <a
        href={`https://explorer.solana.com/address/${value}?cluster=devnet`}
        target="_blank"
        rel="noreferrer"
        className="text-blue-400 hover:underline truncate ml-2"
      >
        {value.slice(0, 8)}...{value.slice(-8)}
      </a>
    </div>
  );
}