import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TrustledgerSolana } from "../target/types/trustledger_solana";
import { TransferHook } from "../target/types/transfer_hook";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

describe("loan_creation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.TrustledgerSolana as Program<TrustledgerSolana>;
  const hook = anchor.workspace.TransferHook as Program<TransferHook>;

  it("creates a loan mint with all extensions", async () => {
    const originator = provider.wallet;
    const mintKp = Keypair.generate();
    const loanId = "LOAN-TEST-" + Date.now();

    const [loanPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("loan"), Buffer.from(loanId)], program.programId);

    await program.methods
      .createLoan(loanId, "Acme Corp", new anchor.BN(10_000_000), 750, new anchor.BN(2_000_000_000))
      .accounts({
        originator: originator.publicKey,
        loanAccount: loanPda,
        mint: mintKp.publicKey,
        transferHookProgram: hook.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).signers([mintKp]).rpc();

    const loanAcc = await program.account.loanAccount.fetch(loanPda);
    assert.equal(loanAcc.borrowerName, "Acme Corp");
    assert.equal(loanAcc.principal.toNumber(), 10_000_000);
    assert.equal(loanAcc.interestRateBps, 750);
    assert.equal(loanAcc.mint.toBase58(), mintKp.publicKey.toBase58());

    const mintAccountInfo = await provider.connection.getAccountInfo(mintKp.publicKey);
    assert.isNotNull(mintAccountInfo, "Mint account was not created");
    assert.equal(mintAccountInfo!.owner.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(),
      "Mint is not owned by Token-2022");

    console.log("   ✓ Loan mint created:", mintKp.publicKey.toBase58());
    console.log("   ✓ Mint owned by Token-2022");
  });
});