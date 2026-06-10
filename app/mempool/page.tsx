import Header from "@/components/Header";
import MempoolLive from "@/components/MempoolLive";

export const metadata = { title: "Live mempool — HEURISTIC" };

export default function MempoolPage() {
  return (
    <>
      <Header />
      <MempoolLive />
    </>
  );
}
