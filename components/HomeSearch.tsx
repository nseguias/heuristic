"use client";

import { useRouter } from "next/navigation";
import { classifyQuery } from "@/lib/api";
import SearchBar from "./SearchBar";

export default function HomeSearch() {
  const router = useRouter();
  return (
    <SearchBar
      onSubmit={(q) => {
        const s = q.trim();
        const kind = classifyQuery(s);
        // Addresses go straight to the safety check (the headline use case);
        // transaction ids open the graph explorer.
        if (kind === "address")
          router.push(`/check?address=${encodeURIComponent(s)}`);
        else if (kind === "txid") router.push(`/explore?q=${s}`);
      }}
    />
  );
}
