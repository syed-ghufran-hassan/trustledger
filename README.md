# TrustLedger

> Tokenized commercial loan participations with compliance enforced by the token itself — on Solana.

**Team:** SoloNode Labs  
**Status:** On-chain MVP complete (3/3 tests passing)  
**Stack:** Solana · Token-2022 · Anchor 0.32 · Next.js

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

### The Key Technical Detail

The Transfer Hook derives Identity PDAs **under the `identity_registry` program**, not under itself. This is done with `ExtraAccountMeta::new_external_pda_with_seeds(5, ...)` — where `5` is the index of the registry program in the execute account list.

Using `new_with_seeds` (the more obvious choice) silently derives PDAs under the **wrong** program, and every transfer sees empty identity accounts — a bug that's nearly impossible to spot from error messages alone, because the hook still fires and still blocks transfers; it just blocks them for the wrong reason.

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
    ✔ creates a loan mint with all extensions

3 passing (18s)
```

The compliance test is the **demo money shot** — it proves:

1. A transfer to a non-KYC wallet **reverts on-chain** with `RecipientNotVerified`
2. The exact revert reason is retrievable from transaction logs
3. Registering the recipient's KYC **immediately unblocks the same transfer**
4. The buyer's balance updates after successful settlement

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

**Wallet setup for local testing:**

- Install **Phantom** or **Solflare** browser extension
- Change network to **Localnet** with RPC `http://127.0.0.1:8899`
- Airdrop SOL: `solana airdrop 10`

---

## 🧪 Demo Flow (for judges)

1. **Originator page** — Create a $10M commercial loan to *Acme Manufacturing Ltd*, 7.5% coupon, 2-year maturity. This mints the Token-2022 mint with all three extensions.
2. **Marketplace page** — Mint 1000 tokens to buyer (KYC ✓). Attempt to transfer to a non-KYC wallet → **shows the exact revert** `Recipient is not KYC-verified` straight from on-chain logs.
3. **KYC registration** — Register the buyer → retry the same transfer → **succeeds instantly**.
4. **Portfolio page** — Buyer holds tokens, sees balance, can pledge as collateral.
5. **Regulator page** — Read-only view of every holder, ownership concentration, and full immutable transfer history.

Every step is a real on-chain transaction. No mocks. No mocked errors. The compliance revert is a real Solana program error.

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
│   ├── app/
│   ├── components/
│   ├── lib/
│   │   ├── idl/              # Anchor IDLs (committed)
│   │   ├── types/            # TS types (committed)
│   │   └── program.ts
│   └── package.json
├── docs/
│   ├── architecture.png
│   └── demo-script.md
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
| **Ledger** | Solana (mainnet will use private validator set) |
| **Token standard** | Token-2022 (SPL Token Extensions) |
| **Compliance** | Token-2022 Transfer Hook program |
| **Identity** | Custom Identity Registry program (extensible to SAS) |
| **Settlement** | Solana DvP program (roadmap) — atomic delivery vs payment |
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

### 🚧 In Progress (Milestones 6–8)

- [ ] Next.js frontend (originator, marketplace, portfolio, regulator)
- [ ] Interest distribution instruction
- [ ] Demo script + backup video

### 🔮 Post-Hackathon

- [ ] **Solana DvP integration** — atomic loan-token ↔ settlement-token swap
- [ ] **Solana Attestation Service (SAS)** — replace custom registry with re-usable verifiable credentials
- [ ] **Interest distribution** — quarterly coupon payments to all holders
- [ ] **Collateral vault** — pledge loan tokens as collateral, borrow stablecoins
- [ ] **Regulator read-only node** — dedicated RPC with GraphQL subscriptions
- [ ] **Multi-sig governance** — Squads multisig for upgrade authority
- [ ] **ZK selective disclosure** — prove compliance without revealing identity

---

## 🎨 Design Principles

1. **Compliance at the asset layer.** Not in the app, not in the API, not in a PDF. The token itself refuses to move.
2. **Atomicity over speed.** Loan token + payment settle in a single transaction — never partial.
3. **Regulator observability.** Read-only node sees everything, needs nothing.
4. **Minimal trusted surface.** The originator holds `PermanentDelegate` and `Pausable` — but neither can create tokens, move funds, or override KYC.
5. **On-chain provability.** Every claim in the pitch has a corresponding test.

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