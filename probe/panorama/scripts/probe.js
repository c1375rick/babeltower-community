/**
 * LCT CEF PROBE v1
 *
 * 只回答三个问题:
 *   Q1 隐藏 CitadelHTMLPanel 能否加载远程 https 页面(全程无本地进程)
 *   Q2 重复 SetURL 是否每次都能触发加载(含 query 变化 / 仅 hash 变化)
 *   Q3 document.title 能否通过引擎事件回到游戏,延迟多少
 *
 * 输出:聊天框上方的 LCTProbeBox(打开聊天可见),同时 $.Msg 一份。
 * 不含任何翻译逻辑,不改动游戏行为。
 */
(function () {
  "use strict";

  var PANEL_ID = "LCTProbe";
  var TEXT_ID = "LCTProbeText";

  var EVENTS = [
    "HTMLContentLoaded",
    "HTMLLoadPage",
    "HTMLStartRequest",
    "HTMLFinishRequest",
    "HTMLURLChanged",
    "HTMLChangedTitle",
    "HTMLTitle"
  ];

  // 四次顺序导航:覆盖首载 / query 变化 / hash 变化 / 仅 hash 变化
  var NAVS = [
    { tag: "N0", url: "https://example.com/" },
    { tag: "N1", url: "https://example.com/?lct=2" },
    { tag: "N2", url: "https://example.com/?lct=2#hash-a" },
    { tag: "N3", url: "https://example.com/?lct=2#hash-b" }
  ];

  var BURST = [
    "https://example.com/?burst=1",
    "https://example.com/?burst=2",
    "https://example.com/?burst=3",
    "https://example.com/?burst=4",
    "https://example.com/?burst=5"
  ];

  var NAV_TIMEOUT_S = 8;
  var BURST_GAP_S = 0.3;
  var BURST_SETTLE_S = 6;

  var S = {
    panel: null,
    phase: "boot",
    navIndex: -1,
    token: 0,
    t0: 0,
    cur: null,
    results: [],
    eventCounts: {},
    titleEvents: 0,
    burstSent: 0,
    burstTitles: 0,
    done: false,
    lines: []
  };

  function now() {
    return Date.now ? Date.now() : 0;
  }

  function isValid(p) {
    return !!(p && (!p.IsValid || p.IsValid()));
  }

  function getRoot() {
    try {
      var r = $.GetContextPanel();
      while (r && r.GetParent && r.GetParent()) r = r.GetParent();
      return r;
    } catch (e) {
      return null;
    }
  }

  function findChild(root, id) {
    if (!isValid(root) || typeof root.FindChildTraverse !== "function") return null;
    try {
      var p = root.FindChildTraverse(id);
      return isValid(p) ? p : null;
    } catch (e) {
      return null;
    }
  }

  function setLine(i, text) {
    S.lines[i] = text;
    render();
  }

  function render() {
    var root = getRoot();
    var lbl = findChild(root, TEXT_ID);
    if (!lbl) return;
    try {
      lbl.text = S.lines.join("\n");
    } catch (e) {}
  }

  function msg(s) {
    try { $.Msg("[LCTPROBE] " + s); } catch (e) {}
  }

  function pickText(args) {
    for (var i = 0; i < args.length; i += 1) {
      var v = args[i];
      if (v == null) continue;
      if (typeof v === "string") {
        if (v) return v;
        continue;
      }
      try { if (typeof v.title === "string" && v.title) return v.title; } catch (e) {}
      try { if (typeof v.url === "string" && v.url) return v.url; } catch (e) {}
      try { if (typeof v.text === "string" && v.text) return v.text; } catch (e) {}
      try {
        if (typeof v.GetAttributeString === "function") {
          var t = v.GetAttributeString("title", "");
          if (t) return t;
        }
      } catch (e) {}
    }
    return "";
  }

  function short(s, n) {
    var t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "..." : t;
  }

  // ---------------- 导航状态机 ----------------

  function startNav(i) {
    if (i >= NAVS.length) {
      startBurst();
      return;
    }
    S.navIndex = i;
    var nav = NAVS[i];
    var token = (S.token += 1);
    S.t0 = now();
    S.cur = { tag: nav.tag, url: nav.url, start: S.t0, loadMs: 0, urlMs: 0, title: "", titleMs: 0, prop: "" };
    S.phase = "nav";

    setLine(2, nav.tag + " -> " + nav.url);
    msg(nav.tag + " SetURL " + nav.url);

    var ok = true;
    try {
      if (typeof S.panel.SetURL !== "function") ok = false;
      else S.panel.SetURL(nav.url);
    } catch (e) {
      ok = false;
      msg(nav.tag + " SetURL THREW " + (e && e.message ? e.message : String(e)));
    }

    if (!ok) finishNav("SETURL_FAIL");

    try {
      $.Schedule(NAV_TIMEOUT_S, function () {
        if (token !== S.token) return;
        finishNav("TIMEOUT");
      });
    } catch (e) {}
  }

  function finishNav(reason) {
    var cur = S.cur;
    if (!cur) return;
    S.cur = null;
    S.token += 1;

    var prop = "";
    try { prop = String(S.panel && S.panel.title ? S.panel.title : ""); } catch (e) { prop = "throw"; }
    cur.prop = prop;

    var titleShown = cur.title ? ('"' + short(cur.title, 40) + '"') : "(none)";
    var line =
      cur.tag + " " +
      (reason === "TIMEOUT" ? "TIMEOUT " : "") +
      "load=" + (cur.loadMs ? cur.loadMs + "ms" : "-") +
      " title=" + (cur.titleMs ? cur.titleMs + "ms " : "- ") + titleShown +
      " prop=" + (prop ? short(prop, 20) : "-");

    S.results.push(line);
    var idx = 3 + S.results.length - 1;
    setLine(idx, line);
    msg(line);

    if (S.navIndex + 1 < NAVS.length) {
      try { $.Schedule(0.5, function () { startNav(S.navIndex + 1); }); } catch (e) {}
    } else {
      try { $.Schedule(0.5, function () { startBurst(); }); } catch (e) {}
    }
  }

  function startBurst() {
    S.phase = "burst";
    var base = 3 + NAVS.length + 1;
    setLine(base, "BURST sending " + BURST.length + " nav @ " + BURST_GAP_S + "s ...");
    for (var i = 0; i < BURST.length; i += 1) {
      (function (n) {
        try {
          $.Schedule(n * BURST_GAP_S, function () {
            S.burstSent += 1;
            try { S.panel.SetURL(BURST[n]); } catch (e) {}
          });
        } catch (e) {}
      })(i);
    }
    try {
      $.Schedule(BURST.length * BURST_GAP_S + BURST_SETTLE_S, finalize);
    } catch (e) {}
  }

  function finalize() {
    if (S.done) return;
    S.done = true;
    S.phase = "done";

    var loadOk = 0;
    var titleOk = 0;
    for (var i = 0; i < S.results.length; i += 1) {
      if (S.results[i].indexOf("load=") !== -1 && S.results[i].indexOf("load=-") === -1) loadOk += 1;
      if (S.results[i].indexOf("title=- ") === -1) titleOk += 1;
    }

    var evLine = "EVENTS ";
    var keys = Object.keys(S.eventCounts);
    for (var k = 0; k < keys.length; k += 1) {
      evLine += keys[k] + "=" + S.eventCounts[keys[k]] + " ";
    }

    var base = 3 + NAVS.length + 1;
    setLine(base + 1, evLine || "EVENTS (none)");
    setLine(base + 2, "BURST sent=" + S.burstSent + " titles=" + S.burstTitles);
    setLine(base + 3, "VERDICT load=" + loadOk + "/" + NAVS.length + " title=" + titleOk + "/" + NAVS.length +
      " remote=" + (loadOk > 0 ? "YES" : "NO"));

    msg("FINAL load=" + loadOk + "/" + NAVS.length + " title=" + titleOk + "/" + NAVS.length);
  }

  // ---------------- 事件入口 ----------------

  function onEvent(name, a, b, c, d) {
    S.eventCounts[name] = (S.eventCounts[name] || 0) + 1;

    var text = pickText([a, b, c, d]);

    if (S.phase === "burst") {
      if (name.indexOf("Title") !== -1 && text) S.burstTitles += 1;
      return;
    }

    var cur = S.cur;
    if (!cur || S.phase !== "nav") return;

    var dt = now() - cur.start;

    if (name.indexOf("Load") !== -1 && !cur.loadMs) cur.loadMs = dt;
    if (name.indexOf("URL") !== -1 && !cur.urlMs) cur.urlMs = dt;

    if (name.indexOf("Title") !== -1 && text && !cur.title) {
      cur.title = text;
      cur.titleMs = dt;
      S.titleEvents += 1;
      // 拿到标题即视为本次导航完成
      try { $.Schedule(0.1, function () { finishNav("TITLE"); }); } catch (e) {}
      return;
    }

    // 有的引擎版本只在 HTMLChangedTitle / HTMLTitle 之外给 URL,不当作标题
    if (name === "HTMLContentLoaded") {
      // 已加载但还没标题:给 1.5s 等标题,超时再收尾,避免每次死等 8s
      try {
        $.Schedule(1.5, function () {
          if (S.cur === cur) finishNav("LOAD_ONLY");
        });
      } catch (e) {}
    }
  }

  // ---------------- 启动 ----------------

  function boot() {
    S.lines = [
      "LCT CEF PROBE v1",
      "PANEL ...",
      "waiting"
    ];
    render();

    var root = getRoot();
    S.panel = findChild(root, PANEL_ID);

    if (!isValid(S.panel)) {
      setLine(1, "PANEL MISSING (id=" + PANEL_ID + ")");
      msg("panel missing");
      return;
    }

    var hasSet = typeof S.panel.SetURL === "function";
    setLine(1, "PANEL ok SetURL=" + (hasSet ? "yes" : "NO"));
    msg("panel found SetURL=" + hasSet);

    if (!hasSet) return;

    // 两套注册都做:未处理事件 + 面板绑定事件
    for (var i = 0; i < EVENTS.length; i += 1) {
      (function (ev) {
        try {
          $.RegisterForUnhandledEvent(ev, function (a, b, c, d) { onEvent(ev, a, b, c, d); });
        } catch (e) {}
      })(EVENTS[i]);
    }
    try {
      $.RegisterEventHandler("HTMLTitle", S.panel, function (a, b, c, d) { onEvent("HTMLTitle", a, b, c, d); });
    } catch (e) {
      msg("RegisterEventHandler HTMLTitle failed");
    }

    try { $.Schedule(0.5, function () { startNav(0); }); } catch (e) { startNav(0); }
  }

  // 保留原版聊天发送行为(布局里 oninputsubmit 指向这里)
  try {
    globalThis.LCTOnChatSubmit = function () {
      var root = getRoot();
      var input = findChild(root, "ChatInput");
      try {
        $.DispatchEvent("CitadelChatInputSubmitted", input);
      } catch (e) {}
    };
  } catch (e) {}

  try { $.Schedule(1.0, boot); } catch (e) { boot(); }
})();
