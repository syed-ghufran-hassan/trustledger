import { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS } from "./program";

export function getLoanPda(loanId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("loan"), Buffer.from(loanId)],
    PROGRAM_IDS.trustledger
  );
}

export function getIdentityPda(wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("identity"), wallet.toBuffer()],
    PROGRAM_IDS.identityRegistry
  );
}

export function getRegistryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    PROGRAM_IDS.identityRegistry
  );
}

export function getExtraAccountMetaPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    PROGRAM_IDS.transferHook
  );
}
