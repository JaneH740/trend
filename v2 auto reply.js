// ==UserScript==
// @name         X Auto-Reply from Google Sheet v2
// @namespace    jane-tools
// @version      2.2.0
// @description  Reply to a tweet with random cleaned rows (col A) from a public Google Sheet (address bar / pubhtml / CSV). Optional keyword line supported. Hardened navigation, focus fixes, and submit fallbacks. Panel collapses into a circular button when hidden.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      docs.google.com
// @connect      googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /*** UI ***/
  const ui = document.createElement("div");
  ui.style.cssText = `
    position: fixed; z-index: 999999; bottom: 20px; right: 20px;
    background: rgba(22,24,28,0.96); color: #fff; padding: 14px 16px;
    border-radius: 14px; width: 460px; font-family: system-ui, sans-serif;
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
  `;
  ui.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <strong style="font-size:14px;">X Auto-Reply • Google Sheet</strong>
      <div style="display:flex;gap:6px;">
        <button id="xrw-collapse" style="background:#1d9bf0;color:#fff;border:none;border-radius:10px;padding:4px 8px;cursor:pointer;">Hide</button>
      </div>
    </div>
    <div id="xrw-body">
      <label style="display:block;font-size:12px;margin:6px 0 2px;">Tweet Link</label>
      <input id="xrw-tweeturl" placeholder="https://x.com/user/status/1859..." style="width:100%;padding:8px;border-radius:10px;border:1px solid #333;background:#0f1419;color:#eee;">
      <label style="display:block;font-size:12px;margin:10px 0 2px;">Google Sheet Link (address bar / pubhtml / export CSV)</label>
      <input id="xrw-sheetany" placeholder="Paste a public sheet link" style="width:100%;padding:8px;border-radius:10px;border:1px solid #333;background:#0f1419;color:#eee;">
      <div style="display:flex;gap:8px;margin-top:10px;">
        <div style="flex:1;">
          <label style="display:block;font-size:12px;margin-bottom:2px;"># of Replies</label>
          <input id="xrw-count" type="number" min="1" value="5" style="width:100%;padding:8px;border-radius:10px;border:1px solid #333;background:#0f1419;color:#eee;">
        </div>
        <div style="flex:1;">
          <label style="display:block;font-size:12px;margin-bottom:2px;">Delay (ms)</label>
          <input id="xrw-delay" type="number" min="0" value="5000" style="width:100%;padding:8px;border-radius:10px;border:1px solid #333;background:#0f1419;color:#eee;">
        </div>
      </div>
      <small style="opacity:.85;display:block;margin-top:8px;">
        Uses <b>column A</b>. Random rows each run. Optional keyword line between main text and hashtag is supported. Sheet must be public.
      </small>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="xrw-startbtn" style="flex:1;background:#00ba7c;color:#0b1419;border:none;border-radius:12px;padding:10px;cursor:pointer;font-weight:600;">Start</button>
        <button id="xrw-stopbtn" style="flex:1;background:#ef4444;color:#fff;border:none;border-radius:12px;padding:10px;cursor:pointer;font-weight:600;">Stop</button>
      </div>
      <div id="xrw-status" style="font-size:12px;opacity:.9;margin-top:10px;">Idle.</div>
    </div>
  `;
  document.body.appendChild(ui);

  // Circular FAB that appears when panel is hidden
  const fab = document.createElement("button");
  fab.id = "xrw-fab";
  fab.textContent = "XR";
  fab.title = "Open X Auto-Reply";
  fab.style.cssText = `
    position: fixed; z-index: 1000000; bottom: 20px; right: 20px;
    width: 52px; height: 52px; border-radius: 50%;
    background: #1d9bf0; color: #fff; border: none; cursor: pointer;
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    font: 700 16px system-ui, sans-serif; display:none; align-items:center; justify-content:center;
  `;
  document.body.appendChild(fab);

  // simple drag for the FAB
  (function enableFabDrag() {
    let dragging = false, sx=0, sy=0, sr=0, sb=0;
    const onDown = (e) => { dragging = true; sx = e.clientX; sy = e.clientY; const r = parseInt(fab.style.right); const b = parseInt(fab.style.bottom); sr = isNaN(r)?20:r; sb = isNaN(b)?20:b; e.preventDefault(); };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      fab.style.right = Math.max(0, sr - dx) + "px";
      fab.style.bottom = Math.max(0, sb - dy) + "px";
    };
    const onUp = () => { dragging = false; };
    fab.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // touch
    fab.addEventListener("touchstart", (e)=>{ const t=e.touches[0]; onDown(t); }, {passive:false});
    window.addEventListener("touchmove", (e)=>{ const t=e.touches[0]; onMove(t); }, {passive:false});
    window.addEventListener("touchend", onUp);
  })();

  const els = {
    collapse: ui.querySelector("#xrw-collapse"),
    body: ui.querySelector("#xrw-body"),
    tweetUrl: ui.querySelector("#xrw-tweeturl"),
    sheetAny: ui.querySelector("#xrw-sheetany"),
    count: ui.querySelector("#xrw-count"),
    delay: ui.querySelector("#xrw-delay"),
    startBtn: ui.querySelector("#xrw-startbtn"),
    stopBtn: ui.querySelector("#xrw-stopbtn"),
    status: ui.querySelector("#xrw-status"),
  };

  // Persist inputs
  ["tweetUrl", "sheetAny", "count", "delay"].forEach((k) => {
    const v = GM_getValue("xrw_" + k, "");
    if (v) els[k].value = v;
  });
  function saveInputs() {
    GM_setValue("xrw_tweetUrl", els.tweetUrl.value.trim());
    GM_setValue("xrw_sheetAny", els.sheetAny.value.trim());
    GM_setValue("xrw_count", els.count.value.trim());
    GM_setValue("xrw_delay", els.delay.value.trim());
  }

  // Collapse → show round FAB; expand → hide FAB
  els.collapse.addEventListener("click", () => {
    ui.style.display = "none";
    fab.style.display = "flex";
  });
  fab.addEventListener("click", () => {
    ui.style.display = "block";
    fab.style.display = "none";
  });

  /*** Utils ***/
  let ABORT = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const logStatus = (m) => { els.status.textContent = m; };
  function toast(msg, persist = false) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:20px;bottom:20px;background:#111;color:#fff;padding:10px 12px;border-radius:10px;z-index:9999999;box-shadow:0 6px 20px rgba(0,0,0,.35);font:12px system-ui;cursor:pointer;';
    document.body.appendChild(t);
    const remove = () => t.remove();
    t.addEventListener('click', remove);
    if (!persist) setTimeout(remove, 5000);
    return { remove };
  }

  function extractTweetIdFromUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      const m = u.pathname.match(/(?:\/i)?\/status(?:es)?\/(\d+)/);
      if (m && m[1]) return m[1];
    } catch { }
    const m2 = String(urlStr).match(/(\d{12,})/);
    return m2 ? m2[1] : null;
  }

  function waitFor(checkFn, timeout = 22000, interval = 120) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        let el;
        try { el = checkFn(); } catch { }
        if (el) return resolve(el);
        if (Date.now() - start >= timeout) return reject(new Error("Timeout waiting for element"));
        setTimeout(poll, interval);
      })();
    });
  }

  async function nudgeEditorEnable(el) {
    await ensureComposerFocus(el);
    clearHiddenFocus();

    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(r);
    el.dispatchEvent(new Event("selectionchange", { bubbles: true }));

    const doKey = (type, key, code) =>
      el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key, code }));

    doKey("keydown", " ", "Space");
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }));
    el.appendChild(document.createTextNode(" "));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }));
    doKey("keyup", " ", "Space");

    doKey("keydown", "Backspace", "Backspace");
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward", data: null }));
    const lastNode = el.lastChild;
    if (lastNode && lastNode.nodeType === Node.TEXT_NODE && lastNode.textContent) {
      lastNode.textContent = lastNode.textContent.slice(0, -1);
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "deleteContentBackward", data: null }));
    doKey("keyup", "Backspace", "Backspace");

    await new Promise(r2 => setTimeout(r2, 120));
  }

  /*** Focus helpers to avoid aria-hidden traps ***/
  function getAriaHiddenAncestor(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      if (n.getAttribute && n.getAttribute("aria-hidden") === "true") return n;
      n = n.parentNode;
    }
    return null;
  }
  function clearHiddenFocus() {
    const active = document.activeElement;
    const hiddenAncestor = active ? getAriaHiddenAncestor(active) : null;
    if (hiddenAncestor) {
      try { active.blur?.(); } catch { }
      try { document.body.focus(); } catch { }
      try {
        const safe = document.querySelector('main, [role="main"], body');
        if (safe) {
          const r = safe.getBoundingClientRect();
          safe.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
          safe.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
          safe.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
        }
      } catch { }
    }
  }
  async function ensureComposerFocus(el) {
    const hiddenAncestor = getAriaHiddenAncestor(el);
    if (hiddenAncestor) { clearHiddenFocus(); await sleep(100); }
    try { el.focus(); } catch { }
  }

  /*** Navigation & opening the correct reply dialog ***/
  async function navigateToTweet(tweetId) {
    const target = `${location.origin}/i/status/${tweetId}`;

    if (!location.href.includes(`/status/${tweetId}`)) {
      logStatus("Navigating to tweet…");
      location.assign(target);

      let ok = false;
      for (let t = 0; t < 300; t++) { await sleep(100); if (location.href.includes(`/status/${tweetId}`)) { ok = true; break; } }
      if (!ok) {
        history.replaceState(null, "", target);
        for (let t = 0; t < 150; t++) { await sleep(100); if (location.href.includes(`/status/${tweetId}`)) { ok = true; break; } }
      }
      if (!ok) { toast("NAV1: Could not reach status URL"); throw new Error("NAV1"); }
    }

    await sleep(900);
    window.scrollTo({ top: 0, behavior: "instant" });
    try {
      await waitFor(() => document.querySelector('article'), 20000, 120);
    } catch {
      toast("NAV2: No tweet articles rendered");
      throw new Error("NAV2");
    }
  }

  function findMainTweetArticle(tweetId) {
    const links = Array.from(document.querySelectorAll(`a[href*="/status/${tweetId}"]`));
    for (const a of links) {
      const art = a.closest("article");
      if (art) return art;
    }
    return document.querySelector("article");
  }

  function pressKeyboardReplyShortcut() {
    const ev = new KeyboardEvent("keydown", { key: "r", code: "KeyR", keyCode: 82, which: 82, bubbles: true });
    document.dispatchEvent(ev);
  }

  async function openReplyForMainTweet(tweetId) {
    const art = findMainTweetArticle(tweetId);
    if (!art) { toast("NAV3: Main tweet not found"); throw new Error("NAV3"); }

    try { art.scrollIntoView({ behavior: "instant", block: "center" }); } catch { }
    await sleep(300);

    let btn = art.querySelector('[data-testid="reply"], [aria-label^="Reply"]');
    if (btn) {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await sleep(800);
    }

    try {
      await waitFor(() =>
        document.querySelector('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-testid*="tweetTextarea"]'),
        12000,
        120
      );
    } catch {
      pressKeyboardReplyShortcut();
      await sleep(800);
      const composer = document.querySelector('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-testid*="tweetTextarea"]');
      if (!composer) {
        toast("NAV4: Reply composer did not appear");
        throw new Error("NAV4");
      }
    }

    clearHiddenFocus();
  }

  // Optional: keep composer alive while posting
  let REPLY_WATCHDOG = null;
  function startReplyWatchdog(tweetId) {
    stopReplyWatchdog();
    REPLY_WATCHDOG = setInterval(async () => {
      const composer = document.querySelector('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-testid*="tweetTextarea"]');
      if (!composer) {
        try { await openReplyForMainTweet(tweetId); } catch { }
      }
    }, 1500);
  }
  function stopReplyWatchdog() { if (REPLY_WATCHDOG) { clearInterval(REPLY_WATCHDOG); REPLY_WATCHDOG = null; } }

  /*** Text input + submission ***/
  function tryInsertText(el, text) {
    try {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      const ok = document.execCommand("insertText", false, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
      return ok;
    } catch { return false; }
  }
  async function tryPasteEvent(el, text) {
    try {
      el.focus();
      const dt = new DataTransfer(); dt.setData("text/plain", text);
      const paste = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(paste);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: text }));
      await sleep(50);
      return (el.innerText || "").trim().length >= Math.min(1, text.length);
    } catch { return false; }
  }
  function tryRangeSet(el, text) {
    try {
      el.focus();
      const sel = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
      document.execCommand("delete");
      el.appendChild(document.createTextNode(text));
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
      return true;
    } catch { return false; }
  }
  async function typeTextReactSafe(el, text) {
    // try a few strategies; return true if editor looks non-empty
    if (tryInsertText(el, text)) return true;
    if (await tryPasteEvent(el, text)) return true;
    return tryRangeSet(el, text);
  }
  async function waitButtonEnabled(btn, maxMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const disabled = btn.disabled || btn.getAttribute("aria-disabled") === "true";
      if (!disabled) return true;
      await sleep(120);
    }
    return false;
  }
  function detectReplyRestriction() {
    const hint = document.querySelector('[role="dialog"] [data-testid="toast"], [role="dialog"] [aria-live="polite"], [role="dialog"] [aria-live="assertive"]');
    if (hint && /can.?t reply|who can reply|restricted/i.test(hint.textContent || '')) return hint.textContent.trim();
    const replyBtn = document.querySelector('[data-testid="reply"], [aria-label^="Reply"]');
    if (replyBtn && replyBtn.getAttribute('aria-disabled') === 'true') return 'Reply button disabled';
    return null;
  }
  async function submitReply(btn) {
    const rect = btn.getBoundingClientRect();
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 4 }));
    });
    await sleep(300);
    const ke = (ctrlKey = false, metaKey = false) =>
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", ctrlKey, metaKey });
    document.dispatchEvent(ke(true, false));   // Ctrl+Enter
    document.dispatchEvent(ke(false, true));   // Cmd+Enter
  }

  /*** Google Sheets handling (address bar / pubhtml / CSV) ***/
  function normalizeSheetLinkToFetchable(sheetUrl) {
    try {
      const u = new URL(sheetUrl);

      if (/\/pubhtml/i.test(u.pathname)) return { type: "html", url: sheetUrl };
      if (/\/export/i.test(u.pathname) && u.searchParams.get("format") === "csv") return { type: "csv", url: sheetUrl };

      const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (m && m[1]) {
        const fileId = m[1];
        let gid = "0";
        const hashGid = u.hash.match(/gid=(\d+)/);
        if (hashGid && hashGid[1]) gid = hashGid[1];
        const queryGid = u.searchParams.get("gid");
        if (queryGid) gid = queryGid;
        const csvUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv&gid=${gid}`;
        return { type: "csv", url: csvUrl };
      }

      if (u.hostname.includes("docs.google.com")) return { type: "html", url: sheetUrl };
      return { type: "html", url: sheetUrl };
    } catch {
      return { type: "csv", url: sheetUrl };
    }
  }
  function fetchResource(url, accept) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: { "Accept": accept },
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText);
          else reject(new Error(`Request failed (${res.status}) for ${url}`));
        },
        onerror: (e) => reject(e),
      });
    });
  }
  function parseCSV(text) {
    const rows = [];
    let cur = [], val = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], nc = text[i + 1];
      if (inQuotes) {
        if (c === '"' && nc === '"') { val += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else val += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { cur.push(val); val = ""; }
        else if (c === "\r") { }
        else if (c === "\n") { cur.push(val); rows.push(cur); cur = []; val = ""; }
        else val += c;
      }
    }
    if (val.length > 0 || cur.length > 0) { cur.push(val); rows.push(cur); }
    return rows;
  }
  function extractFirstColumnFromCSV(csvText) {
    const rows = parseCSV(csvText);
    const out = [];
    for (const r of rows) {
      if (!r || r.length === 0) continue;
      const v = String(r[0] ?? "").trim();
      if (v) out.push(v);
    }
    return out;
  }
  function extractFirstColumnFromPublishedHTML(html) {
    const tmp = document.implementation.createHTMLDocument("sheet");
    tmp.documentElement.innerHTML = html;
    const table = tmp.querySelector("table.waffle") || tmp.querySelector("table");
    if (!table) return [];
    const out = [];
    const rows = Array.from(table.querySelectorAll("tr"));
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll("td,th"));
      if (!cells.length) continue;
      const first = cells[0].innerText.trim();
      if (first) out.push(first);
    }
    return out;
  }
  async function getFirstColumnLinesFromAnySheetLink(sheetLink) {
    const normalized = normalizeSheetLinkToFetchable(sheetLink);
    if (normalized.type === "csv") {
      const text = await fetchResource(normalized.url, "text/csv");
      return extractFirstColumnFromCSV(text);
    } else {
      const html = await fetchResource(normalized.url, "text/html");
      return extractFirstColumnFromPublishedHTML(html);
    }
  }

  /*** Formatting: main text, optional keyword line, hashtag line ***/
  function cleanCellText(raw) {
    if (raw == null) return "";
    let s = String(raw)
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\r\n?/g, "\n")
      .trim();
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    s = s.split("\n").map(l => l.replace(/[ \t]+$/g, "")).join("\n");
    return s;
  }
  // <main text>
  //
  // <optional KEYWORD>
  // #hashtag
  function formatReplyWithOptionalKeyword(raw) {
    let s = cleanCellText(raw);
    s = s.replace(/\n{3,}/g, "\n\n");
    s = s.replace(/^[ \t]+(?=#)/gm, "");
    const lines = s.split("\n");
    let hashIdx = lines.findIndex(l => /^\s*#/.test(l));
    if (hashIdx === -1) return lines.join("\n").trim();

    const before = lines.slice(0, hashIdx).map(l => l.trimEnd());
    const nonEmptyBefore = before.filter(l => l.trim().length > 0);
    let keyword = "", mainBlockLines = before;
    if (nonEmptyBefore.length >= 2) {
      keyword = nonEmptyBefore[nonEmptyBefore.length - 1].trim();
      const ki = before.lastIndexOf(nonEmptyBefore[nonEmptyBefore.length - 1]);
      mainBlockLines = before.slice(0, ki);
    }
    const hashtag = lines[hashIdx].trim();
    const mainText = mainBlockLines.join("\n").trim();
    const parts = [];
    if (mainText) parts.push(mainText);
    if (parts.length) parts.push("");
    if (keyword) parts.push(keyword);
    parts.push(hashtag);
    return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /*** Posting ***/
  async function postSingleReply(text) {
    // Assumes we're already on the status page and the reply dialog is open (watchdog will reopen if needed)
    const composer = document.querySelector('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-testid*="tweetTextarea"]');
    if (!composer) { toast('R1: composer not found'); throw new Error('R1'); }

    // ensure dialog (best effort)
    const dialog = document.querySelector('[role="dialog"], [data-testid="modalDialog"]');
    if (!dialog) {
      const replyBtn = document.querySelector('[data-testid="reply"]');
      if (replyBtn) replyBtn.click();
    }

    await ensureComposerFocus(composer);
    clearHiddenFocus();

    await typeTextReactSafe(composer, text);
    await nudgeEditorEnable(composer);
    await sleep(250);

    const scope = dialog || document;
    const sendBtn = scope.querySelector([
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
      '[data-testid="sendTweetButton"]',
      'div[role="button"][data-testid*="tweetButton"]',
      'div[role="button"][aria-label^="Post"]',
      'div[role="button"][aria-label^="Reply"]',
      'button[aria-label^="Post"]',
      'button[aria-label^="Reply"]'
    ].join(', '));
    if (!sendBtn) { toast('R2: send button not found'); throw new Error('R2'); }

    const enabled = await waitButtonEnabled(sendBtn, 12000);
    if (!enabled) {
      await nudgeEditorEnable(composer);
      const reason = detectReplyRestriction();
      toast(`R3: button not enabled ${reason ? `(${reason})` : ''}`);
      throw new Error('R3');
    }

    await submitReply(sendBtn);
    await sleep(1600);

    // Heuristic: cleared / dialog closed
    for (let i = 0; i < 80; i++) {
      const c = document.querySelector('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-testid*="tweetTextarea"]');
      if (!c) break;
      if (c.innerText.trim().length === 0) break;
      await sleep(100);
    }
  }

  /*** Main ***/
  els.stopBtn.addEventListener("click", () => { ABORT = true; stopReplyWatchdog(); logStatus("Stopping…"); });

  els.startBtn.addEventListener("click", async () => {
    try {
      saveInputs();
      ABORT = false;

      const tweetUrl = els.tweetUrl.value.trim();
      const sheetLink = els.sheetAny.value.trim();
      const count = Math.max(1, parseInt(els.count.value || "1", 10));
      const delayMs = Math.max(0, parseInt(els.delay.value || "5000", 10));

      if (!tweetUrl) return alert("Paste a tweet URL.");
      if (!sheetLink) return alert("Paste a public Google Sheet link.");

      const tweetId = extractTweetIdFromUrl(tweetUrl);
      if (!tweetId) return alert("Could not extract Tweet ID from the URL.");

      logStatus("Fetching Google Sheet…");
      const rawLines = await getFirstColumnLinesFromAnySheetLink(sheetLink);

      const formatted = rawLines
        .map(formatReplyWithOptionalKeyword)
        .map(s => s.trim())
        .filter(s => s.length > 0);

      const shuffled = formatted.sort(() => Math.random() - 0.5);
      const replies = shuffled.slice(0, count);
      if (replies.length === 0) { toast('R0: sheet produced 0 usable rows'); return; }

      logStatus(`Loaded ${replies.length} replies. Navigating…`);
      await navigateToTweet(tweetId);
      await openReplyForMainTweet(tweetId);
      startReplyWatchdog(tweetId);

      for (let i = 0; i < replies.length; i++) {
        if (ABORT) { logStatus("Stopped."); break; }
        clearHiddenFocus();
        logStatus(`Replying ${i + 1}/${replies.length}…`);
        await postSingleReply(replies[i]);
        if (i < replies.length - 1 && delayMs > 0) {
          logStatus(`Waiting ${delayMs} ms…`);
          await sleep(delayMs);
        }
      }

      stopReplyWatchdog();
      if (!ABORT){
        logStatus("All done ✅");
        alert("All done ✅");
      }
    } catch (err) {
      stopReplyWatchdog();
      console.error(err);
      logStatus("Error: " + (err && err.message ? err.message : String(err)));
      alert("Error: " + (err && err.message ? err.message : String(err)));
    }
  });

  console.info("[XRW] Respect X/Twitter rules and rate limits. Content is posted verbatim from your sheet.");
})();
