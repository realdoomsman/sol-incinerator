// SOL Incinerator — fully client-side. Keys never leave this browser.
import { Buffer } from 'https://esm.sh/buffer@6.0.3';
globalThis.Buffer = globalThis.Buffer || Buffer;

import {
  Connection, Keypair, PublicKey, Transaction, VersionedTransaction,
  SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram,
} from 'https://esm.sh/@solana/web3.js@1.95.3';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  createCloseAccountInstruction, createBurnInstruction,
} from 'https://esm.sh/@solana/spl-token@0.4.8?deps=@solana/web3.js@1.95.3';
import bs58 from 'https://esm.sh/bs58@6.0.0';
import QRCode from 'https://esm.sh/qrcode@1.5.4';

const WSOL = 'So11111111111111111111111111111111111111112';
const FEE_BUFFER = 5000;          // lamports left behind to pay a tx fee
const CLOSE_BATCH = 12;           // close instructions per tx (legacy size limit)
const FUND_BATCH = 14;            // transfer instructions per fund tx
const RENT_PER_ACCT = 2039280;    // typical SPL token-account rent (lamports)

// ---------- state ----------
let connection = null;
let wallets = [];                 // { id, keypair, address, label, sol, accounts:[], selected }
let mainId = null;
let idc = 0;
const $ = (id) => document.getElementById(id);

