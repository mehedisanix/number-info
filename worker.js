const UPSTREAM_BASE = "https://bd-lookup-apicc.vercel.app/api/look";
const DEFAULT_ADMIN_PASSWORD = "5274100";
const CHANNEL_URL = "https://t.me/CobraX_Empire";
const CHANNEL_HANDLE = "@CobraX_Empire";
const API_OWNER = "@MehediSanix";
const DEVELOPER = "@XrootCodeX";

const MEMORY_STATE = {
  apiEnabled: true,
  totalRequests: 0,
  successRequests: 0,
  emptyRequests: 0,
  blockedRequests: 0,
  uniqueClients: {},
  channelUsage: {},
  queriedNumbers: {},
  recentLogs: []
};

export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);
    const pathname = urlObj.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-password"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders
        }
      });
    };

    const htmlResponse = (html, status = 200) => {
      return new Response(html, {
        status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders
        }
      });
    };

    const kv = env && env.API_KV ? env.API_KV : null;
    const adminPass = (env && env.ADMIN_PASSWORD) ? String(env.ADMIN_PASSWORD) : DEFAULT_ADMIN_PASSWORD;
    const state = await loadState(kv);

    // ⌬ Admin Panel UI
    if (pathname === "/admin" && request.method === "GET") {
      return htmlResponse(renderAdminPanelHtml(state.apiEnabled), 200);
    }

    // ⌘ Admin Control & Analytics API
    if (pathname.startsWith("/admin/api/")) {
      const providedPass = request.headers.get("x-admin-password") || "";
      let bodyData = {};
      if (request.method === "POST") {
        try {
          bodyData = await request.json();
        } catch {
          bodyData = {};
        }
      }

      const authPass = providedPass || bodyData.password || "";
      if (!authPass || authPass !== adminPass) {
        return jsonResponse({ error: "⎋ ভুল পাসওয়ার্ড! সঠিক এডমিন পাসওয়ার্ড দিন।" }, 401);
      }

      if (pathname === "/admin/api/stats" && request.method === "GET") {
        return jsonResponse({
          apiEnabled: state.apiEnabled,
          storageMode: kv ? "Cloudflare KV (Persistent)" : "Worker Memory",
          totalRequests: state.totalRequests,
          successRequests: state.successRequests,
          emptyRequests: state.emptyRequests,
          blockedRequests: state.blockedRequests,
          uniqueClientsCount: Object.keys(state.uniqueClients).length,
          channelsCount: Object.keys(state.channelUsage).length,
          queriedNumbersCount: Object.keys(state.queriedNumbers).length,
          clients: sortTop(state.uniqueClients, "requests", 40),
          channels: sortTop(state.channelUsage, "requests", 40),
          topNumbers: sortTop(state.queriedNumbers, "count", 30),
          recentLogs: state.recentLogs.slice(0, 60)
        }, 200);
      }

      if (pathname === "/admin/api/toggle" && request.method === "POST") {
        state.apiEnabled = typeof bodyData.enabled === "boolean" ? bodyData.enabled : !state.apiEnabled;
        await saveState(kv, state);
        return jsonResponse({
          ok: true,
          apiEnabled: state.apiEnabled,
          message: state.apiEnabled ? "⍟ API চালু (ONLINE) করা হয়েছে।" : "⎋ API বন্ধ (OFFLINE) করা হয়েছে।"
        }, 200);
      }

      if (pathname === "/admin/api/reset" && request.method === "POST") {
        state.totalRequests = 0;
        state.successRequests = 0;
        state.emptyRequests = 0;
        state.blockedRequests = 0;
        state.uniqueClients = {};
        state.channelUsage = {};
        state.queriedNumbers = {};
        state.recentLogs = [];
        await saveState(kv, state);
        return jsonResponse({ ok: true, message: "⟴ সমস্ত স্ট্যাটস ও লগ রিসেট করা হয়েছে।" }, 200);
      }

      return jsonResponse({ error: "Admin endpoint not found." }, 404);
    }

    // ⌖ Request Metadata Extraction
    const clientIp =
      request.headers.get("cf-connecting-ip") ||
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const referer = request.headers.get("referer") || "";
    const channelHint = extractChannelHint(urlObj, request.headers, referer);
    const cfInfo = request.cf || {};
    const country = cfInfo.country || "Unknown";
    const city = cfInfo.city || "";
    const isp = cfInfo.asOrganization || "Unknown ISP";

    const rawNumb = (
      urlObj.searchParams.get("numb") ||
      urlObj.searchParams.get("number") ||
      urlObj.searchParams.get("phone") ||
      ""
    ).trim();

    // ⎋ API Disabled Notice Page
    if (!state.apiEnabled) {
      state.totalRequests += 1;
      state.blockedRequests += 1;
      recordBaseAnalytics(state, {
        ip: clientIp,
        country,
        city,
        isp,
        channelHint,
        target: rawNumb || "-",
        status: "OFFLINE_BLOCKED"
      });
      await saveState(kv, state);

      const wantsJson =
        urlObj.searchParams.get("format") === "json" ||
        ((request.headers.get("accept") || "").includes("application/json") &&
          !(request.headers.get("accept") || "").includes("text/html"));

      if (wantsJson) {
        return jsonResponse({
          status: "disabled",
          error: "API সাময়িকভাবে বন্ধ রাখা হয়েছে",
          reason: "কপিবাজরা আমাদের API নিয়ে নিজেদের চ্যানেলে ব্যবহার করছিল, যার কারণে এটি সাময়িকভাবে বন্ধ করা হলো।",
          channel: CHANNEL_URL,
          Api_Owner: API_OWNER,
          Telegram: CHANNEL_HANDLE,
          Developer: DEVELOPER
        }, 503);
      }

      return htmlResponse(renderApiDisabledHtml(), 503);
    }

    // ⍟ Main BD Lookup Execution
    try {
      if (!rawNumb) {
        state.totalRequests += 1;
        state.emptyRequests += 1;
        recordBaseAnalytics(state, {
          ip: clientIp,
          country,
          city,
          isp,
          channelHint,
          target: "-",
          status: "MISSING_PARAM"
        });
        await saveState(kv, state);

        return jsonResponse({
          success: false,
          error: "Missing 'numb' parameter. Example: ?numb=01775274100",
          Api_Owner: API_OWNER,
          Telegram: CHANNEL_HANDLE,
          Developer: DEVELOPER
        }, 400);
      }

      const upstreamUrl = `${UPSTREAM_BASE}?numb=${encodeURIComponent(rawNumb)}`;
      const upstreamRes = await fetch(upstreamUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 14; Vivo Y19s) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      });

      const rawText = await upstreamRes.text();
      let parsedUpstream = null;

      try {
        parsedUpstream = JSON.parse(rawText);
      } catch {
        parsedUpstream = { raw_text: rawText.trim() };
      }

      const hasData = detectFoundData(parsedUpstream);
      const isOk = upstreamRes.ok && hasData;

      state.totalRequests += 1;
      if (isOk) {
        state.successRequests += 1;
      } else {
        state.emptyRequests += 1;
      }

      recordBaseAnalytics(state, {
        ip: clientIp,
        country,
        city,
        isp,
        channelHint,
        target: rawNumb,
        status: isOk ? "FOUND" : "NOT_FOUND"
      });
      await saveState(kv, state);

      return jsonResponse({
        query: {
          number: rawNumb,
          service: "BD Number Lookup",
          success: isOk,
          channel_source: channelHint
        },
        result: parsedUpstream,
        Api_Owner: API_OWNER,
        Telegram: CHANNEL_HANDLE,
        Developer: DEVELOPER
      }, upstreamRes.ok ? 200 : 502);

    } catch (err) {
      state.totalRequests += 1;
      state.emptyRequests += 1;
      recordBaseAnalytics(state, {
        ip: clientIp,
        country,
        city,
        isp,
        channelHint,
        target: rawNumb || "-",
        status: "ERROR"
      });
      await saveState(kv, state);

      return jsonResponse({
        success: false,
        error: "Internal server error.",
        details: err.message,
        Api_Owner: API_OWNER,
        Telegram: CHANNEL_HANDLE,
        Developer: DEVELOPER
      }, 500);
    }
  }
};

