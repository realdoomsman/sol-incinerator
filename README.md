# SOL Incinerator — Local Multi-Wallet Manager

A fully **client-side** web app for managing many of your own Solana wallets: close empty
token accounts to reclaim rent SOL, sell or burn leftover tokens, sweep all SOL into one
main wallet, and fund gas back out to the fleet.

**No backend. No accounts. No telemetry.** Your private keys never leave the browser tab —
they're only used locally to sign transactions, and signed transactions are the only thing
sent to the network (via your RPC and Jupiter).

---

## Read before you use it

- **Anyone with your private keys owns your funds.** Treat this like a hot wallet with all
  keys in one basket.
- Run it on a **trusted machine** you control. Prefer a private RPC (Helius, QuickNode,
  Triton) — the public `api.mainnet-beta.solana.com` is rate-limited and will choke on scans.
- The optional **vault** encrypts keys in this browser's `localStorage` with AES-GCM +
  PBKDF2 (250k iterations). It's only as strong as your password and your machine. Clearing
  browser data deletes it.
- **Burning is irreversible** — it destroys tokens permanently. Only burn junk/unsellable
  tokens.
- Always verify results on [Solscan](https://solscan.io). Every action logs a clickable tx link.
- This is a personal tool for **your own** wallets. Don't paste keys you don't own.

---

## Run it

The app loads its Solana libraries as ES modules from a CDN, so it must be served over
`http://` (opening the file directly won't work). From this folder:

```bash
npx serve
```

or

```bash
python -m http.server 8080
```

Then open the printed URL (e.g. `http://localhost:8080`).

---

## Recommended order of operations

Empty wallets can't pay their own fees, so fund first, reclaim last:

1. **Connect** your RPC (top of page).
2. **Import** your keys (base58 or JSON array, one per line) — or unlock a saved vault.
3. **Control wallet** — hit *Generate new control wallet* to mint a fresh deposit/control
   hub (or pick an imported wallet as MAIN). Deposit SOL to its shown address/QR. Back up its
   key or *Save to vault*. You can **withdraw** SOL from it to any address at any time. This
   MAIN wallet is the source of gas funding and the destination for SOL sweeps.
4. **Fund gas** → sends a little SOL to each selected wallet so it can pay fees.
5. **Scan** → lists token accounts (with balances + empty ones).
6. **Sell** → swaps token balances to SOL via Jupiter (unsellable tokens are skipped).
7. *(optional)* **Burn** → destroys leftover junk tokens so their accounts can close.
8. **Close accounts** → reclaims ~0.002 SOL rent per empty account.
9. **Sweep SOL** → consolidates everything into the main wallet.

Or hit **⚡ Run full reclaim** to do steps 6→9 on all selected wallets in one click.

---

## Key formats accepted

| Format | Example |
| --- | --- |
| base58 (Phantom/Solflare "export private key") | `4Nd7...` |
| JSON byte array (`solana-keygen` / id.json) | `[12,34,56,...]` |
| with optional label | `4Nd7...,farm-wallet-1` |

File import also accepts a single `id.json`, a JSON array of keys, or a newline list.

---

## What it does under the hood

- **web3.js** `getParsedTokenAccountsByOwner` for scanning (both Token and Token-2022 programs).
- **SPL-token** `closeAccount` / `burn` instructions, batched into transactions.
- **Jupiter v6** quote + swap API for selling (output mint = wSOL, unwrapped to SOL).
- **SystemProgram.transfer** for gas distribution and SOL consolidation, leaving a 5000-lamport
  fee buffer.

Everything runs in `app.js`. No build step, no server-side code.
