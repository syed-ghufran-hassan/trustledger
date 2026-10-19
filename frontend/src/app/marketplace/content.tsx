"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  AccountMeta,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  getTransferHook,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { usePrograms, PROGRAM_IDS } from "@/lib/program";
import { getIdentityPda } from "@/lib/pda";

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

type KycStatus = "unknown" | "verified" | "not-verified" | "sanctioned";

/**
 * Fully manual Token-2022 TransferChecked-with-hook instruction builder.
 *
 * We avoid `createTransferCheckedWithTransferHookInstruction` and
 * `resolveExtraAccountMeta` because they depend on Buffer methods
 * (`writeBigUInt64LE`, `Uint8Array.set` with Buffer) that are broken
 * by Turbopack's minimal Buffer polyfill.
 *
 * We already know exactly which extra accounts the hook needs from
 * `initialize_extra_account_meta_list`:
 *   [0] identity_registry program
 *   [1] sender identity PDA  (["identity", source.owner] under registry)
 *   [2] recipient identity PDA (["identity", dest.owner] under registry)
 */
function buildTransferCheckedWithHookIx(params: {
  source: PublicKey;
  sourceOwner: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  destinationOwner: PublicKey;
  authority: PublicKey;
  amount: bigint;
  decimals: number;
  hookProgramId: PublicKey;
  identityRegistryProgram: PublicKey;
}): TransactionInstruction {
  const {
    source,
    sourceOwner,
    mint,
    destination,
    destinationOwner,
    authority,
    amount,
    decimals,
    hookProgramId,
    identityRegistryProgram,
  } = params;

  // ---- Instruction data: TransferChecked = [12, amount(u64 LE), decimals(u8)] ----
  const data = new Uint8Array(10);
  data[0] = 12;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setBigUint64(1, amount, true); // little-endian
  data[9] = decimals;

  // ---- Extra account metas ----
  const [extraMetaListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    hookProgramId
  );
  const [senderIdentityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity"), sourceOwner.toBuffer()],
    identityRegistryProgram
  );
  const [recipientIdentityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity"), destinationOwner.toBuffer()],
    identityRegistryProgram
  );

  // ---- Account order for Token-2022 transfer with hook ----
  // [0] source
  // [1] mint
  // [2] destination
  // [3] authority
  // [4] hook program
  // [5] instructions sysvar
  // [6] extra-account-metas PDA
  // [7...] resolved extra metas (same order as in ExtraAccountMetaList)
  const keys: AccountMeta[] = [
    { pubkey: source, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: hookProgramId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: extraMetaListPda, isSigner: false, isWritable: false },
    { pubkey: identityRegistryProgram, isSigner: false, isWritable: false },
    { pubkey: senderIdentityPda, isSigner: false, isWritable: false },
    { pubkey: recipientIdentityPda, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys,
    data: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
  });
}

