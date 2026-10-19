# TrustLedger

> Tokenized commercial loan participations with compliance enforced by the token itself — on Solana.

**Team:** SoloNode Labs  
**Status:** On-chain MVP deployed to Devnet · 3/3 tests passing · Full UI working  
**Stack:** Solana · Token-2022 · Anchor 0.32 · Next.js 14

> 🔗 **Live on Devnet:**
> - [trustledger_solana](https://explorer.solana.com/address/E6iVUfnGNReT7RpueSs94yCX5S2Ua1mdh3FefD6HXZam?cluster=devnet) — `E6iVUfnGNReT7RpueSs94yCX5S2Ua1mdh3FefD6HXZam`
> - [identity_registry](https://explorer.solana.com/address/36TAGDektyqi6FcmhD4TZLWFh4UKyCsLwvuVo4yDNn6r?cluster=devnet) — `36TAGDektyqi6FcmhD4TZLWFh4UKyCsLwvuVo4yDNn6r`
> - [transfer_hook](https://explorer.solana.com/address/6AfFptyoquTBmzWFCPm783az9PDWz7gmBNcGV9hTG7bG?cluster=devnet) — `6AfFptyoquTBmzWFCPm783az9PDWz7gmBNcGV9hTG7bG`

---

## 📌 The Problem

Banks hold trillions in illiquid commercial loans. Selling a participation today means:

- **Manual documentation** — weeks of legal paperwork per transfer
- **T+2 to T+5 settlement** — capital locked for days
- **Opaque ownership** — no shared source of truth between banks
- **Limited secondary market** — no easy way to sell, pledge, or price
- **Post-hoc compliance** — KYC/AML checks happen *before* a trade, never *during* it

BIS and DTCC both warn that tokenization does not solve these problems unless **compliance is enforced at the asset layer** — not bolted onto the application.

---

## 💡 The Solution

TrustLedger tokenizes loan participations as **Token-2022 mints with Transfer Hooks**, on Solana.

Every transfer of a loan token fires a custom hook program that:

1. Reads the **sender's Identity PDA** (from the Identity Registry program)
2. Reads the **recipient's Identity PDA**
3. Verifies `kyc_verified = true` and `sanctioned = false` for both
4. If either fails → **the transfer reverts on-chain**

Compliance is no longer a checkbox. It is a **revert message** returned by the token itself, at 400ms finality, for less than $0.001 in fees.

---

## 🎬 The Demo — Compliance as a Revert

All five pages work end-to-end on Devnet:

### 1. **Originator** — Create a tokenized loan

The originator creates a $10M commercial loan to "Acme Manufacturing Ltd" with 7.5% coupon and 2-year maturity. This single transaction:

- Deploys a **Token-2022 mint** with three extensions
- Creates a **LoanAccount PDA** with loan metadata
- Initializes the **TransferHook** extension pointing at our compliance program
- Sets up **PermanentDelegate** (regulator clawback) and **Pausable** (circuit breaker)
- Initializes the **ExtraAccountMetaList** for the transfer hook

### 2. **Marketplace** — Try to transfer to a non-KYC wallet

The originator has 1000 tokens. They attempt to send 100 tokens to a wallet that was never registered. The transaction is **rejected on-chain**:

```
AnchorError thrown in programs/transfer-hook/src/lib.rs
Error Code: RecipientNotVerified
Error Message: Recipient is not KYC-verified
```

This revert is not from the application. It's from the **TransferHook program**, invoked by the Token-2022 program, during a transfer. **The token itself refused to move.**

### 3. **Portfolio** — Register the wallet as KYC

The originator (as trusted issuer) registers the recipient wallet in the Identity Registry. This creates an on-chain Identity PDA with `kyc_verified: true`.

### 4. **Marketplace** — Retry the same transfer

The exact same transfer — same wallets, same amount — now **succeeds**:

```
✓ Transferred 100 tokens to 22Datx...
```

The only difference: the recipient now has a valid Identity PDA. **Compliance enforcement is identical at every step — it's the identity state that changed.**

### 5. **Regulator** — Read-only oversight

A regulator dashboard that needs **no wallet connection**. Live reads from chain:

- Loans on ledger
- KYC-verified wallet count
- Ownership concentration (percentages, KYC status per holder)
- Immutable transfer audit trail with Solana Explorer links
- Program IDs and mint addresses for independent verification

---

## ✅ Proven Working (3/3 tests passing)

```text
compliance
   ✓ Minted 1000 tokens to originator
   ✓ Blocked transfer to non-KYC wallet
     Reason contains 'Recipient is not KYC-verified': true
   ✓ Registered buyer KYC
   ✓ Transfer succeeded after KYC registration
    ✔ blocks non-KYC transfer, allows after KYC

identity_registry
    ✔ registers an identity

loan_creation
   ✓ Loan mint created: <pubkey>
   ✓ Mint owned by Token-2022
    ✔ creates a loan mint with all extensions

3 passing
```

The integration test (`tests/compliance.ts`) runs the **exact same flow** the UI demonstrates, proving compliance is enforced on-chain regardless of how the transaction is initiated.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   TOKEN-2022 LOAN MINT                      │
│  Extensions: TransferHook · PermanentDelegate · Pausable    │
└────────────┬───────────────────────────────┬────────────────┘
             │ every TransferChecked         │ clawback / pause
             ▼                               ▼
   ┌─────────────────────┐         ┌────────────────────┐
   │  TRANSFER_HOOK      │         │  ORIGINATOR        │
   │  execute() reads:   │         │  (multisig in prod)│
   │  - sender identity  │         └────────────────────┘
   │  - recipient ident. │
   │  Reverts if not KYC │
   └─────────┬───────────┘
             │ reads via external PDA seeds
             ▼
   ┌─────────────────────┐
   │ IDENTITY_REGISTRY   │
   │  Identity PDA:      │
   │  {kyc, accredited,  │
   │   sanctioned,       │
   │   jurisdiction}     │
   └─────────────────────┘
```

### Three Solana Programs

| Program | Purpose |
|---|---|
| **`trustledger_solana`** | Creates the loan mint (Token-2022 with 3 extensions), stores `LoanAccount` metadata, mints tokens |
| **`identity_registry`** | Stores KYC-verified Identity PDAs per wallet — jurisdiction, accreditation, sanctions flags |
| **`transfer_hook`** | Fires on every transfer, reads both Identity PDAs, blocks non-compliant transfers |

### Two key technical decisions

**1. External PDA derivation.** The Transfer Hook derives Identity PDAs under the **`identity_registry` program**, not itself. This is done with `ExtraAccountMeta::new_external_pda_with_seeds(5, ...)` — where `5` is the index of the registry program in the execute account list. Using `new_with_seeds` (the more obvious choice) silently derives PDAs under the wrong program, and every transfer sees empty identity accounts — a bug that's nearly impossible to spot from error messages.

**2. Manual Token-2022 instruction builder in the frontend.** The frontend builds the `TransferChecked` instruction manually with `DataView.setBigUint64` rather than using `createTransferCheckedWithTransferHookInstruction`. The SPL helper's internal `Buffer.writeBigUInt64LE` and `resolveExtraAccountMeta` calls are broken by Turbopack's minimal Buffer polyfill in the browser. By manually constructing the instruction with the exact account order Token-2022 expects (`[source, mint, destination, authority, hook program, instructions sysvar, ExtraAccountMetaList PDA, registry program, sender identity, recipient identity]`), the transfer works reliably in the browser.

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Rust | 1.75+ | https://rustup.rs |
| Solana CLI | 3.x | See below |
| Anchor CLI | 0.32.0 | See below |
| Node.js | 18+ | https://nodejs.org |
| Yarn | 1.22+ | `npm i -g yarn` |

```bash
# Full toolchain
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash

# Anchor CLI
cargo install --git https://github.com/solana-foundation/anchor avm --force
avm install 0.32.0
avm use 0.32.0
```

### Install

```bash
git clone <your-repo>
cd trustledger-solana
yarn install
```

### Build and Test the Contracts

```bash
anchor build
anchor test
```

**Expected:** `3 passing` in ~20 seconds on a warm cache.

### Run the Frontend

```bash
cd frontend
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000).

### Connect to Devnet (recommended for demo)

Create `frontend/.env.local`:

```
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
```

Then restart `yarn dev`. Fund your wallet:

```bash
solana airdrop 2 <YOUR_WALLET> --url https://api.devnet.solana.com
```

Or use https://faucet.solana.com/ (Devnet tab).

### Run on Localnet instead

```bash
# Terminal 1 — validator
solana-test-validator --reset

# Terminal 2 — deploy
anchor deploy --no-idl --provider.cluster localnet

# Terminal 3 — fund wallet
solana airdrop 100 <YOUR_WALLET> --url localhost

# frontend
cd frontend && yarn dev
```

Point Phantom/Solflare to Localnet RPC `http://127.0.0.1:8899`.

---

## 📦 Project Structure

```text
trustledger-solana/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── programs/
│   ├── trustledger-solana/   # Loan mint creation + minting
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   ├── identity-registry/    # KYC / sanctions / jurisdiction PDAs
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   └── transfer-hook/        # Compliance enforcement on every transfer
│       ├── Cargo.toml
│       └── src/lib.rs
├── tests/
│   ├── compliance.ts         # ⭐ The money shot
│   ├── identity_registry.ts
│   └── loan_creation.ts
├── frontend/                 # Next.js + Solana wallet adapter
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx          # Landing
│   │   │   ├── originator/       # Create loan, mint tokens
│   │   │   ├── marketplace/      # Transfer + compliance demo
│   │   │   ├── portfolio/        # Holdings, KYC registration
│   │   │   └── regulator/        # Read-only oversight dashboard
│   │   ├── components/
│   │   │   └── Navbar.tsx
│   │   └── lib/
│   │       ├── program.ts        # Anchor client + program IDs
│   │       ├── pda.ts            # PDA derivation helpers
│   │       ├── idl/              # Anchor IDLs (committed)
│   │       └── types/            # TS types (committed)
│   └── package.json
└── README.md
```

---

## 🔐 Compliance Model

| Control | Implementation |
|---|---|
| **KYC** | Identity Registry PDA per wallet, gated by trusted issuer |
| **Sanctions** | `sanctioned: bool` flag on Identity PDA — hook reverts if true |
| **Jurisdiction** | `jurisdiction: String` field — hook can enforce allowlist |
| **Accreditation** | `accredited: bool` — enforced by future transfer limits |
| **Regulator clawback** | `PermanentDelegate` extension — originator can force-transfer |
| **Global circuit breaker** | `Pausable` extension — originator can freeze all transfers |
| **Per-wallet freeze** | `frozen` flag on Identity PDA — hook can check |
| **Audit trail** | Every transfer is a Solana transaction — immutable, timestamped, indexed |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Ledger** | Solana (Devnet deployment) |
| **Token standard** | Token-2022 (SPL Token Extensions) |
| **Compliance** | Token-2022 Transfer Hook program |
| **Identity** | Custom Identity Registry program |
| **Smart contract framework** | Anchor 0.32.0 (Rust) |
| **Frontend** | Next.js 14 + Tailwind + Solana Wallet Adapter |
| **Client SDK** | `@coral-xyz/anchor` 0.31 + `@solana/spl-token` |

---

## 🗺️ Roadmap

### ✅ Shipped (this hackathon)

- [x] Token-2022 mint with TransferHook, PermanentDelegate, Pausable extensions
- [x] Identity Registry with KYC / sanctions / jurisdiction fields
- [x] Transfer hook enforcing KYC at the token level
- [x] End-to-end compliance test (block → register → succeed)
- [x] Loan account metadata stored on-chain
- [x] 5-page Next.js frontend (landing, originator, marketplace, portfolio, regulator)
- [x] Full demo flow working on Devnet
- [x] Read-only regulator dashboard with on-chain audit trail

### 🔮 Post-Hackathon

- [ ] **Solana DvP integration** — atomic loan-token ↔ settlement-token swap
- [ ] **Solana Attestation Service (SAS)** — replace custom registry with re-usable verifiable credentials
- [ ] **Interest distribution** — quarterly coupon payments to all holders
- [ ] **Collateral vault** — pledge loan tokens as collateral, borrow stablecoins
- [ ] **Multi-sig governance** — Squads multisig for upgrade authority
- [ ] **ZK selective disclosure** — prove compliance without revealing identity
- [ ] **Security audit** — pre-mainnet review of transfer hook and identity registry

---

## 🎨 Design Principles

1. **Compliance at the asset layer.** Not in the app, not in the API, not in a PDF. The token itself refuses to move.
2. **Atomicity over speed.** Loan token + payment settle in a single transaction — never partial.
3. **Regulator observability.** Read-only node sees everything, needs nothing.
4. **Minimal trusted surface.** The originator holds `PermanentDelegate` and `Pausable` — but neither can create tokens, move funds, or override KYC.
5. **On-chain provability.** Every claim in the pitch has a corresponding test and a Devnet transaction.

---

## 🧑‍💻 Team

**SoloNode Labs** — solo developer, full-stack + Rust + Solana.

---

## 📜 License

MIT — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **Solana Foundation** — for Token-2022 and the Transfer Hook interface
- **Metaplex** — for MPL-3643 (permissioned asset standard, used as inspiration)
- **Anchor team** — for the `#[interface]` macro and PDA resolution primitives
- **BIS, DTCC, ERC-3643 Association** — for regulatory framing

---

> **"Compliance is not a report. It's a revert."**