function detectFoundData(payload) {
  if (!payload) return false;
  if (typeof payload === "string") return payload.trim().length > 0;
  if (Array.isArray(payload)) return payload.length > 0;
  if (typeof payload === "object") {
    if (payload.success === false || payload.status === false) return false;
    if (Array.isArray(payload.data)) return payload.data.length > 0;
    if (Array.isArray(payload.result)) return payload.result.length > 0;
    if (payload.data && typeof payload.data === "object") return Object.keys(payload.data).length > 0;
    if (payload.result && typeof payload.result === "object") return Object.keys(payload.result).length > 0;
    const keys = Object.keys(payload).filter(k => k !== "raw_text" && k !== "status" && k !== "success");
    return keys.length > 0;
  }
  return false;
}

async function loadState(kv) {
  if (kv) {
    try {
      const saved = await kv.get("bd_lookup_panel_state_v1", { type: "json" });
      if (saved && typeof saved === "object") {
        return {
          apiEnabled: typeof saved.apiEnabled === "boolean" ? saved.apiEnabled : true,
          totalRequests: Number(saved.totalRequests) || 0,
          successRequests: Number(saved.successRequests) || 0,
          emptyRequests: Number(saved.emptyRequests) || 0,
          blockedRequests: Number(saved.blockedRequests) || 0,
          uniqueClients: saved.uniqueClients && typeof saved.uniqueClients === "object" ? saved.uniqueClients : {},
          channelUsage: saved.channelUsage && typeof saved.channelUsage === "object" ? saved.channelUsage : {},
          queriedNumbers: saved.queriedNumbers && typeof saved.queriedNumbers === "object" ? saved.queriedNumbers : {},
          recentLogs: Array.isArray(saved.recentLogs) ? saved.recentLogs : []
        };
      }
    } catch {
      // Fallback to memory state
    }
  }
  return MEMORY_STATE;
}

