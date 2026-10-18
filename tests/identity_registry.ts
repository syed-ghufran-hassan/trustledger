import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IdentityRegistry } from "../target/types/identity_registry";
import { assert } from "chai";

describe("identity_registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;

  it("registers an identity", async () => {
    const issuer = provider.wallet;
    const wallet = anchor.web3.Keypair.generate();

    const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId
    );
    const [identityPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("identity"), wallet.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initializeRegistry(issuer.publicKey)
      .accounts({ registry: registryPda, authority: issuer.publicKey })
      .rpc();

    await program.methods
      .registerIdentity("PK", true)
      .accounts({
        registry: registryPda,
        identity: identityPda,
        wallet: wallet.publicKey,
        authority: issuer.publicKey,
      })
      .rpc();

    const identity = await program.account.identity.fetch(identityPda);
    assert.isTrue(identity.kycVerified);
    assert.equal(identity.jurisdiction, "PK");
    assert.isTrue(identity.accredited);
  });
});
