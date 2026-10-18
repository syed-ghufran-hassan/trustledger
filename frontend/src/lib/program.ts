import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import { PublicKey } from "@solana/web3.js";

import IDL_TRUSTLEDGER from "./idl/trustledger_solana.json";
import IDL_REGISTRY from "./idl/identity_registry.json";
import IDL_HOOK from "./idl/transfer_hook.json";

export const PROGRAM_IDS = {
  trustledger: new PublicKey("E6iVUfnGNReT7RpueSs94yCX5S2Ua1mdh3FefD6HXZam"),
  identityRegistry: new PublicKey("36TAGDektyqi6FcmhD4TZLWFh4UKyCsLwvuVo4yDNn6r"),
  transferHook: new PublicKey("6AfFptyoquTBmzWFCPm783az9PDWz7gmBNcGV9hTG7bG"),
};

export function usePrograms() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    return {
      trustledger: new Program(IDL_TRUSTLEDGER as Idl, provider),
      registry: new Program(IDL_REGISTRY as Idl, provider),
      hook: new Program(IDL_HOOK as Idl, provider),
      provider,
    };
  }, [connection, wallet]);
}