async function saveState(kv, state) {
  MEMORY_STATE.apiEnabled = state.apiEnabled;
  MEMORY_STATE.totalRequests = state.totalRequests;
  MEMORY_STATE.successRequests = state.successRequests;
  MEMORY_STATE.emptyRequests = state.emptyRequests;
  MEMORY_STATE.blockedRequests = state.blockedRequests;
  MEMORY_STATE.uniqueClients = state.uniqueClients;
  MEMORY_STATE.channelUsage = state.channelUsage;
  MEMORY_STATE.queriedNumbers = state.queriedNumbers;
  MEMORY_STATE.recentLogs = state.recentLogs.slice(0, 60);

  if (kv) {
    try {
      await kv.put("bd_lookup_panel_state_v1", JSON.stringify(MEMORY_STATE));
    } catch {
      // Ignore KV write failure
    }
  }
}

function extractChannelHint(urlObj, headers, referer) {
  const explicit =
    urlObj.searchParams.get("channel") ||
    urlObj.searchParams.get("source") ||
    urlObj.searchParams.get("ref") ||
    headers.get("x-channel") ||
    "";

  if (explicit.trim()) {
    return explicit.trim().slice(0, 80);
  }

  if (referer) {
    try {
      const refUrl = new URL(referer);
      return `${refUrl.hostname}${refUrl.pathname}`.slice(0, 80);
    } catch {
      return referer.slice(0, 80);
    }
  }

  return "Direct / Bot Request";
}

