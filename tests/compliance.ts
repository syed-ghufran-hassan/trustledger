import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TrustledgerSolana } from "../target/types/trustledger_solana";
import { IdentityRegistry } from "../target/types/identity_registry";
import { TransferHook } from "../target/types/transfer_hook";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createTransferCheckedWithTransferHookInstruction,
  getAccount,
} from "@solana/spl-token";

describe("compliance", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.TrustledgerSolana as Program<TrustledgerSolana>;
  const registry = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const hook = anchor.workspace.TransferHook as Program<TransferHook>;

  it("blocks non-KYC transfer, allows after KYC", async () => {
    const originator = provider.wallet;
    const buyer = Keypair.generate();
    const mintKp = Keypair.generate();
    const loanId = "LOAN-COMP-" + Date.now();

    const [loanPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("loan"), Buffer.from(loanId)], program.programId);
    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")], registry.programId);
    const [originatorIdPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("identity"), originator.publicKey.toBuffer()], registry.programId);
    const [buyerIdPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("identity"), buyer.publicKey.toBuffer()], registry.programId);
    const [extraMetaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mintKp.publicKey.toBuffer()], hook.programId);

    let registryExists = false;
    try { await registry.account.registry.fetch(registryPda); registryExists = true; } catch {}
    if (!registryExists) {
      await registry.methods.initializeRegistry(originator.publicKey)
        .accounts({ registry: registryPda, authority: originator.publicKey }).rpc();
    }

    try { await registry.account.identity.fetch(originatorIdPda); }
    catch {
      await registry.methods.registerIdentity("PK", true)
        .accounts({
          registry: registryPda, identity: originatorIdPda,
          wallet: originator.publicKey, authority: originator.publicKey,
        }).rpc();
    }

    await program.methods
      .createLoan(loanId, "Compliance Borrower", new anchor.BN(1_000_000), 750, new anchor.BN(2_000_000_000))
      .accounts({
        originator: originator.publicKey, loanAccount: loanPda, mint: mintKp.publicKey,
        transferHookProgram: hook.programId, tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).signers([mintKp]).rpc();

    await hook.methods.initializeExtraAccountMetaList()
      .accounts({
        payer: originator.publicKey, mint: mintKp.publicKey,
        identityRegistryProgram: registry.programId,
        extraAccountMetaList: extraMetaPda, systemProgram: SystemProgram.programId,
      }).rpc();

          console.log("=== PDA DEBUG ===");
    console.log("   Originator wallet:", originator.publicKey.toBase58());
    console.log("   Buyer wallet     :", buyer.publicKey.toBase58());
    console.log("   Expected sender PDA :", originatorIdPda.toBase58());
    console.log("   Expected recipient PDA:", buyerIdPda.toBase58());
    console.log("   Registry program     :", registry.programId.toBase58());
    console.log("=================");

    const originatorAta = getAssociatedTokenAddressSync(mintKp.publicKey, originator.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const buyerAta = getAssociatedTokenAddressSync(mintKp.publicKey, buyer.publicKey, false, TOKEN_2022_PROGRAM_ID);
    await provider.sendAndConfirm(new Transaction().add(
      createAssociatedTokenAccountInstruction(originator.publicKey, originatorAta, originator.publicKey, mintKp.publicKey, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(originator.publicKey, buyerAta, buyer.publicKey, mintKp.publicKey, TOKEN_2022_PROGRAM_ID),
    ));

       const mintSig = await program.methods.mintLoanTokens(new anchor.BN(1000))
      .accounts({
        originator: originator.publicKey, loanAccount: loanPda, mint: mintKp.publicKey,
        destination: originatorAta, tokenProgram: TOKEN_2022_PROGRAM_ID,
      }).rpc();

    // Confirm explicitly at "finalized" so the node definitely indexes token state
    const bh = await provider.connection.getLatestBlockhash("finalized");
    await provider.connection.confirmTransaction(
      { signature: mintSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
      "finalized"
    );

    // Poll until the ATA reflects the minted amount (handles indexer lag)
    let mintedAmount = 0n;
    for (let i = 0; i < 25; i++) {
      try {
        const acc = await getAccount(provider.connection, originatorAta, "confirmed", TOKEN_2022_PROGRAM_ID);
        mintedAmount = acc.amount;
        if (mintedAmount === 1000n) break;
      } catch { /* ATA may not be indexed yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(mintedAmount, 1000n, "Mint did not reflect in originator ATA");
    console.log("   ✓ Minted 1000 tokens to originator");

        // === FIRST TRANSFER — buyer has NO KYC → must revert ===
    const blockedTx = new Transaction().add(
      await createTransferCheckedWithTransferHookInstruction(
        provider.connection, originatorAta, mintKp.publicKey, buyerAta,
        originator.publicKey, 100n, 0, [], "confirmed", TOKEN_2022_PROGRAM_ID
      )
    );

    let reverted = false;
    let errMsg = "";
    try {
      // sendAndConfirm does preflight simulation — throws on hook revert
      await provider.sendAndConfirm(blockedTx, [], { commitment: "confirmed" });
      console.log("   ⚠ WARNING: Transfer to non-KYC wallet was NOT blocked!");
    } catch (e: any) {
      reverted = true;
      const logs = (e?.transactionLogs || []).join(" | ");
      errMsg = logs || e?.message || String(e);
    }
    assert.isTrue(reverted, "Transfer to non-KYC wallet MUST revert");
    console.log("   ✓ Blocked transfer to non-KYC wallet");
    console.log("     Reason contains 'Recipient is not KYC-verified':",
      errMsg.includes("Recipient is not KYC-verified"));
    console.log("     Error excerpt:", errMsg.slice(0, 250));

    // === Register buyer KYC ===
    await registry.methods.registerIdentity("PK", true)
      .accounts({
        registry: registryPda, identity: buyerIdPda,
        wallet: buyer.publicKey, authority: originator.publicKey,
      }).rpc();
    console.log("   ✓ Registered buyer KYC");

        // === SECOND TRANSFER — buyer now KYC-verified → must succeed ===
    const okIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection, originatorAta, mintKp.publicKey, buyerAta,
      originator.publicKey, 100n, 0, [], "confirmed", TOKEN_2022_PROGRAM_ID
    );
    const okTx = new Transaction().add(okIx);

    // Fetch blockhash AFTER building the tx — build does multiple RPC calls
    const freshBh = await provider.connection.getLatestBlockhash("confirmed");
    okTx.recentBlockhash = freshBh.blockhash;
    okTx.feePayer = originator.publicKey;

    const signed = await provider.wallet.signTransaction(okTx);
    const sig = await provider.connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await provider.connection.confirmTransaction(
      { signature: sig, blockhash: freshBh.blockhash, lastValidBlockHeight: freshBh.lastValidBlockHeight },
      "confirmed"
    );

    // Poll for buyer balance (indexer lag)
    let buyerAmount = 0n;
    for (let i = 0; i < 25; i++) {
      try {
        const acc = await getAccount(provider.connection, buyerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
        buyerAmount = acc.amount;
        if (buyerAmount === 100n) break;
      } catch { /* not indexed yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(buyerAmount, 100n, "Buyer did not receive tokens");
    console.log("   ✓ Transfer succeeded after KYC registration");
  });
});