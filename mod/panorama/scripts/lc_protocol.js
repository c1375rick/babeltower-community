/**
 * BabelTower Community v3 — 协议层
 *
 * 唯一职责:把一次操作编码成 URL,把标题文本解析回结构化事件。
 * 不碰 DOM,不碰网络,不碰配置。
 *
 * 上行:  PAGE?v=3&r=0#q=<encodeURIComponent(JSON)>
 * 下行:  document.title
 *          LCT3A:<buildId>:<seq>                     通道存活
 *          LCT3R:<id>:<seq>:<enc(JSON)>              结果
 *          LCT3E:<id>:<seq>:<enc(JSON)>              错误
 *          LCT3C:<id>:<seq>:<i>/<n>:<chunk>          分片
 */
(function () {
  "use strict";

  var LCT = (globalThis.LCT = globalThis.LCT || {});

  var PROTO = {
    VERSION: 3,
    // 托管页地址。改这里必须同步改 pages/ 的协议版本。
    PAGE_URL: "https://c1375rick.github.io/babeltower-community-pages/",
    // 标题前缀。解析时用 indexOf,允许引擎在前面加杂讯。
    PREFIX: "LCT3",
    // 单个分片的最大字符数(编码后)。标题上限保守取 1024。
    CHUNK_SIZE: 320
  };

  var seq = 0;

  function nextId() {
    seq += 1;
    return "r" + seq.toString(36);
  }

  function buildUrl(base, req, retry) {
    var root = base || PROTO.PAGE_URL;
    var sep = root.indexOf("?") === -1 ? "?" : "&";
    return (
      root +
      sep +
      "v=" + PROTO.VERSION +
      "&r=" + (retry ? "1" : "0") +
      "#q=" + encodeURIComponent(JSON.stringify(req))
    );
  }

  function decodeJson(encoded) {
    try {
      return JSON.parse(decodeURIComponent(encoded));
    } catch (e) {
      return null;
    }
  }

  function toInt(v, dflt) {
    var n = parseInt(v, 10);
    return isNaN(n) ? dflt : n;
  }

  /**
   * 解析任意一条事件文本。
   * 返回 null 表示与协议无关(引擎的其他标题)。
   */
  function parseTitle(raw) {
    var s = String(raw == null ? "" : raw);
    var at = s.indexOf(PROTO.PREFIX);
    if (at === -1) return null;
    s = s.slice(at);

    // 存活包只有三段
    if (s.indexOf(PROTO.PREFIX + "A:") === 0) {
      var ap = s.split(":");
      return { kind: "alive", buildId: ap[1] || "", seq: ap[2] || "" };
    }

    var parts = s.split(":");
    var kind = parts[0];

    if (kind === PROTO.PREFIX + "R" || kind === PROTO.PREFIX + "E") {
      if (parts.length < 4) return null;
      var data = decodeJson(parts.slice(3).join(":"));
      if (!data) return null;
      return {
        kind: kind === PROTO.PREFIX + "R" ? "result" : "error",
        id: parts[1],
        seq: parts[2],
        data: data
      };
    }

    if (kind === PROTO.PREFIX + "C") {
      if (parts.length < 5) return null;
      var idx = String(parts[3]).split("/");
      var i = toInt(idx[0], -1);
      var n = toInt(idx[1], -1);
      if (i < 0 || n <= 0 || i >= n) return null;
      return {
        kind: "chunk",
        id: parts[1],
        seq: parts[2],
        i: i,
        n: n,
        chunk: parts.slice(4).join(":")
      };
    }

    return null;
  }

  /** 把一段已编码的载荷切成标题分片(仅供页面侧参考实现使用)。 */
  function splitChunks(encoded) {
    var out = [];
    for (var i = 0; i < encoded.length; i += PROTO.CHUNK_SIZE) {
      out.push(encoded.slice(i, i + PROTO.CHUNK_SIZE));
    }
    return out.length ? out : [""];
  }

  PROTO.nextId = nextId;
  PROTO.buildUrl = buildUrl;
  PROTO.decodeJson = decodeJson;
  PROTO.parseTitle = parseTitle;
  PROTO.splitChunks = splitChunks;

  LCT.proto = PROTO;
})();
