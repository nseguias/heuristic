import Header from "@/components/Header";
import AddressView from "@/components/AddressView";

export const metadata = { title: "Address — HEURISTIC" };

export default async function AddressPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return (
    <>
      <Header />
      <AddressView address={decodeURIComponent(address)} />
    </>
  );
}
