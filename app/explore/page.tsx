import { Suspense } from "react";
import Header from "@/components/Header";
import Explorer from "@/components/Explorer";

export const metadata = {
  title: "Explore — HEURISTIC",
};

export default function ExplorePage() {
  return (
    <>
      <Header />
      <Suspense
        fallback={
          <div className="dotgrid flex h-[calc(100vh-57px)] items-center justify-center">
            <span className="blink font-mono text-faint">▮ initializing</span>
          </div>
        }
      >
        <Explorer />
      </Suspense>
    </>
  );
}
