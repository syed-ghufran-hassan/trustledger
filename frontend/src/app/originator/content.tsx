"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { usePrograms, PROGRAM_IDS } from "@/lib/program";
import {
  getLoanPda,
  getIdentityPda,
  getRegistryPda,
  getExtraAccountMetaPda,
} from "@/lib/pda";

type LoanRow = {
  publicKey: PublicKey;
  account: {
    originator: PublicKey;
    mint: PublicKey;
    loanId: string;
    borrowerName: string;
    principal: BN;
    interestRateBps: number;
    maturity: BN;
    paused: boolean;
    bump: number;
  };
};

export default function OriginatorPage() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const programs = usePrograms();

  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [selected, setSelected] = useState<LoanRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  const [borrowerName, setBorrowerName] = useState("Acme Manufacturing Ltd");
  const [principal, setPrincipal] = useState("10000000");
  const [rateBps, setRateBps] = useState("750");
  const [maturityYears, setMaturityYears] = useState("2");

  const [recipientWallet, setRecipientWallet] = useState("");
  const [mintAmount, setMintAmount] = useState("1000");

  const refreshLoans = useCallback(async () => {
    if (!programs) return;
    try {
      // @ts-ignore
      const all = (await programs.trustledger.account.loanAccount.all()) as LoanRow[];
      setLoans(all);
      setSelected((prev) => {
        if (!prev) return all[0] ?? null;
        const found = all.find((l) => l.publicKey.equals(prev.publicKey));
        return found ?? all[0] ?? null;
      });
    } catch (e: any) {
      console.error("refreshLoans error:", e);
    }
  }, [programs]);

  const bootstrap = useCallback(async () => {
    if (!programs || !publicKey) return;
    setBusy("bootstrapping");
    try {
      const [registryPda] = getRegistryPda();
      const [identityPda] = getIdentityPda(publicKey);

      let registryExists = false;
      try {
        // @ts-ignore
        await programs.registry.account.registry.fetch(registryPda);
        registryExists = true;
      } catch {
        registryExists = false;
      }

      if (!registryExists) {
        // @ts-ignore
        await programs.registry.methods
          .initializeRegistry(publicKey)
          .accounts({ registry: registryPda, authority: publicKey })
          .rpc();
      }

      let identityExists = false;
      try {
        // @ts-ignore
        await programs.registry.account.identity.fetch(identityPda);
        identityExists = true;
      } catch {
        identityExists = false;
      }

      if (!identityExists) {
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
      }

      setBootstrapped(true);
      await refreshLoans();
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("Unauthorized") || msg.includes("0x1770")) {
        setErr(
          "Registry already exists with a different trusted issuer. Import that wallet into Phantom, or reset the local chain: `solana-test-validator --reset` then `anchor deploy --no-idl`."
        );
      } else {
        setErr(`Bootstrap failed: ${msg.slice(0, 200)}`);
      }
    } finally {
      setBusy(null);
    }
  }, [programs, publicKey, refreshLoans]);

  useEffect(() => {
    if (programs && publicKey && !bootstrapped) {
      bootstrap();
    }
  }, [programs, publicKey, bootstrapped, bootstrap]);

  async function ensureAta(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
    const info = await connection.getAccountInfo(ata);
    if (info) return ata;
    const ix = createAssociatedTokenAccountInstruction(
      publicKey!,
      ata,
      owner,
      mint,
      TOKEN_2022_PROGRAM_ID
    );
    const tx = new Transaction().add(ix);
    const sig = await sendTransaction(tx, connection);
    await connection.confirmTransaction(sig, "confirmed");
    return ata;
  }

  async function createLoan() {
    if (!programs || !publicKey) return;
    setErr(null);
    setOk(null);
    setBusy("creating-loan");
    try {
      const loanId = `LOAN-${Date.now()}`;
      const [loanPda] = getLoanPda(loanId);
      const mintKp = Keypair.generate();
      const maturity =
        Math.floor(Date.now() / 1000) + Number(maturityYears) * 365 * 24 * 3600;

      // @ts-ignore
      await programs.trustledger.methods
        .createLoan(
          loanId,
          borrowerName,
          new BN(principal),
          Number(rateBps),
          new BN(maturity)
        )
        .accounts({
          originator: publicKey,
          loanAccount: loanPda,
          mint: mintKp.publicKey,
          transferHookProgram: PROGRAM_IDS.transferHook,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([mintKp])
        .rpc();

      const [extraMetaPda] = getExtraAccountMetaPda(mintKp.publicKey);
      // @ts-ignore
      await programs.hook.methods
        .initializeExtraAccountMetaList()
        .accounts({
          payer: publicKey,
          mint: mintKp.publicKey,
          identityRegistryProgram: PROGRAM_IDS.identityRegistry,
          extraAccountMetaList: extraMetaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setOk(
        `Created loan ${loanId} · mint ${mintKp.publicKey.toBase58().slice(0, 8)}...`
      );
      await refreshLoans();
    } catch (e: any) {
      setErr(e?.message?.slice(0, 400) || String(e));
    } finally {
      setBusy(null);
    }
  }

  async function mintTokens() {
    if (!programs || !publicKey || !selected) return;
    setErr(null);
    setOk(null);
    setBusy("minting");
    try {
      let recipient: PublicKey;
      try {
        recipient = new PublicKey(recipientWallet);
      } catch {
        throw new Error("Invalid recipient wallet address");
      }

      const mint = selected.account.mint;
      const recipientAta = await ensureAta(mint, recipient);

      // @ts-ignore
      await programs.trustledger.methods
        .mintLoanTokens(new BN(mintAmount))
        .accounts({
          originator: publicKey,
          loanAccount: selected.publicKey,
          mint,
          destination: recipientAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      setOk(`Minted ${mintAmount} tokens to ${recipientWallet.slice(0, 8)}...`);
    } catch (e: any) {
      setErr(e?.message?.slice(0, 400) || String(e));
    } finally {
      setBusy(null);
    }
  }

  const isConnected = !!publicKey;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Originator Dashboard</h1>
        <button
          onClick={refreshLoans}
          className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-sm"
        >
          Refresh
        </button>
      </div>

      {!isConnected && (
        <div className="rounded-lg bg-yellow-900/30 border border-yellow-500/30 p-4 text-sm text-yellow-200">
          Connect a wallet to continue. If you ran <code>anchor test</code>, the registry
          may already exist with the deployer wallet as trusted issuer — import{" "}
          <code>~/.config/solana/id.json</code> into Phantom, or reset the local chain.
        </div>
      )}

      {busy === "bootstrapping" && (
        <div className="rounded-lg bg-blue-900/30 border border-blue-500/30 p-4 text-sm text-blue-200">
          Bootstrapping — initializing registry and registering your wallet as
          KYC-verified...
        </div>
      )}

      <section className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
          <h2 className="font-semibold mb-3">Loans ({loans.length})</h2>
          {loans.length === 0 ? (
            <p className="text-slate-400 text-sm">No loans yet. Create one below.</p>
          ) : (
            <div className="space-y-2">
              {loans.map((l) => (
                <button
                  key={l.publicKey.toBase58()}
                  onClick={() => setSelected(l)}
                  className={`w-full text-left p-3 rounded border ${
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
          <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
            <h2 className="font-semibold mb-3">Loan Details</h2>
            <dl className="space-y-2 text-sm">
              <Row k="Borrower" v={selected.account.borrowerName} />
              <Row k="Loan ID" v={selected.account.loanId} />
              <Row
                k="Principal"
                v={`$${(selected.account.principal.toNumber() / 1_000_000).toFixed(2)}M`}
              />
              <Row
                k="Interest Rate"
                v={`${(selected.account.interestRateBps / 100).toFixed(2)}%`}
              />
              <Row
                k="Maturity"
                v={new Date(
                  selected.account.maturity.toNumber() * 1000
                ).toLocaleDateString()}
              />
              <Row k="Paused" v={selected.account.paused ? "Yes" : "No"} />
              <Row k="Mint" v={`${selected.account.mint.toBase58().slice(0, 10)}...`} />
              <Row
                k="Loan PDA"
                v={`${selected.publicKey.toBase58().slice(0, 10)}...`}
              />
            </dl>
          </div>
        )}
      </section>

      <section className="rounded-xl bg-slate-900 border border-white/10 p-5">
        <h2 className="font-semibold mb-4">Create New Loan</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Input label="Borrower Name" value={borrowerName} onChange={setBorrowerName} />
          <Input label="Principal (USD)" value={principal} onChange={setPrincipal} />
          <Input
            label="Interest Rate (bps, 750 = 7.50%)"
            value={rateBps}
            onChange={setRateBps}
          />
          <Input label="Maturity (years)" value={maturityYears} onChange={setMaturityYears} />
        </div>
        <button
          onClick={createLoan}
          disabled={!isConnected || busy !== null}
          className="mt-4 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-medium"
        >
          {busy === "creating-loan" ? "Creating..." : "Create Loan"}
        </button>
      </section>

      {selected && (
        <section className="rounded-xl bg-slate-900 border border-white/10 p-5">
          <h2 className="font-semibold mb-4">Mint Tokens</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="Recipient Wallet (use a second wallet for demo)"
              value={recipientWallet}
              onChange={setRecipientWallet}
            />
            <Input label="Amount (tokens)" value={mintAmount} onChange={setMintAmount} />
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setRecipientWallet(publicKey?.toBase58() ?? "")}
              className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10"
            >
              Use my wallet
            </button>
          </div>
          <button
            onClick={mintTokens}
            disabled={!isConnected || !recipientWallet || busy !== null}
            className="mt-4 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium"
          >
            {busy === "minting" ? "Minting..." : "Mint Tokens"}
          </button>
          <p className="text-xs text-slate-500 mt-3">
            Recipient must already be KYC-registered, or the mint will fail on-chain.
            Register them via the Portfolio page (Milestone 7).
          </p>
        </section>
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
    <div className="flex justify-between border-b border-white/5 pb-2">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-slate-100 font-mono text-xs">{v}</dd>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm"
      />
    </div>
  );
}