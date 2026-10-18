import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="pt-12">
        <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">
          Tokenized <span className="text-blue-500">Commercial Loan</span>
          <br />
          Participations
        </h1>
        <p className="text-slate-400 max-w-3xl text-lg">
          TrustLedger brings illiquid commercial loans on-chain. Fractional ownership,
          KYC-gated transfers enforced by the token itself, atomic settlement, and
          real-time regulator oversight — on Solana.
        </p>
        <div className="flex gap-3 mt-6">
          <Link href="/originator" className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 font-medium">
            Enter Demo
          </Link>
          <Link href="/regulator" className="px-5 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 font-medium">
            Regulator View
          </Link>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <Card title="Compliance by Design">
          Token-2022 Transfer Hooks enforce KYC, sanctions, and jurisdiction rules on
          every transfer — not just at the API layer.
        </Card>
        <Card title="Atomic Settlement">
          Loan transfers and payments settle in a single transaction. Sub-second
          finality, sub-cent fees.
        </Card>
        <Card title="Regulator Oversight">
          A read-only regulator node sees ownership concentration and every transfer in
          real time — no reconciliation required.
        </Card>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-xl bg-slate-900 border border-white/5">
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
