import { Suspense } from "react";
import Header from "@/components/Header";
import CoinCheck from "@/components/CoinCheck";

export const metadata = {
  title: "Check a coin — HEURISTIC",
  description:
    "Before you accept a Bitcoin payment, check its history: source of funds, sanctions screening, and an exchange-acceptance verdict.",
};

export default function CheckPage() {
  return (
    <>
      <Header />
      <Suspense
        fallback={
          <div className="flex h-[60vh] items-center justify-center">
            <span className="blink font-mono text-faint">▮ loading</span>
          </div>
        }
      >
        <CoinCheck />
      </Suspense>
    </>
  );
}