export default function MarketplacePage() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const programs = usePrograms();

  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [selected, setSelected] = useState<LoanRow | null>(null);
  const [myBalance, setMyBalance] = useState<bigint>(0n);
  const [recipient, setRecipient] = useState("");
  const [recipientKyc, setRecipientKyc] = useState<KycStatus>("unknown");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [revert, setRevert] = useState<string | null>(null);

  const refreshLoans = useCallback(async () => {
    if (!programs) return;
    try {
      // @ts-ignore
      const all = await programs.trustledger.account.loanAccount.all();
      setLoans(all);
      setSelected((prev) => {
        if (!prev) return all[0] ?? null;
        const found = all.find((l: any) => l.publicKey.equals(prev.publicKey));
        return found ?? all[0] ?? null;
      });
    } catch (e) {
      console.error(e);
    }
  }, [programs]);

  useEffect(() => {
    refreshLoans();
  }, [refreshLoans]);

  useEffect(() => {
    (async () => {
      if (!selected || !publicKey) {
        setMyBalance(0n);
        return;
      }
      try {
        const ata = getAssociatedTokenAddressSync(
          selected.account.mint,
          publicKey,
          false,
          TOKEN_2022_PROGRAM_ID
        );
        const acct = await getAccount(
          connection,
          ata,
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );
        setMyBalance(acct.amount);
      } catch {
        setMyBalance(0n);
      }
    })();
  }, [selected, publicKey, connection]);

  const checkRecipientKyc = useCallback(
    async (addr: string) => {
      if (!programs || !addr) {
        setRecipientKyc("unknown");
        return;
      }
      try {
        const target = new PublicKey(addr);
        const [identityPda] = getIdentityPda(target);
        // @ts-ignore
        const id = await programs.registry.account.identity.fetch(identityPda);
        if (id.sanctioned) setRecipientKyc("sanctioned");
        else if (id.kycVerified) setRecipientKyc("verified");
        else setRecipientKyc("not-verified");
      } catch {
        setRecipientKyc("not-verified");
      }
    },
    [programs]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      checkRecipientKyc(recipient);
    }, 400);
    return () => clearTimeout(t);
  }, [recipient, checkRecipientKyc]);

  async function signAndSend(tx: Transaction): Promise<string> {
    if (!publicKey || !signTransaction) throw new Error("Wallet not ready");
    const bh = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    tx.feePayer = publicKey;
    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      },
      "confirmed"
    );
    return sig;
  }

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
    await signAndSend(new Transaction().add(ix));
    return ata;
  }

  async function doTransfer() {
    if (!selected || !publicKey || !signTransaction) return;
    setErr(null);
    setOk(null);
    setRevert(null);
    setBusy("transferring");
    try {
      let recipientPubkey: PublicKey;
      try {
        recipientPubkey = new PublicKey(recipient);
      } catch {
        throw new Error("Invalid recipient address");
      }

      const mint = selected.account.mint;
      const myAta = getAssociatedTokenAddressSync(
        mint,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const recipientAta = await ensureAta(mint, recipientPubkey);

      // Get mint decimals and confirm hook is present
      let decimals = 0;
      let hookProgramId: PublicKey | null = null;
      try {
        const mintInfo = await getMint(
          connection,
          mint,
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );
        decimals = mintInfo.decimals;
        const hookExt = getTransferHook(mintInfo);
        if (hookExt?.programId) hookProgramId = hookExt.programId;
      } catch (e) {
        console.warn("Could not read mint info:", e);
      }

      if (!hookProgramId) {
        throw new Error(
          "This mint has no transfer hook configured — check that create_loan added the TransferHook extension."
        );
      }

      // Build instruction manually (no SPL helpers, no broken Buffer methods)
      const ix = buildTransferCheckedWithHookIx({
        source: myAta,
        sourceOwner: publicKey,
        mint,
        destination: recipientAta,
        destinationOwner: recipientPubkey,
        authority: publicKey,
        amount: BigInt(amount.toString()),
        decimals,
        hookProgramId,
        identityRegistryProgram: PROGRAM_IDS.identityRegistry,
      });

      const tx = new Transaction().add(ix);

      try {
        await signAndSend(tx);
        setOk(`Transferred ${amount} tokens to ${recipient.slice(0, 8)}...`);
        setRevert(null);
      } catch (e: any) {
        console.error("TRANSFER ERROR:", e);
        const logs = e?.transactionLogs || e?.logs || [];
        const logText = logs.length > 0 ? logs.join("\n") : "";
        const errText =
          logText ||
          e?.message ||
          e?.error?.message ||
          JSON.stringify(e) ||
          String(e);

        const isComplianceBlock =
          errText.includes("RecipientNotVerified") ||
          errText.includes("Recipient is not KYC-verified") ||
          errText.includes("SenderNotVerified") ||
          errText.includes("Sanctioned") ||
          errText.includes("0x1773") ||
          errText.includes("0x1772");

        if (isComplianceBlock) {
          setRevert(errText);
          throw new Error("Transfer blocked by compliance hook (EXPECTED)");
        } else {
          throw new Error(`Transfer failed: ${errText.slice(0, 400)}`);
        }
      }

      try {
        const acct = await getAccount(
          connection,
          myAta,
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );
        setMyBalance(acct.amount);
      } catch {
        setMyBalance(0n);
      }
    } catch (e: any) {
      setErr(e?.message?.slice(0, 600) || String(e));
    } finally {
      setBusy(null);
    }
  }

  const kycBadge =
    recipientKyc === "verified"
      ? { text: "KYC ✓", color: "text-emerald-400 border-emerald-500/30 bg-emerald-900/20" }
      : recipientKyc === "sanctioned"
      ? { text: "SANCTIONED ⚠️", color: "text-red-400 border-red-500/30 bg-red-900/20" }
      : recipientKyc === "not-verified"
      ? { text: "NOT KYC ✗", color: "text-red-400 border-red-500/30 bg-red-900/20" }
      : { text: "—", color: "text-slate-400 border-white/10 bg-slate-900/50" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Marketplace</h1>
        <button
          onClick={refreshLoans}
          className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-sm"
        >
          Refresh
        </button>
      </div>

      {!publicKey && (
        <div className="rounded-lg bg-yellow-900/30 border border-yellow-500/30 p-4 text-sm text-yellow-200">
          Connect a wallet to trade.
        </div>
      )}

      {publicKey && !connected && (
        <div className="rounded-lg bg-red-900/30 border border-red-500/30 p-4 text-sm text-red-300">
          ⚠️ Wallet disconnected at adapter level. Click your wallet button in the navbar
          → <strong>Disconnect</strong> → reconnect to Solflare.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
          <h2 className="font-semibold mb-3">Available Loans ({loans.length})</h2>
          {loans.length === 0 ? (
            <p className="text-slate-400 text-sm">
              No loans yet. Create one on the Originator page.
            </p>
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
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
            <h2 className="font-semibold mb-3">My Position</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-slate-400">Holding</span>
                <span className="font-semibold">{myBalance.toString()} tokens</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-slate-400">Loan</span>
                <span>{selected.account.borrowerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Mint</span>
                <span className="font-mono text-xs">
                  {selected.account.mint.toBase58().slice(0, 10)}...
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="rounded-xl bg-slate-900 border border-white/10 p-5">
          <h2 className="font-semibold mb-4">Transfer Tokens</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                Recipient Wallet
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Paste any Solana pubkey"
                className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm"
              />
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500">Recipient KYC:</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded border ${kycBadge.color}`}
                >
                  {kycBadge.text}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                Amount (tokens)
              </label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm"
              />
            </div>
          </div>

          <button
            onClick={doTransfer}
            disabled={
              !publicKey ||
              !connected ||
              !signTransaction ||
              !recipient ||
              busy !== null ||
              myBalance === 0n
            }
            className="mt-4 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-medium"
          >
            {busy === "transferring" ? "Transferring..." : "Transfer Tokens"}
          </button>

          {myBalance === 0n && (
            <p className="text-xs text-slate-500 mt-2">
              You have no tokens of this loan. Mint some to yourself from the Originator
              page first.
            </p>
          )}
        </div>
      )}

      {revert && (
        <div className="rounded-lg bg-red-900/30 border border-red-500/30 p-4 text-sm text-red-300">
          <div className="font-semibold mb-2">
            ⛔ Transfer blocked on-chain by the Transfer Hook
          </div>
          <pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
            {revert}
          </pre>
          <div className="mt-3 text-xs text-slate-400">
            This is the exact on-chain revert — the token itself refused to move to a
            non-compliant wallet. To unblock: go to <strong>Portfolio</strong> → register
            this wallet → return here and retry.
          </div>
        </div>
      )}

      {err && !revert && (
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