function recordBaseAnalytics(state, info) {
  const nowIso = new Date().toISOString();

  if (!state.uniqueClients[info.ip]) {
    state.uniqueClients[info.ip] = {
      ip: info.ip,
      country: info.country,
      city: info.city,
      isp: info.isp,
      requests: 0,
      lastSeen: nowIso,
      lastChannel: info.channelHint
    };
  }
  state.uniqueClients[info.ip].requests += 1;
  state.uniqueClients[info.ip].lastSeen = nowIso;
  state.uniqueClients[info.ip].lastChannel = info.channelHint;
  if (info.country && info.country !== "Unknown") state.uniqueClients[info.ip].country = info.country;
  if (info.isp && info.isp !== "Unknown ISP") state.uniqueClients[info.ip].isp = info.isp;

  if (!state.channelUsage[info.channelHint]) {
    state.channelUsage[info.channelHint] = {
      channel: info.channelHint,
      requests: 0,
      lastUsed: nowIso
    };
  }
  state.channelUsage[info.channelHint].requests += 1;
  state.channelUsage[info.channelHint].lastUsed = nowIso;

  if (info.target && info.target !== "-") {
    if (!state.queriedNumbers[info.target]) {
      state.queriedNumbers[info.target] = {
        number: info.target,
        count: 0,
        lastStatus: info.status,
        lastSeen: nowIso
      };
    }
    state.queriedNumbers[info.target].count += 1;
    state.queriedNumbers[info.target].lastStatus = info.status;
    state.queriedNumbers[info.target].lastSeen = nowIso;
  }

  state.recentLogs.unshift({
    time: nowIso,
    ip: info.ip,
    country: info.country,
    channel: info.channelHint,
    target: info.target || "-",
    status: info.status
  });
  if (state.recentLogs.length > 60) {
    state.recentLogs.length = 60;
  }
}

function sortTop(obj, key, limit) {
  return Object.values(obj)
    .sort((a, b) => (b[key] || 0) - (a[key] || 0))
    .slice(0, limit);
}

