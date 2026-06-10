// Regenerates lib/ofac.ts from the OFAC SDN sanctioned-address mirror.
// Run: node scripts/update-ofac.mjs
import { writeFileSync } from "node:fs";
const URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.txt";
const res = await fetch(URL);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const addrs = (await res.text())
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const date = new Date().toISOString().slice(0, 10);
const body = `// AUTO-GENERATED — do not edit by hand. Run \`node scripts/update-ofac.mjs\`.
// OFAC SDN sanctioned Bitcoin addresses (U.S. Treasury), parsed mirror:
//   https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
// Snapshot: ${date} · ${addrs.length} addresses
export const OFAC_SNAPSHOT = "${date}";
export const OFAC_COUNT = ${addrs.length};
export const OFAC_BTC = new Set<string>([
${addrs.map((a) => `  "${a}",`).join("\n")}
]);
`;
writeFileSync("lib/ofac.ts", body);
console.log(`wrote lib/ofac.ts — ${addrs.length} addresses (snapshot ${date})`);