// ---------- logging ----------
function log(msg, cls = 'info') {
  const el = $('log');
  const line = document.createElement('div');
  line.className = 'l';
  const t = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="t">${t}</span><span class="${cls}">${msg}</span>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
const sig2link = (s) => `<a href="https://solscan.io/tx/${s}" target="_blank" rel="noopener">${s.slice(0,8)}…${s.slice(-8)}</a>`;
const short = (a) => `${a.slice(0,4)}…${a.slice(-4)}`;
const sol = (lamports) => (lamports / LAMPORTS_PER_SOL).toFixed(5);

// ---------- key parsing ----------
function parseSecret(raw) {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('[')) {                       // JSON byte array
    const arr = JSON.parse(s);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  const bytes = bs58.decode(s);                  // base58
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error(`unexpected key length ${bytes.length}`);
}

function addWalletFromLine(line) {
  const comma = line.lastIndexOf(',');
  let keyPart = line, label = '';
  // only treat trailing comma as label separator when it's not inside a JSON array
  if (comma > -1 && !line.trim().endsWith(']')) {
    keyPart = line.slice(0, comma);
    label = line.slice(comma + 1).trim();
  }
  const kp = parseSecret(keyPart);
  if (!kp) return null;
  const address = kp.publicKey.toBase58();
  if (wallets.some((w) => w.address === address)) return { dup: true, address };
  const w = { id: ++idc, keypair: kp, address, label: label || `wallet-${idc}`, sol: null, accounts: null, selected: true };
  wallets.push(w);
  if (mainId === null) mainId = w.id;
  return w;
}

// ---------- rendering ----------
function renderWallets() {
  const body = $('walletBody');
  body.innerHTML = '';
  if (!wallets.length) {
    body.innerHTML = '<tr class="empty"><td colspan="7">No wallets loaded.</td></tr>';
  } else {
    for (const w of wallets) {
      const tr = document.createElement('tr');
      if (w.id === mainId) tr.className = 'ismain';
      const emptyAccts = w.accounts ? w.accounts.filter((a) => a.amount === 0n).length : null;
      const reclaimable = w.accounts ? emptyAccts * RENT_PER_ACCT : null;
      tr.innerHTML = `
        <td><input type="checkbox" data-sel="${w.id}" ${w.selected ? 'checked' : ''}></td>
        <td class="rowlabel"><input type="text" data-label="${w.id}" value="${escapeHtml(w.label)}">
            ${w.id === mainId ? '<span class="tag">MAIN</span>' : ''}</td>
        <td><a class="addr" href="https://solscan.io/account/${w.address}" target="_blank" rel="noopener">${short(w.address)}</a></td>
        <td class="num">${w.sol === null ? '—' : sol(w.sol)}</td>
        <td class="num">${w.accounts === null ? '—' : `${w.accounts.length}${emptyAccts ? ` (${emptyAccts} empty)` : ''}`}</td>
        <td class="num">${reclaimable === null ? '—' : sol(reclaimable)}</td>
        <td><button data-copy="${w.address}" class="ghost small">copy</button></td>`;
      body.appendChild(tr);
    }
  }
  // main-wallet select
  const sel = $('mainSelect');
  sel.innerHTML = wallets.map((w) => `<option value="${w.id}" ${w.id === mainId ? 'selected' : ''}>${escapeHtml(w.label)} · ${short(w.address)}</option>`).join('');
  renderTotals();
  renderControl();
}

// ---------- control wallet ----------
let lastQrAddr = null;
function renderControl() {
  const main = mainWallet();
  const panel = $('controlPanel'), noMain = $('noMain');
  if (!main) { panel.style.display = 'none'; noMain.style.display = 'block'; return; }
  noMain.style.display = 'none'; panel.style.display = 'block';
  $('ctrlAddr').textContent = main.address;
  $('ctrlBal').textContent = main.sol === null ? '—' : sol(main.sol);
  if (lastQrAddr !== main.address) {                 // only regenerate QR when address changes
    lastQrAddr = main.address;
    $('revealBox').style.display = 'none';           // hide any revealed key from a previous wallet
    $('revealBtn').textContent = 'Reveal / back up private key';
    QRCode.toDataURL(main.address, { margin: 1, width: 160 })
      .then((url) => { $('ctrlQr').src = url; })
      .catch(() => { $('ctrlQr').removeAttribute('src'); });
  }
}

function generateControlWallet() {
  const kp = Keypair.generate();
  const w = { id: ++idc, keypair: kp, address: kp.publicKey.toBase58(), label: `control-${idc}`, sol: 0, accounts: null, selected: true };
  wallets.push(w);
  mainId = w.id;
  renderWallets();
  log(`Generated control wallet ${short(w.address)} — deposit SOL to it, then back up its key or save the vault.`, 'ok');
}

function revealMainKey() {
  const main = mainWallet(); if (!main) return;
  const box = $('revealBox');
  if (box.style.display !== 'none') {
    box.style.display = 'none';
    $('revealBtn').textContent = 'Reveal / back up private key';
    return;
  }
  $('revealB58').value = bs58.encode(main.keypair.secretKey);
  $('revealJson').value = '[' + Array.from(main.keypair.secretKey).join(',') + ']';
  box.style.display = 'block';
  $('revealBtn').textContent = 'Hide private key';
  log('Private key shown on screen — back it up somewhere offline, then hide it.', 'warn');
}

async function refreshMainBalance() {
  const main = mainWallet(); if (!main || !connection) return;
  try { main.sol = await connection.getBalance(main.keypair.publicKey, 'confirmed'); renderWallets(); }
  catch (e) { log(`Balance error: ${e.message}`, 'err'); }
}

async function withdrawFromMain() {
  requireConn();
  const main = mainWallet(); if (!main) { log('No control/main wallet set.', 'warn'); return; }
  let dest;
  try { dest = new PublicKey($('wdDest').value.trim()); } catch { log('Invalid destination address.', 'err'); return; }
  if (dest.toBase58() === main.address) { log('Destination is the control wallet itself.', 'warn'); return; }
  const bal = await connection.getBalance(main.keypair.publicKey, 'confirmed');
  const lamports = $('wdMax').checked
    ? bal - FEE_BUFFER
    : Math.round((parseFloat($('wdAmount').value) || 0) * LAMPORTS_PER_SOL);
  if (!(lamports > 0)) { log('Enter a positive amount, or tick "max".', 'warn'); return; }
  if (lamports > bal - FEE_BUFFER) { log(`Not enough SOL. Balance ${sol(bal)}, need ${sol(lamports + FEE_BUFFER)} incl. fee.`, 'err'); return; }
  try {
    const ix = SystemProgram.transfer({ fromPubkey: main.keypair.publicKey, toPubkey: dest, lamports });
    const s = await sendIx([ix], main.keypair);
    log(`Withdrew ${sol(lamports)} SOL → ${short(dest.toBase58())} · ${sig2link(s)}`, 'ok');
    $('wdAmount').value = ''; $('wdMax').checked = false; $('wdAmount').disabled = false;
    await refreshMainBalance();
  } catch (e) { log(`Withdraw failed: ${e.message}`, 'err'); }
}

function renderTotals() {
  const t = $('totals');
  if (!wallets.length) { t.textContent = ''; return; }
  const known = wallets.filter((w) => w.sol !== null);
  const totalSol = known.reduce((s, w) => s + w.sol, 0);
  const totalAccts = wallets.reduce((s, w) => s + (w.accounts ? w.accounts.length : 0), 0);
  const emptyAccts = wallets.reduce((s, w) => s + (w.accounts ? w.accounts.filter((a) => a.amount === 0n).length : 0), 0);
  t.innerHTML = `Wallets: <b>${wallets.length}</b> · Selected: <b>${wallets.filter(w=>w.selected).length}</b>` +
    (known.length ? ` · Total SOL (scanned): <b>${totalSol.toFixed(5)}</b>` : '') +
    (totalAccts ? ` · Token accounts: <b>${totalAccts}</b> · Empty (reclaimable): <b>${emptyAccts}</b> ≈ <b>${sol(emptyAccts*RENT_PER_ACCT)} SOL</b>` : '');
}

function escapeHtml(s){return String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
const selectedWallets = () => wallets.filter((w) => w.selected);
const mainWallet = () => wallets.find((w) => w.id === mainId);

// ---------- connection ----------
async function connect() {
  const url = $('rpcUrl').value.trim();
  if (!url) { log('Enter an RPC endpoint first.', 'warn'); return; }
  try {
    setConn('off', 'connecting…');
    connection = new Connection(url, 'confirmed');
    const v = await connection.getVersion();
    localStorage.setItem('inc_rpc', url);
    localStorage.setItem('inc_jup', $('jupBase').value.trim());
    setConn('on', `connected · core ${v['solana-core']}`);
    log(`Connected to RPC (solana-core ${v['solana-core']}).`, 'ok');
  } catch (e) {
    setConn('err', 'connection failed');
    log(`Connect failed: ${e.message}`, 'err');
  }
}
function setConn(state, text) {
  $('connDot').className = `dot ${state}`;
  $('connText').textContent = text;
}
function requireConn(){ if(!connection){ log('Connect to an RPC first.','warn'); throw new Error('no rpc'); } }

// ---------- balances + token scan ----------
async function refreshBalances() {
  requireConn();
  log('Refreshing SOL balances…');
  for (const w of wallets) {
    try { w.sol = await connection.getBalance(w.keypair.publicKey, 'confirmed'); }
    catch (e) { log(`Balance error ${short(w.address)}: ${e.message}`, 'err'); }
  }
  renderWallets();
  log('Balances updated.', 'ok');
}

async function scanAccounts(list = selectedWallets()) {
  requireConn();
  if (!list.length) { log('No wallets selected.', 'warn'); return; }
  log(`Scanning token accounts for ${list.length} wallet(s)…`);
  for (const w of list) {
    try {
      const accts = [];
      for (const pid of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const res = await connection.getParsedTokenAccountsByOwner(w.keypair.publicKey, { programId: pid }, 'confirmed');
        for (const { pubkey, account } of res.value) {
          const info = account.data.parsed.info;
          accts.push({
            pubkey,
            mint: info.mint,
            programId: pid,
            amount: BigInt(info.tokenAmount.amount),
            decimals: info.tokenAmount.decimals,
            ui: info.tokenAmount.uiAmount,
          });
        }
      }
      w.accounts = accts;
      w.sol = await connection.getBalance(w.keypair.publicKey, 'confirmed');
      const nonzero = accts.filter((a) => a.amount > 0n).length;
      const empty = accts.length - nonzero;
      log(`${short(w.address)}: ${accts.length} accounts (${nonzero} with tokens, ${empty} empty).`, 'info');
    } catch (e) {
      log(`Scan error ${short(w.address)}: ${e.message}`, 'err');
    }
  }
  renderWallets();
  log('Scan complete.', 'ok');
}

// ---------- tx helper ----------
async function sendIx(instructions, payer, signers = []) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = blockhash;
  tx.add(...instructions);
  tx.sign(payer, ...signers);
  const raw = tx.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}
const chunk = (arr, n) => { const out = []; for (let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; };

// ---------- close empty accounts ----------
async function closeEmpty(list = selectedWallets()) {
  requireConn();
  let closed = 0;
  for (const w of list) {
    if (!w.accounts) { await scanAccounts([w]); }
    const empties = (w.accounts || []).filter((a) => a.amount === 0n);
    if (!empties.length) { log(`${short(w.address)}: no empty accounts.`); continue; }
    log(`${short(w.address)}: closing ${empties.length} empty account(s)…`);
    for (const group of chunk(empties, CLOSE_BATCH)) {
      const ix = group.map((a) =>
        createCloseAccountInstruction(a.pubkey, w.keypair.publicKey, w.keypair.publicKey, [], a.programId));
      try {
        const s = await sendIx(ix, w.keypair);
        closed += group.length;
        log(`  closed ${group.length} · ${sig2link(s)}`, 'ok');
      } catch (e) { log(`  close batch failed: ${e.message}`, 'err'); }
    }
    await scanAccounts([w]);
  }
  log(`Done. Closed ${closed} account(s), reclaimed ≈ ${sol(closed*RENT_PER_ACCT)} SOL.`, 'ok');
  renderWallets();
}

// ---------- burn balances ----------
async function burnBalances(list = selectedWallets(), silentGuard = false) {
  requireConn();
  if (!silentGuard && !$('burnConfirm').checked) { log('Tick the burn confirmation box first.', 'warn'); return; }
  let burned = 0;
  for (const w of list) {
    if (!w.accounts) await scanAccounts([w]);
    const held = (w.accounts || []).filter((a) => a.amount > 0n);
    if (!held.length) continue;
    log(`${short(w.address)}: burning ${held.length} balance(s)…`, 'warn');
    for (const a of held) {
      try {
        const ix = createBurnInstruction(a.pubkey, new PublicKey(a.mint), w.keypair.publicKey, a.amount, [], a.programId);
        const s = await sendIx([ix], w.keypair);
        burned++;
        log(`  burned ${a.ui ?? ''} ${short(a.mint)} · ${sig2link(s)}`, 'ok');
      } catch (e) { log(`  burn failed ${short(a.mint)}: ${e.message}`, 'err'); }
    }
    await scanAccounts([w]);
  }
  log(`Burned ${burned} token balance(s).`, 'ok');
  renderWallets();
}

// ---------- sell via Jupiter ----------
async function jupSell(walletKp, acct, slippageBps, jupBase) {
  const q = await fetch(`${jupBase}/quote?inputMint=${acct.mint}&outputMint=${WSOL}&amount=${acct.amount}&slippageBps=${slippageBps}`);
  const quote = await q.json();
  if (!quote || quote.error || !quote.outAmount) throw new Error(quote?.error || 'no route');
  const sr = await fetch(`${jupBase}/swap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: walletKp.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  const { swapTransaction, error } = await sr.json();
  if (!swapTransaction) throw new Error(error || 'swap build failed');
  const vtx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  vtx.sign([walletKp]);
  const sig = await connection.sendRawTransaction(vtx.serialize(), { maxRetries: 5 });
  await connection.confirmTransaction(sig, 'confirmed');
  return { sig, outSol: Number(quote.outAmount) / LAMPORTS_PER_SOL };
}

async function sellAll(list = selectedWallets()) {
  requireConn();
  const jupBase = $('jupBase').value.trim();
  const slippage = Math.max(1, parseInt($('slippage').value, 10) || 100);
  let sold = 0, gained = 0;
  for (const w of list) {
    if (!w.accounts) await scanAccounts([w]);
    const held = (w.accounts || []).filter((a) => a.amount > 0n && a.mint !== WSOL);
    if (!held.length) { log(`${short(w.address)}: nothing to sell.`); continue; }
    log(`${short(w.address)}: selling ${held.length} token(s)…`);
    for (const a of held) {
      try {
        const { sig, outSol } = await jupSell(w.keypair, a, slippage, jupBase);
        sold++; gained += outSol;
        log(`  sold ${a.ui ?? ''} ${short(a.mint)} → ~${outSol.toFixed(5)} SOL · ${sig2link(sig)}`, 'ok');
      } catch (e) { log(`  skip ${short(a.mint)}: ${e.message}`, 'warn'); }
    }
    await scanAccounts([w]);
  }
  log(`Sold ${sold} token(s) for ≈ ${gained.toFixed(5)} SOL.`, 'ok');
  renderWallets();
}

// ---------- sweep SOL to main ----------
async function sweepToMain(list = selectedWallets()) {
  requireConn();
  const main = mainWallet();
  if (!main) { log('Set a main wallet first.', 'warn'); return; }
  let moved = 0;
  for (const w of list) {
    if (w.id === mainId) continue;
    try {
      const bal = await connection.getBalance(w.keypair.publicKey, 'confirmed');
      const send = bal - FEE_BUFFER;
      if (send <= 0) { log(`${short(w.address)}: dust only (${sol(bal)}), skipped.`); continue; }
      const ix = SystemProgram.transfer({ fromPubkey: w.keypair.publicKey, toPubkey: main.keypair.publicKey, lamports: send });
      const s = await sendIx([ix], w.keypair);
      moved += send;
      log(`${short(w.address)} → main: ${sol(send)} SOL · ${sig2link(s)}`, 'ok');
    } catch (e) { log(`Sweep failed ${short(w.address)}: ${e.message}`, 'err'); }
  }
  log(`Swept ≈ ${sol(moved)} SOL to ${short(main.address)}.`, 'ok');
  await refreshBalances();
}

// ---------- fund gas from main ----------
async function fundGas(list = selectedWallets()) {
  requireConn();
  const main = mainWallet();
  if (!main) { log('Set a main wallet first.', 'warn'); return; }
  const perSol = parseFloat($('fundAmount').value);
  if (!(perSol > 0)) { log('Enter a positive SOL amount.', 'warn'); return; }
  const lamports = Math.round(perSol * LAMPORTS_PER_SOL);
  const targets = list.filter((w) => w.id !== mainId);
  if (!targets.length) { log('No non-main wallets selected.', 'warn'); return; }

  const mainBal = await connection.getBalance(main.keypair.publicKey, 'confirmed');
  const need = lamports * targets.length + FEE_BUFFER * Math.ceil(targets.length / FUND_BATCH) + FEE_BUFFER;
  if (mainBal < need) {
    log(`Main wallet has ${sol(mainBal)} SOL but needs ≈ ${sol(need)} to fund ${targets.length} wallets.`, 'err');
    return;
  }
  log(`Funding ${targets.length} wallet(s) with ${perSol} SOL each…`);
  for (const group of chunk(targets, FUND_BATCH)) {
    const ix = group.map((w) => SystemProgram.transfer({
      fromPubkey: main.keypair.publicKey, toPubkey: w.keypair.publicKey, lamports }));
    try {
      const s = await sendIx(ix, main.keypair);
      log(`  funded ${group.length} wallet(s) · ${sig2link(s)}`, 'ok');
    } catch (e) { log(`  fund batch failed: ${e.message}`, 'err'); }
  }
  log('Gas distribution complete.', 'ok');
  await refreshBalances();
}

// ---------- full reclaim ----------
async function fullReclaim() {
  requireConn();
  const list = selectedWallets().filter((w) => w.id !== mainId || selectedWallets().length === 1);
  if (!list.length) { log('No wallets selected.', 'warn'); return; }
  log('=== FULL RECLAIM START ===', 'warn');
  await scanAccounts(list);
  await sellAll(list);
  if ($('fullBurn').checked) await burnBalances(list, true);
  await closeEmpty(list);
  if ($('fullSweep').checked) await sweepToMain(list);
  log('=== FULL RECLAIM DONE ===', 'ok');
}

// ---------- vault (AES-GCM) ----------
async function deriveKey(pass, salt) {
  const mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    mat, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function vaultSave() {
  const pass = $('vaultPass').value;
  if (!pass) { log('Enter a vault password.', 'warn'); return; }
  if (!wallets.length) { log('No wallets to save.', 'warn'); return; }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const payload = JSON.stringify(wallets.map((w) => ({ sk: bs58.encode(w.keypair.secretKey), label: w.label, main: w.id === mainId })));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload));
  localStorage.setItem('inc_vault', JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  $('vaultState').textContent = `Vault saved · ${wallets.length} wallet(s) encrypted in this browser.`;
  log(`Encrypted vault saved (${wallets.length} wallets).`, 'ok');
}

async function vaultUnlock() {
  const pass = $('vaultPass').value;
  const stored = localStorage.getItem('inc_vault');
  if (!stored) { $('vaultState').textContent = 'No saved vault in this browser yet.'; return; }
  if (!pass) { log('Enter the vault password.', 'warn'); return; }
  try {
    const { salt, iv, ct } = JSON.parse(stored);
    const key = await deriveKey(pass, unb64(salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
    const arr = JSON.parse(new TextDecoder().decode(pt));
    wallets = []; mainId = null; idc = 0;
    for (const e of arr) {
      const kp = Keypair.fromSecretKey(bs58.decode(e.sk));
      const w = { id: ++idc, keypair: kp, address: kp.publicKey.toBase58(), label: e.label, sol: null, accounts: null, selected: true };
      wallets.push(w);
      if (e.main) mainId = w.id;
    }
    if (mainId === null && wallets.length) mainId = wallets[0].id;
    renderWallets();
    $('vaultState').textContent = `Unlocked · ${wallets.length} wallet(s) loaded.`;
    log(`Vault unlocked: ${wallets.length} wallet(s).`, 'ok');
  } catch (e) {
    $('vaultState').textContent = 'Unlock failed — wrong password or corrupt vault.';
    log('Vault unlock failed (wrong password?).', 'err');
  }
}

function vaultLock() {
  wallets = []; mainId = null;
  renderWallets();
  $('vaultState').textContent = 'Memory wiped. Encrypted vault (if saved) remains in browser storage.';
  log('Locked — keys wiped from memory.', 'warn');
}

// ---------- wire up ----------
function wire() {
  $('rpcUrl').value = localStorage.getItem('inc_rpc') || '';
  $('jupBase').value = localStorage.getItem('inc_jup') || 'https://quote-api.jup.ag/v6';

  $('connectBtn').onclick = connect;
  $('refreshBtn').onclick = () => refreshBalances().catch(()=>{});
  $('scanBtn').onclick = () => scanAccounts().catch(()=>{});
  $('closeBtn').onclick = () => closeEmpty().catch(()=>{});
  $('burnBtn').onclick = () => burnBalances().catch(()=>{});
  $('sellBtn').onclick = () => sellAll().catch(()=>{});
  $('sweepBtn').onclick = () => sweepToMain().catch(()=>{});
  $('fundBtn').onclick = () => fundGas().catch(()=>{});
  $('fullRunBtn').onclick = () => fullReclaim().catch(()=>{});

  $('vaultSave').onclick = () => vaultSave().catch((e)=>log(e.message,'err'));
  $('vaultUnlock').onclick = () => vaultUnlock().catch((e)=>log(e.message,'err'));
  $('vaultLock').onclick = vaultLock;

  // control wallet
  $('genBtn').onclick = generateControlWallet;
  $('revealBtn').onclick = revealMainKey;
  $('saveVaultQuick').onclick = () => vaultSave().catch((e)=>log(e.message,'err'));
  $('withdrawBtn').onclick = () => withdrawFromMain().catch(()=>{});
  $('ctrlRefresh').onclick = () => refreshMainBalance();
  $('ctrlCopy').onclick = (e) => {
    const main = mainWallet(); if (!main) return;
    navigator.clipboard.writeText(main.address);
    e.target.textContent = 'copied'; setTimeout(()=>e.target.textContent='copy',900);
  };
  $('wdMax').onchange = (e) => { $('wdAmount').disabled = e.target.checked; };

  $('importBtn').onclick = () => {
    const lines = $('keyInput').value.split('\n').map((l)=>l.trim()).filter(Boolean);
    let added = 0, dup = 0, bad = 0;
    for (const line of lines) {
      try { const r = addWalletFromLine(line); if (!r) continue; if (r.dup) dup++; else added++; }
      catch (e) { bad++; log(`Bad key: ${e.message}`, 'err'); }
    }
    $('keyInput').value = '';
    $('importState').textContent = `Added ${added}, duplicates ${dup}, invalid ${bad}. Total ${wallets.length}.`;
    log(`Imported ${added} wallet(s).`, 'ok');
    renderWallets();
  };

  $('fileInput').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    let added = 0;
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j) && typeof j[0] === 'number') {           // single keypair file
        const kp = Keypair.fromSecretKey(Uint8Array.from(j));
        if (!wallets.some((w)=>w.address===kp.publicKey.toBase58())) {
          wallets.push({ id: ++idc, keypair: kp, address: kp.publicKey.toBase58(), label:`wallet-${idc}`, sol:null, accounts:null, selected:true });
          if (mainId===null) mainId = idc; added++;
        }
      } else if (Array.isArray(j)) {                                // array of keys/objects
        for (const item of j) {
          const line = typeof item === 'string' ? item : (item.secretKey || JSON.stringify(item.key || item));
          const r = addWalletFromLine(line); if (r && !r.dup) added++;
        }
      }
    } catch { // treat as newline list
      for (const line of text.split('\n').map((l)=>l.trim()).filter(Boolean)) {
        try { const r = addWalletFromLine(line); if (r && !r.dup) added++; } catch {}
      }
    }
    $('importState').textContent = `Imported ${added} from file. Total ${wallets.length}.`;
    log(`Imported ${added} wallet(s) from ${file.name}.`, 'ok');
    renderWallets();
    e.target.value = '';
  };

  $('clearAllBtn').onclick = () => {
    if (!wallets.length) return;
    if (!confirm('Remove all loaded wallets from memory? (Encrypted vault in storage is not deleted.)')) return;
    wallets = []; mainId = null; renderWallets(); log('Cleared all wallets from memory.', 'warn');
  };

  $('mainSelect').onchange = (e) => { mainId = parseInt(e.target.value, 10); renderWallets(); };
  $('selectAll').onchange = (e) => { wallets.forEach((w)=>w.selected = e.target.checked); renderWallets(); };
  $('clearLog').onclick = () => { $('log').innerHTML = ''; };

  // event delegation for dynamic rows
  $('walletBody').addEventListener('change', (e) => {
    const sid = e.target.getAttribute('data-sel');
    if (sid) { const w = wallets.find((x)=>x.id==sid); if (w) w.selected = e.target.checked; renderTotals(); }
    const lid = e.target.getAttribute('data-label');
    if (lid) { const w = wallets.find((x)=>x.id==lid); if (w) w.label = e.target.value; }
  });
  $('walletBody').addEventListener('click', (e) => {
    const addr = e.target.getAttribute('data-copy');
    if (addr) { navigator.clipboard.writeText(addr); e.target.textContent = 'copied'; setTimeout(()=>e.target.textContent='copy',900); }
  });

  if (localStorage.getItem('inc_vault')) $('vaultState').textContent = 'Encrypted vault found in this browser — enter password and Unlock.';
  renderWallets();
  log('Ready. Connect an RPC, generate a control wallet or import keys, then operate.', 'info');
}

wire();