function renderApiDisabledHtml() {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>⎋ Notice • API সাময়িকভাবে বন্ধ রাখা হয়েছে</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@500&family=Hind+Siliguri:wght@400;600;700&family=Orbitron:wght@600;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background:
        radial-gradient(circle at 18% 18%, rgba(245, 178, 53, 0.16), transparent 45%),
        radial-gradient(circle at 82% 82%, rgba(0, 229, 255, 0.13), transparent 45%),
        #05080b;
      color: #eef6f1;
      font-family: 'Hind Siliguri', sans-serif;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: rgba(11, 18, 20, 0.95);
      border: 1px solid rgba(245, 178, 53, 0.38);
      border-radius: 24px;
      padding: 32px 24px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75), 0 0 38px rgba(245, 178, 53, 0.14);
    }
    .top-badge {
      display: inline-block;
      font-family: 'Orbitron', sans-serif;
      font-size: 11px;
      letter-spacing: 1.5px;
      color: #f5b235;
      background: rgba(245, 178, 53, 0.12);
      border: 1px solid rgba(245, 178, 53, 0.32);
      padding: 5px 13px;
      border-radius: 999px;
      margin-bottom: 18px;
    }
    .warn-box {
      width: 68px;
      height: 68px;
      margin: 0 auto 20px;
      border-radius: 18px;
      background: linear-gradient(145deg, #ffd166, #d98a14);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 28px rgba(245, 178, 53, 0.36);
      font-family: 'Orbitron', sans-serif;
      font-size: 28px;
      font-weight: 800;
      color: #161103;
    }
    h1 {
      font-size: 25px;
      line-height: 1.35;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 14px;
    }
    .reason {
      font-size: 15px;
      line-height: 1.65;
      color: #c8d8cf;
      margin-bottom: 22px;
    }
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.16), transparent);
      margin: 18px 0;
    }
    .cta-note {
      font-size: 14.5px;
      line-height: 1.6;
      color: #dcebe3;
      margin-bottom: 20px;
    }
    .join-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 18px;
      border-radius: 14px;
      text-decoration: none;
      font-size: 16px;
      font-weight: 700;
      color: #151003;
      background: linear-gradient(135deg, #ffd166, #e69c20);
      box-shadow: 0 10px 25px rgba(230, 156, 32, 0.35);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .join-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 30px rgba(230, 156, 32, 0.5);
    }
    .channel-link {
      display: inline-block;
      margin-top: 18px;
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      color: #8eb3a1;
      text-decoration: none;
    }
    .channel-link:hover {
      color: #ffd166;
    }
    .meta-tag {
      margin-top: 14px;
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      color: #6b8579;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="top-badge">⌬ NOTICE • SERVICE PAUSED</div>
    <div class="warn-box">⎋</div>
    <h1>API সাময়িকভাবে বন্ধ রাখা হয়েছে</h1>
    <p class="reason">
      কপিবাজরা আমাদের API নিয়ে নিজেদের চ্যানেলে ব্যবহার করছিল, যার কারণে এটি সাময়িকভাবে বন্ধ করা হলো।
    </p>
    <div class="divider"></div>
    <p class="cta-note">
      নতুন আপডেট ও ভালো মানের টুলস, API সবার আগে পেতে আমাদের অফিসিয়াল চ্যানেলে জয়েন থাকুন।
    </p>
    <a class="join-btn" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer">
      <span>⟴ অফিসিয়াল চ্যানেলে জয়েন করুন</span>
    </a>
    <a class="channel-link" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer">t.me/CobraX_Empire</a>
    <div class="meta-tag">⌘ ${API_OWNER} • ${DEVELOPER}</div>
  </div>
</body>
</html>`;
}

function renderAdminPanelHtml(initialEnabled) {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>⌬ Admin Panel • BD Lookup Control</title>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&family=Hind+Siliguri:wght@400;600;700&family=Orbitron:wght@600;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at top right, #0d1d3a, #050811 58%);
      color: #e8eeff;
      font-family: 'Hind Siliguri', sans-serif;
      padding: 18px;
      min-height: 100vh;
    }
    .wrap { max-width: 1020px; margin: 0 auto; }
    .panel {
      background: rgba(12, 18, 34, 0.94);
      border: 1px solid rgba(0, 229, 255, 0.25);
      border-radius: 18px;
      padding: 20px;
      margin-bottom: 18px;
      box-shadow: 0 12px 35px rgba(0,0,0,0.48);
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 8px;
    }
    h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: 19px;
      color: #00e5ff;
      letter-spacing: 1px;
    }
    .badge-storage {
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      padding: 5px 10px;
      border-radius: 999px;
      background: rgba(0, 229, 255, 0.12);
      border: 1px solid rgba(0, 229, 255, 0.3);
      color: #7eeeff;
    }
    .sub { font-size: 13.5px; color: #9fb0d9; margin-bottom: 15px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    input {
      flex: 1;
      min-width: 200px;
      padding: 11px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.2);
      background: #080c18;
      color: #fff;
      font-family: 'Fira Code', monospace;
    }
    button {
      padding: 11px 16px;
      border: none;
      border-radius: 10px;
      font-weight: 700;
      cursor: pointer;
      font-family: 'Hind Siliguri', sans-serif;
      font-size: 14px;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    .btn-primary { background: #00d4ff; color: #051018; }
    .btn-on { background: #00e676; color: #04180c; }
    .btn-off { background: #ff4757; color: #fff; }
    .btn-ghost { background: rgba(255,255,255,0.1); color: #fff; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .stat-card {
      background: #090e1e;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 14px;
    }
    .stat-label { font-size: 12px; color: #94a5cf; }
    .stat-val {
      font-family: 'Orbitron', sans-serif;
      font-size: 20px;
      margin-top: 5px;
      color: #fff;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 12.5px;
    }
    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      font-family: 'Fira Code', monospace;
      white-space: nowrap;
    }
    th { color: #7cd6ff; font-size: 11.5px; }
    .pill-on { color: #00e676; }
    .pill-off { color: #ff5252; }
    .tag-found { color: #00e676; }
    .tag-miss { color: #ffb74d; }
    .tag-block { color: #ff5252; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <div class="header-top">
        <h1>⌬ ADMIN CONTROL PANEL</h1>
        <span class="badge-storage" id="storageBadge">⎔ STORAGE: CHECKING</span>
      </div>
      <div class="sub">⌘ API অন/অফ নিয়ন্ত্রণ, মোট রিকোয়েস্ট, সাকসেস রেট, IP লোকেশন এবং চ্যানেল/সোর্স মনিটরিং • ${CHANNEL_HANDLE}</div>
      <div class="row">
        <input type="password" id="adminPass" placeholder="Admin Password দিন..." />
        <button class="btn-primary" onclick="loadStats()">⌖ Login & Refresh</button>
        <button id="toggleBtn" class="${initialEnabled ? 'btn-off' : 'btn-on'}" onclick="toggleApi()">
          ${initialEnabled ? '⎋ API বন্ধ করুন (OFF)' : '⍟ API চালু করুন (ON)'}
        </button>
        <button class="btn-ghost" onclick="resetStats()">⟴ Reset Stats</button>
      </div>
      <div class="stats">
        <div class="stat-card">
          <div class="stat-label">API STATUS</div>
          <div class="stat-val" id="apiStatusText">${initialEnabled ? 'ONLINE' : 'OFFLINE'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">TOTAL REQUESTS</div>
          <div class="stat-val" id="totalReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">DATA FOUND</div>
          <div class="stat-val pill-on" id="successReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">NOT FOUND / EMPTY</div>
          <div class="stat-val tag-miss" id="emptyReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">BLOCKED (OFFLINE)</div>
          <div class="stat-val pill-off" id="blockedReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">UNIQUE CLIENTS (IP)</div>
          <div class="stat-val" id="clientsCountText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">CHANNELS / SOURCES</div>
          <div class="stat-val" id="channelsCountText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">UNIQUE NUMBERS</div>
          <div class="stat-val" id="numbersCountText">0</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h2 style="font-size:16px;color:#ffd166;">⌖ চ্যানেল / রেফারেল সোর্স (Channels & Sources)</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Channel / Source</th><th>Requests</th><th>Last Used</th></tr>
            </thead>
            <tbody id="channelsTable"></tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <h2 style="font-size:16px;color:#00e676;">⍟ সবচেয়ে বেশি সার্চ হওয়া নম্বর</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Number</th><th>Searches</th><th>Last Status</th></tr>
            </thead>
            <tbody id="numbersTable"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2 style="font-size:16px;color:#00e5ff;">⌘ কারা রিকোয়েস্ট করছে (Clients by IP, Country & ISP)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>IP Address</th><th>Country</th><th>ISP / Org</th><th>Requests</th><th>Channel / Source</th><th>Last Seen</th></tr>
          </thead>
          <tbody id="clientsTable"></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h2 style="font-size:16px;color:#ff8a65;">⟴ সাম্প্রতিক লাইভ রিকোয়েস্ট লগ (Recent Activity)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Time (UTC)</th><th>IP</th><th>Country</th><th>Number</th><th>Channel</th><th>Status</th></tr>
          </thead>
          <tbody id="logsTable"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const savedPass = sessionStorage.getItem("worker_admin_pass") || "";
    if (savedPass) document.getElementById("adminPass").value = savedPass;

    function getPass() {
      const p = document.getElementById("adminPass").value.trim();
      if (p) sessionStorage.setItem("worker_admin_pass", p);
      return p;
    }

    async function loadStats() {
      const pass = getPass();
      if (!pass) return alert("Admin password দিন");
      const res = await fetch("/admin/api/stats", {
        headers: { "x-admin-password": pass }
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed");

      document.getElementById("storageBadge").textContent = "⎔ STORAGE: " + (data.storageMode || "MEMORY");

      const statusEl = document.getElementById("apiStatusText");
      const toggleBtn = document.getElementById("toggleBtn");
      statusEl.textContent = data.apiEnabled ? "ONLINE" : "OFFLINE";
      statusEl.className = "stat-val " + (data.apiEnabled ? "pill-on" : "pill-off");
      toggleBtn.textContent = data.apiEnabled ? "⎋ API বন্ধ করুন (OFF)" : "⍟ API চালু করুন (ON)";
      toggleBtn.className = data.apiEnabled ? "btn-off" : "btn-on";

      document.getElementById("totalReqText").textContent = data.totalRequests;
      document.getElementById("successReqText").textContent = data.successRequests;
      document.getElementById("emptyReqText").textContent = data.emptyRequests;
      document.getElementById("blockedReqText").textContent = data.blockedRequests;
      document.getElementById("clientsCountText").textContent = data.uniqueClientsCount;
      document.getElementById("channelsCountText").textContent = data.channelsCount;
      document.getElementById("numbersCountText").textContent = data.queriedNumbersCount;

      document.getElementById("channelsTable").innerHTML = (data.channels || []).map(c =>
        \`<tr><td>\${esc(c.channel)}</td><td>\${c.requests}</td><td>\${esc(formatTime(c.lastUsed))}</td></tr>\`
      ).join("") || \`<tr><td colspan="3">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("numbersTable").innerHTML = (data.topNumbers || []).map(u =>
        \`<tr><td>\${esc(u.number)}</td><td>\${u.count}</td><td class="\${statusCls(u.lastStatus)}">\${esc(u.lastStatus)}</td></tr>\`
      ).join("") || \`<tr><td colspan="3">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("clientsTable").innerHTML = (data.clients || []).map(cl =>
        \`<tr><td>\${esc(cl.ip)}</td><td>\${esc(cl.country || "-")}</td><td>\${esc(cl.isp || "-")}</td><td>\${cl.requests}</td><td>\${esc(cl.lastChannel || "-")}</td><td>\${esc(formatTime(cl.lastSeen))}</td></tr>\`
      ).join("") || \`<tr><td colspan="6">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("logsTable").innerHTML = (data.recentLogs || []).map(l =>
        \`<tr><td>\${esc(formatTime(l.time))}</td><td>\${esc(l.ip)}</td><td>\${esc(l.country || "-")}</td><td>\${esc(l.target)}</td><td>\${esc(l.channel)}</td><td class="\${statusCls(l.status)}">\${esc(l.status)}</td></tr>\`
      ).join("") || \`<tr><td colspan="6">কোনো লগ নেই</td></tr>\`;
    }

    async function toggleApi() {
      const pass = getPass();
      if (!pass) return alert("Admin password দিন");
      const res = await fetch("/admin/api/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": pass
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed");
      loadStats();
    }

    async function resetStats() {
      const pass = getPass();
      if (!pass) return alert("Admin password দিন");
      if (!confirm("সব স্ট্যাটস ও লগ মুছে ফেলবেন?")) return;
      const res = await fetch("/admin/api/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": pass
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed");
      loadStats();
    }

    function statusCls(st) {
      if (st === "FOUND") return "tag-found";
      if (st === "OFFLINE_BLOCKED") return "tag-block";
      return "tag-miss";
    }

    function formatTime(iso) {
      if (!iso) return "-";
      return iso.replace("T", " ").slice(0, 19);
    }

    function esc(str) {
      return String(str).replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[m]));
    }

    if (savedPass) loadStats();
  </script>
</body>
</html>`;
}
