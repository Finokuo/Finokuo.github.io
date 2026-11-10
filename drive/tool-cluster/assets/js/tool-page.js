/* =====================================================
 * Fuo Tools · 工具集引擎（tool-cluster 专用）
 * 目录页（body[data-page="cluster"]）→ 渲染工具卡片网格
 * 工具页（body[data-tool="<slug>"]）→ 渲染对应工具 + 使用记录
 * 全部本地运行；登录守卫未通过时送回主页。
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;

  /* 设置开关兜底读取（与 settings.js 同键，无依赖、顺序无关） */
  function settingOn(key, dflt) {
    try {
      var raw = localStorage.getItem('fuo-settings');
      if (!raw) return dflt;
      var o = JSON.parse(raw);
      if (o && o[key] !== undefined) return !!o[key];
      return dflt;
    } catch (e) { return dflt; }
  }

  /* ---------- 小工具函数 ---------- */
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function copyText(text, done) {
    function ok() { done && done(true); }
    function fail() { done && done(false); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { legacy(); });
    } else legacy();
    function legacy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        var good = document.execCommand('copy');
        document.body.removeChild(ta);
        good ? ok() : fail();
      } catch (e) { fail(); }
    }
  }

  var toastEl = null;
  function miniToast(text) {
    if (!toastEl) toastEl = document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(miniToast._t);
    miniToast._t = setTimeout(function () { toastEl.hidden = true; }, 1800);
  }

  /* ---------- 基础控件构造 ---------- */
  function fieldRow(labelText, inputEl) {
    var wrap = h('label', 'tf');
    var lab = h('span', 'tf-label mono', labelText);
    wrap.appendChild(lab);
    wrap.appendChild(inputEl);
    return wrap;
  }

  function makeTextarea(cls, placeholder) {
    var ta = document.createElement('textarea');
    ta.className = 'tf-area ' + (cls || '');
    ta.spellcheck = false;
    if (placeholder) ta.placeholder = placeholder;
    return ta;
  }

  function makeBtn(text, primary) {
    var b = h('button', 'tbtn' + (primary ? ' is-primary' : ''), text);
    b.type = 'button';
    return b;
  }

  function btnRow() {
    var r = h('div', 'tbtn-row');
    for (var i = 0; i < arguments.length; i++) r.appendChild(arguments[i]);
    return r;
  }

  function copyBtn(getText) {
    var b = makeBtn('复制');
    b.addEventListener('click', function () {
      copyText(getText(), function (good) {
        miniToast(good ? '已复制到剪贴板' : '复制失败，请手动选择');
      });
    });
    return b;
  }

  /* =====================================================
   * 工具注册表（渲染器）
   * ===================================================== */
  var SVG = {
    json: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    color: '<path d="M12 3.5S6 10.2 6 14.2a6 6 0 0 0 12 0C18 10.2 12 3.5 12 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
    password: '<circle cx="8" cy="12" r="3.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M11.5 12H21M18 12v3.2M15 12v2.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    textstats: '<path d="M4.5 6h15M4.5 12h10M4.5 18h13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    timestamp: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    base64: '<path d="M5 9h14M5 15h14M9.5 4l-2 16M16.5 4l-2 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    uuid: '<rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="8" cy="12" r="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M13 10h4.5M13 14h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    diff: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 4.5v15M7 12h2.5M15 12h2.5M16.2 9.8v4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    regex: '<path d="M8.5 4.5 4.5 19.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M15 7.5v9M11.3 9.7l7.4 4.6M18.7 9.7l-7.4 4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><circle cx="20.2" cy="19" r="1.3" fill="currentColor"/>',
    qrcode: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M14 14h2.6M19.2 14h1.3M14 17.6v2.4M17.6 17.6h2.9M14 21h1.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    hash: '<path d="M9.5 4 8 20M16.5 4 15 20M4.5 9h15M3.8 15h15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    url: '<path d="M10.2 13.8a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 0 0-6-6l-1.2 1.2M13.8 10.2a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 0 0 6 6l1.2-1.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    imgcom: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="9" cy="9.5" r="1.7" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M4.5 17.5 9 13l3 2.5 3.5-4 4 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    jwt: '<path d="M9 4.5c-3 1.5-4.5 4-4.5 7.5S6 18 9 19.5M15 4.5c3 1.5 4.5 4 4.5 7.5S18 18 15 19.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M10.2 10.6 8.5 8.2M13.8 10.6l1.7-2.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    radix: '<path d="M12 3.5v17M5 7.5l7 4 7-4M5 16.5l7-4 7 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 3" fill="none"/>',
    lorem: '<path d="M5 6h14M5 10.5h14M5 15h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M16.5 13.3v4.4l3.5-2.2z" fill="currentColor"/>',
  };

  var TOOLS = {};
  window.FUO_TOOLS = TOOLS; // 暴露：未来新增工具可直接挂载

  /* ---------- 1. JSON 格式化 ---------- */
  TOOLS.json = {
    name: 'JSON 格式化', tone: 'tone-teal', desc: '格式化 · 压缩 · 校验，本地运行不上传',
    render: function (body) {
      var input = makeTextarea('grow', '粘贴 JSON，例如 {"name":"Fuo","ok":true}');
      input.value = '{\n  "name": "Fuo Tools",\n  "version": 1,\n  "tags": ["fast", "quiet"]\n}';
      var out = h('pre', 'tf-out mono', '');
      var msg = h('p', 'tf-msg', '');
      var err = h('p', 'tf-msg is-err', '');

      function run(minify) {
        err.textContent = '';
        out.textContent = '';
        var raw = input.value.trim();
        if (!raw) { err.textContent = '请先粘贴 JSON 内容。'; return; }
        try {
          var obj = JSON.parse(raw);
          out.textContent = minify ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
          msg.textContent = '✓ 合法 JSON';
          msg.hidden = false;
        } catch (e) {
          msg.hidden = true;
          err.textContent = '✗ ' + e.message;
        }
      }
      msg.hidden = true; err.hidden = true;

      var bFmt = makeBtn('格式化', true);
      var bMin = makeBtn('压缩');
      var bVal = makeBtn('校验');
      bFmt.addEventListener('click', function () { run(false); });
      bMin.addEventListener('click', function () { run(true); });
      bVal.addEventListener('click', function () { run(false); });

      var bCopy = copyBtn(function () { return out.textContent; });

      body.appendChild(fieldRow('输入', input));
      body.appendChild(btnRow(bFmt, bMin, bVal, bCopy));
      body.appendChild(out);
      body.appendChild(msg);
      body.appendChild(err);
      input.addEventListener('input', function () { msg.hidden = true; err.hidden = true; });
    },
  };

  /* ---------- 2. 颜色工具 ---------- */
  TOOLS.color = {
    name: '颜色工具', tone: 'tone-fuchsia', desc: 'HEX / RGB / HSL 互转，点击任意值复制',
    render: function (body) {
      var picker = document.createElement('input');
      picker.type = 'color';
      picker.value = '#14b8a6';
      picker.className = 'tf-color';

      /* v0.8：链接分享配置 —— ?hex=#rrggbb 打开即还原颜色 */
      try {
        var sp = new URLSearchParams(window.location.search);
        var hx = sp.get('hex');
        if (hx && /^#?[0-9a-fA-F]{6}$/.test(hx)) {
          picker.value = hx.charAt(0) === '#' ? hx : '#' + hx;
        }
      } catch (e) { /* ignore */ }

      var preview = h('div', 'color-preview');
      preview.style.background = picker.value;

      var rows = {};
      var rowsWrap = h('div', 'color-rows');
      ['HEX', 'RGB', 'HSL'].forEach(function (k) {
        var row = h('div', 'color-row');
        var key = h('span', 'mono color-key', k);
        var val = h('code', 'mono color-val', '');
        row.appendChild(key); row.appendChild(val);
        row.addEventListener('click', function () {
          copyText(val.textContent, function (good) {
            miniToast(good ? '已复制 ' + k : '复制失败');
          });
        });
        rows[k] = val;
        rowsWrap.appendChild(row);
      });

      function toHex(n) { var s = n.toString(16); return s.length < 2 ? '0' + s : s; }
      function update() {
        var v = picker.value;
        var r = parseInt(v.slice(1, 3), 16);
        var g = parseInt(v.slice(3, 5), 16);
        var b = parseInt(v.slice(5, 7), 16);
        preview.style.background = v;
        rows.HEX.textContent = v.toUpperCase();

        var rgb = 'rgb(' + r + ', ' + g + ', ' + b + ')';
        rows.RGB.textContent = rgb;

        var rn = r / 255, gn = g / 255, bn = b / 255;
        var max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
        var hu = 0, sa = 0, li = (max + min) / 2;
        if (max !== min) {
          var d = max - min;
          sa = li > 0.5 ? d / (2 - max - min) : d / (max + min);
          if (max === rn) hu = (gn - bn) / d + (gn < bn ? 6 : 0);
          else if (max === gn) hu = (bn - rn) / d + 2;
          else hu = (rn - gn) / d + 4;
          hu /= 6;
        }
        rows.HSL.textContent = 'hsl(' + Math.round(hu * 360) + ', ' +
          Math.round(sa * 100) + '%, ' + Math.round(li * 100) + '%)';
      }

      var bRand = makeBtn('随机一个');
      bRand.addEventListener('click', function () {
        var c = [0, 0, 0].map(function () { return Math.floor(Math.random() * 256); });
        picker.value = '#' + c.map(toHex).join('');
        update();
      });

      /* v0.8：分享当前颜色（参数进 URL，复制即带配置） */
      var bShare = makeBtn('分享这个颜色');
      bShare.addEventListener('click', function () {
        try {
          var url = location.origin + location.pathname + '?hex=' + picker.value.slice(1);
          history.replaceState(null, '', '?hex=' + picker.value.slice(1));
          copyText(url, function (good) {
            miniToast(good ? '链接已复制：打开即还原这个颜色' : '复制失败，请手动复制地址栏');
          });
        } catch (e) { miniToast('当前环境不支持链接分享'); }
      });

      var top = h('div', 'color-top');
      top.appendChild(picker);
      top.appendChild(preview);
      body.appendChild(top);
      body.appendChild(btnRow(bRand, bShare, copyBtn(function () { return rows.HEX.textContent; })));
      body.appendChild(rowsWrap);
      update();
      picker.addEventListener('input', update);
    },
  };

  /* ---------- 3. 密码生成器 ---------- */
  TOOLS.password = {
    name: '密码生成器', tone: 'tone-emerald', desc: '加密安全随机，生成后立即复制',
    render: function (body) {
      var out = h('div', 'pw-out mono', '—');
      var bar = h('div', 'pw-bar');
      var barIn = h('i');
      bar.appendChild(barIn);
      var strengthText = h('span', 'pw-strength mono', '');

      var len = document.createElement('input');
      len.type = 'range'; len.min = '8'; len.max = '64'; len.value = '16';
      var lenVal = h('b', 'mono', '16');

      var cUp = document.createElement('input'); cUp.type = 'checkbox'; cUp.checked = true;
      var cNum = document.createElement('input'); cNum.type = 'checkbox'; cNum.checked = true;
      var cSym = document.createElement('input'); cSym.type = 'checkbox'; cSym.checked = true;
      var cAmb = document.createElement('input'); cAmb.type = 'checkbox';

      /* v0.8：链接分享配置 —— ?len=20&up=1&num=1&sym=0&amb=1 打开即还原参数 */
      try {
        var sp = new URLSearchParams(window.location.search);
        var pl = parseInt(sp.get('len'), 10);
        if (pl >= 8 && pl <= 64) { len.value = String(pl); lenVal.textContent = String(pl); }
        ['up', 'num', 'sym', 'amb'].forEach(function (k) {
          var v = sp.get(k);
          var box = k === 'up' ? cUp : k === 'num' ? cNum : k === 'sym' ? cSym : cAmb;
          if (v === '1') box.checked = true;
          else if (v === '0') box.checked = false;
        });
      } catch (e) { /* ignore */ }

      function optsRow(box, label) {
        var l = h('label', 'pw-opt');
        l.appendChild(box);
        l.appendChild(h('span', null, label));
        return l;
      }

      function charset() {
        var s = 'abcdefghijklmnopqrstuvwxyz';
        if (cUp.checked) s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (cNum.checked) s += '0123456789';
        if (cSym.checked) s += '!@#$%^&*()-_=+[]{};:,.<>?/';
        if (cAmb.checked) s = s.replace(/[O0oIl1|]/g, '');
        return s;
      }

      function generate() {
        var s = charset();
        var n = parseInt(len.value, 10);
        if (!s.length) { out.textContent = '至少选择一种字符'; return; }
        var arr = new Uint32Array(n);
        (window.crypto || window.msCrypto).getRandomValues(arr);
        var pw = '';
        for (var i = 0; i < n; i++) pw += s[arr[i] % s.length];
        out.textContent = pw;

        var pool = 26 + (cUp.checked ? 26 : 0) + (cNum.checked ? 10 : 0) + (cSym.checked ? 26 : 0);
        var bits = Math.round(n * Math.log2(pool || 2));
        var pct = Math.min(100, Math.round(bits / 128 * 100));
        barIn.style.width = pct + '%';
        barIn.className = bits < 50 ? 'is-weak' : bits < 80 ? 'is-mid' : 'is-strong';
        strengthText.textContent = '≈ ' + bits + ' bits · ' +
          (bits < 50 ? '偏弱' : bits < 80 ? '良好' : '极强');
      }

      len.addEventListener('input', function () { lenVal.textContent = len.value; generate(); });
      [cUp, cNum, cSym, cAmb].forEach(function (c) { c.addEventListener('change', generate); });

      var bGen = makeBtn('重新生成', true);
      bGen.addEventListener('click', generate);
      var bCopy = copyBtn(function () { return out.textContent; });

      /* v0.8：分享当前参数（不含密码本身，只带长度/字符集设置） */
      var bShare = makeBtn('分享此参数');
      function syncUrl() {
        try {
          var q = '?len=' + len.value +
            '&up=' + (cUp.checked ? 1 : 0) +
            '&num=' + (cNum.checked ? 1 : 0) +
            '&sym=' + (cSym.checked ? 1 : 0) +
            '&amb=' + (cAmb.checked ? 1 : 0);
          history.replaceState(null, '', q);
        } catch (e) { /* ignore */ }
      }
      bShare.addEventListener('click', function () {
        syncUrl();
        copyText(location.origin + location.pathname + location.search, function (good) {
          miniToast(good ? '链接已复制：打开即还原这套参数（不含密码本身）' : '复制失败，请手动复制地址栏');
        });
      });
      len.addEventListener('input', syncUrl);
      [cUp, cNum, cSym, cAmb].forEach(function (c) { c.addEventListener('change', syncUrl); });

      var sw = h('div', 'pw-len');
      sw.appendChild(h('span', 'tf-label mono', '长度'));
      sw.appendChild(len);
      sw.appendChild(lenVal);

      var checks = h('div', 'pw-checks');
      checks.appendChild(optsRow(cUp, '大写字母'));
      checks.appendChild(optsRow(cNum, '数字'));
      checks.appendChild(optsRow(cSym, '符号'));
      checks.appendChild(optsRow(cAmb, '排除易混淆 (O0l1)'));
      cAmb.checked = false;

      body.appendChild(out);
      body.appendChild(bar);
      body.appendChild(strengthText);
      body.appendChild(sw);
      body.appendChild(checks);
      body.appendChild(btnRow(bGen, bCopy, bShare));
      generate();
    },
  };

  /* ---------- 4. 文本统计 ---------- */
  TOOLS.textstats = {
    name: '文本统计', tone: 'tone-amber', desc: '字数 / 行数 / 段落 / 阅读时长，实时更新',
    render: function (body) {
      var ta = makeTextarea('grow', '在这里粘贴或输入文本…');
      var grid = h('div', 'stat-grid');

      function cell(num, label, id) {
        var d = h('div', 'stat-cell');
        var b = h('b', 'mono', num);
        if (id) b.id = id;
        d.appendChild(b);
        d.appendChild(h('span', null, label));
        grid.appendChild(d);
      }
      cell('0', '字符', 'ts-chars');
      cell('0', '词数', 'ts-words');
      cell('0', '行数', 'ts-lines');
      cell('0', '段落', 'ts-paras');
      cell('0', '语句', 'ts-sents');
      cell('0', '阅读', 'ts-read');

      function update() {
        var v = ta.value;
        var chars = v.length;
        var cjk = (v.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
        var enWords = (v.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
          .match(/[A-Za-z0-9_'-]+/g) || []).length;
        var words = cjk + enWords;
        var lines = v ? v.split('\n').length : 0;
        var paras = v.split(/\n{2,}/).filter(function (p) { return p.trim(); }).length;
        var sents = (v.match(/[.!?。！？]+/g) || []).length;
        var mins = Math.ceil(words / 400);
        document.getElementById('ts-chars').textContent = chars.toLocaleString();
        document.getElementById('ts-words').textContent = words.toLocaleString();
        document.getElementById('ts-lines').textContent = lines.toLocaleString();
        document.getElementById('ts-paras').textContent = paras.toLocaleString();
        document.getElementById('ts-sents').textContent = sents.toLocaleString();
        document.getElementById('ts-read').textContent = words ? (mins + ' 分钟') : '0';
      }
      ta.addEventListener('input', update);
      update();

      body.appendChild(ta);
      body.appendChild(grid);
    },
  };

  /* ---------- 5. 时间戳转换 ---------- */
  TOOLS.timestamp = {
    name: '时间戳转换', tone: 'tone-cyan', desc: 'Unix 时间戳与日期双向转换，自动识别秒/毫秒',
    render: function (body) {
      var nowBox = h('div', 'ts-now mono', '—');
      var timer = setInterval(function () {
        if (!body.isConnected) { clearInterval(timer); return; }
        var d = new Date();
        nowBox.textContent = '现在  ' + Math.floor(d.getTime() / 1000) +
          ' s   ·   ' + d.getTime() + ' ms';
      }, 500);

      var tsIn = document.createElement('input');
      tsIn.type = 'text'; tsIn.className = 'tf-input mono';
      tsIn.placeholder = '输入时间戳，如 1735689600 或 1735689600000';
      var tsOut = h('code', 'tf-out mono', '—');

      var dateIn = document.createElement('input');
      dateIn.type = 'datetime-local'; dateIn.className = 'tf-input';
      var dateOut = h('code', 'tf-out mono', '—');

      function pad(n) { return n < 10 ? '0' + n : '' + n; }
      function fmt(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
          ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      }

      tsIn.addEventListener('input', function () {
        var raw = tsIn.value.trim();
        if (!/^\d{10,13}$/.test(raw)) { tsOut.textContent = '—'; return; }
        var ms = raw.length === 10 ? parseInt(raw, 10) * 1000 : parseInt(raw, 10);
        var d = new Date(ms);
        tsOut.textContent = isNaN(d.getTime()) ? '无效时间戳' : fmt(d);
      });

      dateIn.addEventListener('input', function () {
        if (!dateIn.value) { dateOut.textContent = '—'; return; }
        var d = new Date(dateIn.value);
        dateOut.textContent = isNaN(d.getTime()) ? '无效日期' :
          Math.floor(d.getTime() / 1000) + ' s  ·  ' + d.getTime() + ' ms';
      });

      var bNow1 = makeBtn('填入当前');
      bNow1.addEventListener('click', function () {
        tsIn.value = String(Math.floor(Date.now() / 1000));
        tsIn.dispatchEvent(new Event('input'));
      });

      body.appendChild(h('span', 'tf-label mono', '实时时间戳'));
      body.appendChild(nowBox);
      body.appendChild(fieldRow('时间戳 → 日期', tsIn));
      body.appendChild(btnRow(bNow1, copyBtn(function () { return tsOut.textContent; })));
      body.appendChild(tsOut);
      body.appendChild(fieldRow('日期 → 时间戳', dateIn));
      body.appendChild(dateOut);
    },
  };

  /* ---------- 6. Base64 ---------- */
  TOOLS.base64 = {
    name: 'Base64 编解码', tone: 'tone-violet', desc: 'UTF-8 安全，中文不乱码，本地运行',
    render: function (body) {
      var input = makeTextarea('', '输入要编码或解码的内容…');
      var out = h('pre', 'tf-out mono', '—');
      var err = h('p', 'tf-msg is-err', '');
      err.hidden = true;

      function encode() {
        err.hidden = true;
        try { out.textContent = btoa(unescape(encodeURIComponent(input.value))); }
        catch (e) { err.hidden = false; err.textContent = '编码失败：' + e.message; }
      }
      function decode() {
        err.hidden = true;
        try { out.textContent = decodeURIComponent(escape(atob(input.value.replace(/\s/g, '')))); }
        catch (e) { err.hidden = false; err.textContent = '解码失败：不是合法的 Base64。'; }
      }

      var bEnc = makeBtn('编码 →', true);
      var bDec = makeBtn('← 解码');
      var bSwap = makeBtn('结果当作输入');
      bEnc.addEventListener('click', encode);
      bDec.addEventListener('click', decode);
      bSwap.addEventListener('click', function () {
        if (out.textContent && out.textContent !== '—') {
          input.value = out.textContent;
          out.textContent = '—';
        }
      });

      body.appendChild(fieldRow('输入', input));
      body.appendChild(btnRow(bEnc, bDec, bSwap, copyBtn(function () { return out.textContent; })));
      body.appendChild(out);
      body.appendChild(err);
    },
  };

  /* ---------- 7. UUID 生成 ---------- */
  TOOLS.uuid = {
    name: 'UUID 生成器', tone: 'tone-orange', desc: 'UUID v4（加密随机），点击单条即可复制',
    render: function (body) {
      var list = h('div', 'uuid-list mono');

      function makeOne() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        var b = new Uint8Array(16);
        crypto.getRandomValues(b);
        b[6] = (b[6] & 15) | 64;
        b[8] = (b[8] & 63) | 128;
        var s = Array.prototype.map.call(b, function (x) {
          return (x < 16 ? '0' : '') + x.toString(16);
        }).join('');
        return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) +
          '-' + s.slice(16, 20) + '-' + s.slice(20);
      }

      function generate(n) {
        list.innerHTML = '';
        var all = [];
        for (var i = 0; i < n; i++) {
          var u = makeOne();
          all.push(u);
          var item = h('button', 'uuid-item', u);
          item.type = 'button';
          item.addEventListener('click', function () {
            copyText(this.textContent, function (good) {
              miniToast(good ? '已复制' : '复制失败');
            });
          });
          list.appendChild(item);
        }
        list._all = all;
      }

      var count = document.createElement('input');
      count.type = 'number'; count.min = '1'; count.max = '50'; count.value = '5';
      count.className = 'tf-input';

      var bGen = makeBtn('生成', true);
      bGen.addEventListener('click', function () {
        var n = Math.min(50, Math.max(1, parseInt(count.value, 10) || 5));
        count.value = n;
        generate(n);
      });
      var bCopyAll = copyBtn(function () {
        return (list._all || []).join('\n');
      });

      body.appendChild(fieldRow('数量（1-50）', count));
      body.appendChild(btnRow(bGen, bCopyAll));
      body.appendChild(list);
      generate(5);
    },
  };

  /* ---------- 8. 文本 Diff ---------- */
  TOOLS.diff = {
    name: '文本 Diff', tone: 'tone-rose', desc: '逐行对比两段文本，绿增红删',
    render: function (body) {
      var wrap = h('div', 'diff-inputs');
      var a = makeTextarea('', '原始文本…');
      var b = makeTextarea('', '修改后的文本…');
      wrap.appendChild(a); wrap.appendChild(b);

      var out = h('pre', 'tf-out diff-out mono', '');
      var msg = h('p', 'tf-msg', '');
      msg.hidden = true;

      a.value = 'Fuo Tools\n安静的云工作台\n版本 1';
      b.value = 'Fuo Tools\n快速而安静的云工作台\n版本 2\n新工具上线';

      function diffLines(A, B) {
        var n = A.length, m = B.length;
        var dp = [];
        for (var i = 0; i <= n; i++) {
          dp[i] = new Array(m + 1);
          for (var j = 0; j <= m; j++) dp[i][j] = 0;
        }
        for (i = n - 1; i >= 0; i--) {
          for (j = m - 1; j >= 0; j--) {
            dp[i][j] = A[i] === B[j]
              ? dp[i + 1][j + 1] + 1
              : Math.max(dp[i + 1][j], dp[i][j + 1]);
          }
        }
        var res = [];
        i = 0; j = 0;
        while (i < n && j < m) {
          if (A[i] === B[j]) { res.push(['=', A[i]]); i++; j++; }
          else if (dp[i + 1][j] >= dp[i][j + 1]) { res.push(['-', A[i]]); i++; }
          else { res.push(['+', B[j]]); j++; }
        }
        while (i < n) { res.push(['-', A[i]]); i++; }
        while (j < m) { res.push(['+', B[j]]); j++; }
        return res;
      }

      var bRun = makeBtn('对比', true);
      bRun.addEventListener('click', function () {
        var A = a.value.split('\n');
        var B = b.value.split('\n');
        if (!a.value && !b.value) { msg.hidden = false; msg.textContent = '先在两侧输入内容。'; return; }
        msg.hidden = true;
        var rows = diffLines(A, B);
        out.innerHTML = '';
        var add = 0, del = 0;
        rows.forEach(function (r) {
          var line = h('div', 'diff-line diff-' + (r[0] === '=' ? 'same' : r[0] === '+' ? 'add' : 'del'));
          line.textContent = (r[0] === '=' ? '  ' : r[0] === '+' ? '+ ' : '- ') + r[1];
          out.appendChild(line);
          if (r[0] === '+') add++;
          if (r[0] === '-') del++;
        });
        msg.hidden = false;
        msg.textContent = '完成：新增 ' + add + ' 行，删除 ' + del + ' 行，保留 ' +
          (rows.length - add - del) + ' 行。';
      });

      body.appendChild(wrap);
      body.appendChild(btnRow(bRun));
      body.appendChild(out);
      body.appendChild(msg);
    },
  };

  /* ---------- 9. 正则测试器 ---------- */
  TOOLS.regex = {
    name: '正则测试器', tone: 'tone-rose', desc: '实时匹配高亮 · 捕获组 · 替换预览',
    render: function (body) {
      var patIn = document.createElement('input');
      patIn.type = 'text'; patIn.className = 'tf-input mono';
      patIn.placeholder = '正则表达式，例如 \\d+|[a-f0-9]{4}';
      patIn.value = '\\b[\\w.+-]+@[\\w-]+\\.[\\w.]+\\b';

      var flags = {};
      var flagWrap = h('div', 'rx-flags');
      [['g', '全局 g'], ['i', '忽略大小写 i'], ['m', '多行 m'], ['s', '点号跨行 s'], ['u', 'Unicode u']].forEach(function (f) {
        var l = h('label', 'pw-opt');
        var box = document.createElement('input');
        box.type = 'checkbox';
        if (f[0] === 'g' || f[0] === 'i') box.checked = true;
        box.addEventListener('change', update);
        l.appendChild(box);
        l.appendChild(h('span', null, f[1]));
        flagWrap.appendChild(l);
        flags[f[0]] = box;
      });

      var ta = makeTextarea('grow', '输入测试文本…');
      ta.value = '联系我：finokuo@example.com 或 admin@test.org\n电话 138-8888-6666，备用 159 0000 1234\n日期 2026-11-09 / 2026/11/10';

      var out = h('div', 'rx-hl mono', '');
      var stat = h('p', 'tf-msg', '');
      var err = h('p', 'tf-msg is-err', '');
      var groupsEl = h('div', 'rx-groups mono', '');
      var repIn = document.createElement('input');
      repIn.type = 'text'; repIn.className = 'tf-input mono';
      repIn.placeholder = '替换为（支持 $1 $& 等），例如 [$&]';
      var repOut = h('pre', 'tf-out mono', '—');
      stat.hidden = true; err.hidden = true;

      function esc(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      function flagStr() {
        var s = '';
        ['g', 'i', 'm', 's', 'u'].forEach(function (k) { if (flags[k] && flags[k].checked) s += k; });
        return s;
      }

      function update() {
        err.hidden = true; stat.hidden = true;
        out.innerHTML = ''; groupsEl.innerHTML = ''; repOut.textContent = '—';
        var src = ta.value;
        if (!patIn.value || !src) {
          out.innerHTML = '<span class="rx-dim">// 输入正则与测试文本后实时匹配</span>';
          return;
        }
        var re;
        try { re = new RegExp(patIn.value, flagStr()); }
        catch (e) { err.hidden = false; err.textContent = '✗ 正则语法错误：' + e.message; return; }

        var matches = [];
        if (re.global) {
          var it = src.matchAll(re);
          var step;
          while ((step = it.next()) && !step.done) {
            matches.push(step.value);
            if (matches.length >= 2000) break;
          }
        } else {
          var m0 = re.exec(src);
          if (m0) matches.push(m0);
        }

        var html = '';
        var last = 0;
        matches.forEach(function (m) {
          var s = m.index, e2 = s + m[0].length;
          if (e2 <= s) return; // 空匹配不渲染标记
          html += esc(src.slice(last, s)) + '<mark class="rx-hit">' + esc(m[0]) + '</mark>';
          last = e2;
        });
        html += esc(src.slice(last));
        out.innerHTML = html;

        stat.hidden = false;
        stat.textContent = '✓ ' + matches.length + ' 处匹配' + (re.global ? '' : '（无 g 标志只显示第一处）');

        if (matches.length && matches[0].length > 1) {
          var m = matches[0];
          groupsEl.appendChild(h('b', 'rx-g-head', '第 1 处匹配的捕获组'));
          for (var i = 1; i < m.length; i++) {
            var row = h('div', 'rx-g-row');
            row.appendChild(h('span', 'rx-g-idx', '$' + i));
            row.appendChild(h('code', 'rx-g-val', m[i] === undefined ? '(未参与匹配)' : m[i]));
            groupsEl.appendChild(row);
          }
        }

        if (repIn.value) {
          try { repOut.textContent = src.replace(re, repIn.value); }
          catch (e) { repOut.textContent = '—'; }
        }
      }

      body.appendChild(fieldRow('正则表达式', patIn));
      body.appendChild(flagWrap);
      body.appendChild(fieldRow('测试文本', ta));
      body.appendChild(out);
      body.appendChild(stat);
      body.appendChild(err);
      body.appendChild(h('span', 'tf-label mono', '替换预览（可选）'));
      body.appendChild(repIn);
      body.appendChild(repOut);
      body.appendChild(btnRow(copyBtn(function () { return repOut.textContent; })));
      body.appendChild(h('span', 'tf-label mono', '捕获组'));
      body.appendChild(groupsEl);
      patIn.addEventListener('input', update);
      ta.addEventListener('input', update);
      repIn.addEventListener('input', update);
      update();
    },
  };

  /* ---------- 10. 二维码生成 ---------- */
  TOOLS.qrcode = {
    name: '二维码生成', tone: 'tone-cyan', desc: '本地生成可下载 PNG · 支持中文与长文本',
    render: function (body) {
      if (!window.qrcodegen) {
        body.appendChild(h('p', 'tf-msg is-err', '二维码库未加载：assets/vendor/qrcodegen.js 缺失。'));
        return;
      }
      var input = makeTextarea('', '输入内容（网址 / 文本 / Wi-Fi 名密码…）');
      input.value = 'https://finokuo.github.io';

      var eclSel = document.createElement('select');
      eclSel.className = 'tf-input';
      [['MEDIUM', '纠错 M · 推荐'], ['LOW', '纠错 L · 容量最大'], ['QUART', '纠错 Q'], ['HIGH', '纠错 H · 最抗损']].forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        eclSel.appendChild(op);
      });

      var scaleIn = document.createElement('input');
      scaleIn.type = 'range'; scaleIn.min = '2'; scaleIn.max = '12'; scaleIn.value = '4';
      var scaleVal = h('b', 'mono', '4x');
      var bordIn = document.createElement('input');
      bordIn.type = 'range'; bordIn.min = '0'; bordIn.max = '8'; bordIn.value = '4';
      var bordVal = h('b', 'mono', '4');

      var canvas = document.createElement('canvas');
      canvas.className = 'qr-canvas';
      canvas.setAttribute('aria-label', '二维码预览');
      var info = h('p', 'tf-msg', '');
      info.hidden = true;

      function update() {
        scaleVal.textContent = scaleIn.value + 'x';
        bordVal.textContent = bordIn.value;
        var text = input.value;
        info.hidden = true;
        var ctx0 = canvas.getContext('2d');
        canvas.width = canvas.height = 1;
        if (!text.trim()) { ctx0.clearRect(0, 0, 1, 1); return; }
        try {
          var qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc[eclSel.value]);
          var scale = parseInt(scaleIn.value, 10);
          var border = parseInt(bordIn.value, 10);
          canvas.width = canvas.height = (qr.size + border * 2) * scale;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#101014';
          for (var y = 0; y < qr.size; y++) {
            for (var x = 0; x < qr.size; x++) {
              if (qr.getModule(x, y)) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
            }
          }
          info.hidden = false;
          info.textContent = '✓ 版本 ' + qr.version + ' · ' + qr.size + '×' + qr.size + ' 模块 · ' +
            (canvas.width + '×' + canvas.height + ' px');
        } catch (e) {
          info.hidden = false;
          info.textContent = '✗ ' + (e && e.message ? e.message : '生成失败（内容过长？）');
        }
      }

      var bDown = makeBtn('下载 PNG', true);
      bDown.addEventListener('click', function () {
        if (!canvas.width || canvas.width <= 1) { miniToast('先输入内容生成二维码'); return; }
        var a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'fuo-qrcode.png';
        a.click();
      });

      var optRow1 = h('div', 'pw-len');
      optRow1.appendChild(h('span', 'tf-label mono', '比例'));
      optRow1.appendChild(scaleIn);
      optRow1.appendChild(scaleVal);
      var optRow2 = h('div', 'pw-len');
      optRow2.appendChild(h('span', 'tf-label mono', '留白'));
      optRow2.appendChild(bordIn);
      optRow2.appendChild(bordVal);

      var qrBox = h('div', 'qr-box');
      qrBox.appendChild(canvas);

      body.appendChild(fieldRow('内容', input));
      body.appendChild(fieldRow('纠错等级', eclSel));
      body.appendChild(optRow1);
      body.appendChild(optRow2);
      body.appendChild(btnRow(bDown));
      body.appendChild(qrBox);
      body.appendChild(info);
      input.addEventListener('input', update);
      eclSel.addEventListener('change', update);
      scaleIn.addEventListener('input', update);
      bordIn.addEventListener('input', update);
      update();
    },
  };

  /* ---------- 11. 哈希计算 ---------- */
  TOOLS.hash = {
    name: '哈希计算', tone: 'tone-emerald', desc: 'SHA-1 / 256 / 384 / 512 · 文本与文件 · 本地计算',
    render: function (body) {
      if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) {
        body.appendChild(h('p', 'tf-msg is-err', '当前环境不支持安全哈希（需要 HTTPS 或 localhost）。'));
        return;
      }
      var ta = makeTextarea('grow', '输入文本，或把文件拖到这里…');
      var fileIn = document.createElement('input');
      fileIn.type = 'file'; fileIn.hidden = true;

      var algo = 'SHA-256';
      var seg = h('div', 'hash-algos mono');
      ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'].forEach(function (a) {
        var b = h('button', 'hash-algo' + (a === algo ? ' is-on' : ''), a);
        b.type = 'button';
        b.addEventListener('click', function () {
          algo = a;
          Array.prototype.forEach.call(seg.children, function (x) { x.classList.remove('is-on'); });
          b.classList.add('is-on');
          run();
        });
        seg.appendChild(b);
      });

      var out = h('code', 'tf-out hash-out mono', '—');
      var meta = h('p', 'tf-msg', '');
      meta.hidden = true;

      var bFile = makeBtn('选择文件');
      bFile.addEventListener('click', function () { fileIn.click(); });
      fileIn.addEventListener('change', function () {
        if (fileIn.files && fileIn.files[0]) handleFile(fileIn.files[0]);
        fileIn.value = '';
      });

      ta.addEventListener('dragover', function (e) { e.preventDefault(); ta.classList.add('is-drop'); });
      ta.addEventListener('dragleave', function () { ta.classList.remove('is-drop'); });
      ta.addEventListener('drop', function (e) {
        e.preventDefault();
        ta.classList.remove('is-drop');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFile(e.dataTransfer.files[0]);
        }
      });

      function toHex(buf) {
        var arr = new Uint8Array(buf);
        var s = '';
        for (var i = 0; i < arr.length; i++) s += (arr[i] < 16 ? '0' : '') + arr[i].toString(16);
        return s;
      }
      function fmtSize(n) {
        return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
      }
      function digest(data, label) {
        out.textContent = '计算中…';
        window.crypto.subtle.digest(algo, data).then(function (buf) {
          out.textContent = toHex(buf);
          meta.hidden = false;
          meta.textContent = '✓ ' + algo + ' · ' + label;
        }).catch(function (e) {
          out.textContent = '—';
          meta.hidden = false;
          meta.textContent = '✗ 计算失败：' + (e && e.message ? e.message : '未知错误');
        });
      }
      function run() {
        if (!ta.value) { out.textContent = '—'; meta.hidden = true; return; }
        digest(new TextEncoder().encode(ta.value), '文本 ' + ta.value.length + ' 字');
      }
      function handleFile(file) {
        if (file.size > 64 * 1048576) { miniToast('文件过大（上限 64 MB）'); return; }
        var fr = new FileReader();
        fr.onload = function () {
          digest(fr.result, '文件 ' + file.name + ' · ' + fmtSize(file.size));
        };
        fr.onerror = function () { miniToast('文件读取失败'); };
        fr.readAsArrayBuffer(file);
      }

      ta.addEventListener('input', run);
      body.appendChild(seg);
      body.appendChild(fieldRow('输入', ta));
      body.appendChild(fileIn);
      body.appendChild(btnRow(bFile, copyBtn(function () { return out.textContent; })));
      body.appendChild(out);
      body.appendChild(meta);
    },
  };

  /* ---------- 12. URL 编解码 ---------- */
  TOOLS.url = {
    name: 'URL 编解码', tone: 'tone-amber', desc: '编码 / 解码 / 链接解析（参数表）',
    render: function (body) {
      var input = makeTextarea('', '输入 URL 或任意文本…');
      input.value = 'https://finokuo.github.io/search?q=云笔记 页面&lang=zh-CN#top';
      var out = h('pre', 'tf-out mono', '—');
      var err = h('p', 'tf-msg is-err', '');
      err.hidden = true;
      var parseBox = h('div', 'url-parse');

      function runEnc() {
        err.hidden = true;
        out.textContent = encodeURIComponent(input.value);
      }
      function runDec() {
        err.hidden = true;
        try { out.textContent = decodeURIComponent(input.value.replace(/\+/g, '%20')); }
        catch (e) { err.hidden = false; err.textContent = '✗ 解码失败：不是合法的百分号编码。'; }
      }
      function runParse() {
        err.hidden = true;
        parseBox.innerHTML = '';
        var raw = input.value.trim();
        if (!raw) { return; }
        var u;
        try { u = new URL(raw); }
        catch (e) {
          try { u = new URL('https://' + raw); }
          catch (e2) { err.hidden = false; err.textContent = '✗ 无法解析为链接。'; return; }
        }
        var rows = [
          ['协议', u.protocol.replace(':', '') || '—'],
          ['主机', u.host || '—'],
          ['路径', u.pathname || '—'],
          ['哈希', u.hash.replace('#', '') || '—'],
        ];
        var table = h('div', 'url-rows');
        rows.forEach(function (r) {
          var row = h('div', 'url-row');
          row.appendChild(h('span', 'mono url-key', r[0]));
          row.appendChild(h('code', 'mono url-val', r[1]));
          table.appendChild(row);
        });
        parseBox.appendChild(h('span', 'tf-label mono', '链接结构'));
        parseBox.appendChild(table);

        if (u.search) {
          parseBox.appendChild(h('span', 'tf-label mono', '查询参数'));
          var ptable = h('div', 'url-rows');
          u.searchParams.forEach(function (v, k) {
            var row = h('div', 'url-row');
            row.appendChild(h('span', 'mono url-key', k));
            row.appendChild(h('code', 'mono url-val', v || '(空)'));
            ptable.appendChild(row);
          });
          parseBox.appendChild(ptable);
        }
        out.textContent = u.href;
      }

      var bEnc = makeBtn('编码 →', true);
      var bDec = makeBtn('← 解码');
      var bParse = makeBtn('解析链接');
      var bSwap = makeBtn('结果当作输入');
      bEnc.addEventListener('click', runEnc);
      bDec.addEventListener('click', runDec);
      bParse.addEventListener('click', runParse);
      bSwap.addEventListener('click', function () {
        if (out.textContent && out.textContent !== '—') {
          input.value = out.textContent;
          out.textContent = '—';
          parseBox.innerHTML = '';
        }
      });

      body.appendChild(fieldRow('输入', input));
      body.appendChild(btnRow(bEnc, bDec, bParse, bSwap, copyBtn(function () { return out.textContent; })));
      body.appendChild(out);
      body.appendChild(err);
      body.appendChild(parseBox);
      runParse(); // 默认给一次解析结果
    },
  };

  /* ---------- 13. 图片压缩 ---------- */
  TOOLS.imgcom = {
    name: '图片压缩', tone: 'tone-orange', desc: '质量 / 尺寸 / 格式可控 · 纯本地不上传',
    render: function (body) {
      var fileIn = document.createElement('input');
      fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.hidden = true;

      var drop = h('div', 'ic-drop');
      drop.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="9" cy="9.5" r="1.7" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M4.5 17.5 9 13l3 2.5 3.5-4 4 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' +
        '<b>点击选择图片，或拖拽到此处</b>' +
        '<p class="mono">JPG / PNG / WebP · 全程在本机处理，不会上传</p>';
      drop.addEventListener('click', function () { fileIn.click(); });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('is-over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]);
      });
      fileIn.addEventListener('change', function () {
        if (fileIn.files && fileIn.files[0]) handle(fileIn.files[0]);
        fileIn.value = '';
      });

      var quality = document.createElement('input');
      quality.type = 'range'; quality.min = '10'; quality.max = '95'; quality.value = '80';
      var qualityVal = h('b', 'mono', '80%');

      var maxW = document.createElement('input');
      maxW.type = 'number'; maxW.className = 'tf-input ic-maxw';
      maxW.placeholder = '不限制'; maxW.min = '16';

      var webpOk = false;
      try {
        var probe = document.createElement('canvas');
        probe.width = probe.height = 1;
        webpOk = probe.toDataURL('image/webp').indexOf('data:image/webp') === 0;
      } catch (e) { webpOk = false; }

      var fmtSel = document.createElement('select');
      fmtSel.className = 'tf-input';
      var fmtOpts = [['jpeg', 'JPEG（兼容最好）']];
      if (webpOk) fmtOpts.push(['webp', 'WebP（更小，保留透明）']);
      fmtOpts.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        fmtSel.appendChild(op);
      });

      var result = h('div', 'ic-result');
      var msg = h('p', 'tf-msg', '');
      msg.hidden = true;
      var lastUrl = null;
      var lastName = 'fuo.jpg';

      function fmtSize(n) {
        return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
      }

      function handle(file) {
        if (!/^image\//.test(file.type)) { miniToast('请选择图片文件'); return; }
        if (file.size > 32 * 1048576) { miniToast('图片过大（上限 32 MB）'); return; }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          compress(img, file, url);
        };
        img.onerror = function () {
          miniToast('图片读取失败');
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }

      function compress(img, file, url) {
        var maxWNum = parseInt(maxW.value, 10) || 0;
        var w = img.naturalWidth, hh = img.naturalHeight;
        if (maxWNum && w > maxWNum) {
          hh = Math.round(hh * maxWNum / w);
          w = maxWNum;
        }
        if (w < 1 || hh < 1) { miniToast('图片尺寸异常'); return; }

        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hh;
        var ctx = canvas.getContext('2d');
        var mime = fmtSel.value === 'webp' && webpOk ? 'image/webp' : 'image/jpeg';
        if (mime === 'image/jpeg') {
          ctx.fillStyle = '#ffffff'; // PNG 透明区域避免变黑
          ctx.fillRect(0, 0, w, hh);
        }
        ctx.drawImage(img, 0, 0, w, hh);

        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) { msg.hidden = false; msg.className = 'tf-msg is-err'; msg.textContent = '✗ 压缩失败，换一张试试。'; return; }
          renderResult(blob, file, w, hh);
        }, mime, parseInt(quality.value, 10) / 100);
      }

      function renderResult(blob, file, w, hh) {
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(blob);
        var saved = file.size ? Math.max(0, Math.round((1 - blob.size / file.size) * 100)) : 0;
        var ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
        lastName = (file.name || 'image').replace(/\.[^.]+$/, '') + '-fuo.' + ext;

        result.innerHTML = '';
        var img = document.createElement('img');
        img.src = lastUrl;
        img.alt = '压缩结果预览';
        var stats = h('div', 'ic-stats mono');
        stats.innerHTML =
          '<span>原始 <b>' + fmtSize(file.size) + '</b></span>' +
          '<span>→ <b>' + fmtSize(blob.size) + '</b></span>' +
          '<span class="' + (saved >= 5 ? 'is-good' : '') + '">' + (saved > 0 ? '省 ' + saved + '%' : '未变小（已经很优了）') + '</span>' +
          '<span>' + w + '×' + hh + '</span>';

        var bDown = makeBtn('下载压缩图', true);
        bDown.addEventListener('click', function () {
          var a = document.createElement('a');
          a.href = lastUrl;
          a.download = lastName;
          a.click();
        });

        result.appendChild(img);
        result.appendChild(stats);
        result.appendChild(btnRow(bDown));
        result.hidden = false;
        msg.hidden = true;
      }

      var qRow = h('div', 'pw-len');
      qRow.appendChild(h('span', 'tf-label mono', '质量'));
      qRow.appendChild(quality);
      qRow.appendChild(qualityVal);
      quality.addEventListener('input', function () {
        qualityVal.textContent = quality.value + '%';
      });

      var fmtRow = h('div', 'ic-opts');
      fmtRow.appendChild(fieldRow('输出格式', fmtSel));
      fmtRow.appendChild(fieldRow('最大宽度 px', maxW));

      var note = h('p', 'tf-msg', '');
      note.textContent = '提示：PNG 透明图选 JPEG 会填白底，选 WebP 可保留透明；调整质量或尺寸后需重新选择图片。';

      result.hidden = true;
      body.appendChild(fileIn);
      body.appendChild(drop);
      body.appendChild(qRow);
      body.appendChild(fmtRow);
      body.appendChild(note);
      body.appendChild(msg);
      body.appendChild(result);
    },
  };
  /* ---------- 14. JWT 解码器（v0.8） ---------- */
  TOOLS.jwt = {
    name: 'JWT 解码器', tone: 'tone-violet', desc: '解码 Header / Payload · exp 过期检查 · 本地解析',
    render: function (body) {
      var input = makeTextarea('grow', '粘贴 JWT（形如 eyJhbGciOi....xxx.yyy）');
      var headOut = h('pre', 'tf-out mono jwt-out', '');
      var payOut = h('pre', 'tf-out mono jwt-out', '');
      var status = h('p', 'tf-msg', '');
      var err = h('p', 'tf-msg is-err', '');
      err.hidden = true;

      function b64urlToStr(s) {
        s = String(s).replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        var bin = atob(s);
        try {
          return decodeURIComponent(escape(bin)); // UTF-8 安全
        } catch (e) { return bin; }
      }

      /* 在 Payload 顶部插入可读时间注释行（仅展示用） */
      function decorate(key, val) {
        if (typeof val !== 'number') return '';
        var d = new Date(val * 1000);
        var rel = val * 1000 - Date.now();
        var relTxt = rel > 0
          ? '（还有 ' + Math.round(rel / 86400000) + ' 天）'
          : '（已过去 ' + Math.round(-rel / 86400000) + ' 天）';
        return '  "·' + key + '": ' + val + ',\n  "' + key + '_zh": "' + d.toLocaleString('zh-CN') + relTxt + '",\n';
      }

      function run() {
        err.hidden = true; status.hidden = true;
        headOut.textContent = ''; payOut.textContent = '';
        var raw = input.value.trim();
        if (!raw) return;
        var parts = raw.split('.');
        if (parts.length < 2 || parts.length > 5) {
          err.textContent = '✗ 不是有效的 JWT：应用「.」分为 2-5 段，当前 ' + parts.length + ' 段';
          err.hidden = false;
          return;
        }
        try {
          var header = JSON.parse(b64urlToStr(parts[0]));
          var payload = JSON.parse(b64urlToStr(parts[1]));

          headOut.textContent = JSON.stringify(header, null, 2);
          var plain = JSON.stringify(payload, null, 2);
          var inject = decorate('exp', payload.exp) + decorate('iat', payload.iat) + decorate('nbf', payload.nbf);
          payOut.textContent = inject ? plain.replace(/^\{\n/, '{\n' + inject) : plain;

          var bits = [];
          bits.push('算法 ' + (header.alg || '未知'));
          if (header.typ) bits.push('类型 ' + header.typ);
          if (payload.exp != null) {
            var left = payload.exp * 1000 - Date.now();
            if (left <= 0) { bits.push('⛔ 已过期'); status.className = 'tf-msg is-err'; }
            else {
              var dd = Math.floor(left / 86400000);
              bits.push('✓ 有效期内' + (dd > 0 ? '（剩 ' + dd + ' 天）' : '（剩 ' + Math.floor(left / 3600000) + ' 小时）'));
              status.className = 'tf-msg';
            }
          } else { bits.push('无 exp 字段（永不过期或由服务端控制）'); status.className = 'tf-msg'; }
          if (parts.length === 2) bits.push('未签名（无 Signature 段）');
          status.textContent = '· ' + bits.join(' · ');
          status.hidden = false;
        } catch (e) {
          err.textContent = '✗ 解码失败：' + (e.message || '段内容不是合法的 Base64URL / JSON');
          err.hidden = false;
        }
      }

      input.addEventListener('input', run);

      var labH = h('p', 'tf-label mono', 'Header');
      var labP = h('p', 'tf-label mono', 'Payload');
      labH.style.marginTop = '10px';

      body.appendChild(fieldRow('JWT 令牌', input));
      body.appendChild(btnRow(copyBtn(function () { return payOut.textContent; })));
      body.appendChild(labH);
      body.appendChild(headOut);
      body.appendChild(labP);
      body.appendChild(payOut);
      body.appendChild(status);
      body.appendChild(err);
    },
  };

  /* ---------- 15. 进制转换（v0.8，BigInt 大数） ---------- */
  TOOLS.radix = {
    name: '进制转换', tone: 'tone-cyan', desc: '2-36 进制互转 · BigInt 超大数 · 实时换算',
    render: function (body) {
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'tf-input mono';
      input.placeholder = '输入数字，例如 255 或 1e215c66274';
      input.autocomplete = 'off';
      input.spellcheck = false;

      var fromSel = document.createElement('select');
      fromSel.className = 'tf-input';
      fromSel.setAttribute('aria-label', '源进制');
      var RADIX_NAMES = { 2: '二进制 BIN', 8: '八进制 OCT', 10: '十进制 DEC', 16: '十六进制 HEX', 36: '三十六进制' };
      [2, 8, 10, 16, 32, 36].forEach(function (b) {
        var o = document.createElement('option');
        o.value = String(b);
        o.textContent = RADIX_NAMES[b] || b + ' 进制';
        if (b === 10) o.selected = true;
        fromSel.appendChild(o);
      });

      var err = h('p', 'tf-msg is-err', '');
      err.hidden = true;
      var wrap = h('div', 'radix-rows');

      function alphabet(base) {
        var s = '0123456789abcdefghijklmnopqrstuvwxyz';
        return s.slice(0, base);
      }

      function run() {
        err.hidden = true;
        var raw = input.value.trim().toLowerCase().replace(/[\s_,]/g, '');
        wrap.innerHTML = '';
        if (!raw) return;
        var base = parseInt(fromSel.value, 10);
        var ab = alphabet(base);
        for (var i = 0; i < raw.length; i++) {
          if (ab.indexOf(raw[i]) === -1) {
            err.textContent = '✗「' + raw[i] + '」不是合法的 ' + base + ' 进制字符';
            err.hidden = false;
            return;
          }
        }
        var big;
        try { big = BigInt(raw === '' ? 0 : parseInt(raw, base)); } catch (e) { big = null; }
        // parseInt 会丢失精度 → 大数必须逐位解析
        if (raw.length > 12 || big === null) {
          try {
            big = 0n;
            for (var j = 0; j < raw.length; j++) big = big * BigInt(base) + BigInt(ab.indexOf(raw[j]));
          } catch (e) {
            err.textContent = '✗ 解析失败：当前浏览器不支持 BigInt 大数';
            err.hidden = false;
            return;
          }
        } else {
          big = BigInt(parseInt(raw, base));
        }

        [2, 8, 10, 16, 32, 36].forEach(function (b) {
          if (b === base) return;
          var row = h('div', 'radix-row');
          var k = h('span', 'mono radix-key', RADIX_NAMES[b] || b + ' 进制');
          var v = h('code', 'mono radix-val', big.toString(b));
          v.title = '点击复制';
          row.appendChild(k);
          row.appendChild(v);
          row.addEventListener('click', function () {
            copyText(v.textContent, function (good) { miniToast(good ? '已复制 ' + (RADIX_NAMES[b] || b) : '复制失败'); });
          });
          wrap.appendChild(row);
        });
      }

      input.addEventListener('input', run);
      fromSel.addEventListener('change', run);

      body.appendChild(fieldRow('数字', input));
      body.appendChild(fieldRow('源进制', fromSel));
      body.appendChild(err);
      body.appendChild(wrap);
    },
  };

  /* ---------- 16. Lorem 占位文本（v0.8） ---------- */
  TOOLS.lorem = {
    name: 'Lorem 占位文本', tone: 'tone-amber', desc: '段落 / 句子 / 单词 · 经典词库 · 一键复制',
    render: function (body) {
      var WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ' +
        'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ' +
        'ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit ' +
        'voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat ' +
        'non proident sunt culpa qui officia deserunt mollit anim id est laborum').split(' ');

      var seg = h('div', 'st-like-seg');
      seg.style.cssText = 'display:inline-flex;gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:10px';
      var mode = 'para';
      var modes = [['para', '段落'], ['sent', '句子'], ['word', '单词']];
      var segBtns = [];
      modes.forEach(function (m) {
        var b = h('button', null, m[1]);
        b.type = 'button';
        b.style.cssText = 'padding:7px 16px;border:none;background:transparent;color:var(--muted);font-size:12.5px;cursor:pointer';
        b.addEventListener('click', function () {
          mode = m[0];
          segBtns.forEach(function (x) {
            x.btn.style.background = x.mode === mode ? 'var(--card-2)' : 'transparent';
            x.btn.style.color = x.mode === mode ? 'var(--accent-bright)' : 'var(--muted)';
            x.btn.style.fontWeight = x.mode === mode ? '600' : '400';
          });
          run();
        });
        segBtns.push({ btn: b, mode: m[0] });
        seg.appendChild(b);
      });

      var count = document.createElement('input');
      count.type = 'number';
      count.className = 'tf-input';
      count.value = '3';
      count.min = '1';
      count.max = '50';
      count.style.width = '110px';

      var classic = document.createElement('input');
      classic.type = 'checkbox';
      classic.checked = true;
      var classicLab = h('label', 'pw-opt');
      classicLab.style.cssText = 'display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-2);cursor:pointer';
      classicLab.appendChild(classic);
      classicLab.appendChild(h('span', null, '以「Lorem ipsum dolor sit amet」开头'));

      var out = makeTextarea('grow', '点击生成');
      out.readOnly = true;
      out.style.minHeight = '160px';

      function randWord() { return WORDS[Math.floor(Math.random() * WORDS.length)]; }
      function randSentence() {
        var n = 6 + Math.floor(Math.random() * 10);
        var ws = [];
        for (var i = 0; i < n; i++) ws.push(randWord());
        var s = ws.join(' ');
        return s.charAt(0).toUpperCase() + s.slice(1) + '.';
      }

      function run() {
        var n = Math.max(1, Math.min(50, parseInt(count.value, 10) || 3));
        count.value = String(n);
        var parts = [];
        if (mode === 'word') {
          var ws = [];
          if (classic.checked) ws = ['lorem', 'ipsum', 'dolor', 'sit', 'amet'].slice(0, n);
          while (ws.length < n) ws.push(randWord());
          parts.push(ws.join(' '));
        } else if (mode === 'sent') {
          for (var i = 0; i < n; i++) {
            parts.push(i === 0 && classic.checked
              ? 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
              : randSentence());
          }
        } else {
          for (var p = 0; p < n; p++) {
            var sents = [];
            var sc = 3 + Math.floor(Math.random() * 3);
            for (var s2 = 0; s2 < sc; s2++) {
              sents.push(p === 0 && s2 === 0 && classic.checked
                ? 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'
                : randSentence());
            }
            parts.push(sents.join(' '));
          }
        }
        out.value = parts.join('\n\n');
      }

      count.addEventListener('input', run);
      classic.addEventListener('change', run);

      var bGen = makeBtn('生成', true);
      bGen.addEventListener('click', run);
      var bCopy = copyBtn(function () { return out.value; });

      var topRow = h('div');
      topRow.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:4px';
      topRow.appendChild(seg);
      var cnt = h('label', 'tf');
      cnt.style.cssText = 'display:inline-flex;align-items:center;gap:8px;flex:none';
      cnt.appendChild(h('span', 'tf-label mono', '数量'));
      cnt.appendChild(count);
      topRow.appendChild(cnt);
      topRow.appendChild(classicLab);

      body.appendChild(topRow);
      body.appendChild(btnRow(bGen, bCopy));
      body.appendChild(out);
      run();
    },
  };

  function record(id) {
    if (!settingOn('toolHistory', true)) return; // 设置里关闭了使用记录
    var t = TOOLS[id];
    var name = t ? t.name : id;
    try {
      var list = JSON.parse(localStorage.getItem('fuo-recent-tools') || '[]');
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (x) { return x && x.id !== id; });
      list.unshift({ id: id, name: name, at: Date.now() });
      localStorage.setItem('fuo-recent-tools', JSON.stringify(list.slice(0, 12)));

      var count = parseInt(localStorage.getItem('fuo-tool-count') || '0', 10) || 0;
      localStorage.setItem('fuo-tool-count', String(count + 1));

      // v0.8：分工具热度（目录页「常用」置顶 / 命令面板排序加权）
      var heat = {};
      try { heat = JSON.parse(localStorage.getItem('fuo-tool-heat') || '{}') || {}; } catch (e) { heat = {}; }
      heat[id] = (heat[id] || 0) + 1;
      localStorage.setItem('fuo-tool-heat', JSON.stringify(heat));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  /* v0.8：热度榜 → 目录页顶部「常用」置顶区（仅本机记录，不上传） */
  function readHeat() {
    try {
      var o = JSON.parse(localStorage.getItem('fuo-tool-heat') || '{}');
      if (o && typeof o === 'object') return o;
    } catch (e) { /* ignore */ }
    return {};
  }

  function renderHotStrip(grid) {
    if (!settingOn('toolHistory', true)) return;
    var heat = readHeat();
    var arr = Object.keys(heat)
      .filter(function (slug) { return TOOLS[slug] && heat[slug] >= 2; })
      .sort(function (a, b) { return heat[b] - heat[a]; })
      .slice(0, 4);
    if (arr.length < 2) return; // 至少用过两个工具才展示

    var sec = h('section', 'tc-hot');
    sec.setAttribute('aria-label', '常用工具');
    var lab = h('p', 'tc-hot-label mono', '// 常用');
    sec.appendChild(lab);
    var row = h('div', 'tc-hot-row');
    arr.forEach(function (slug) {
      var t = TOOLS[slug];
      var a = h('a', 'tc-hot-chip');
      a.href = window.FUO_TOOL_URL ? window.FUO_TOOL_URL(slug) : slug + '/index.html';
      a.setAttribute('aria-label', '打开' + t.name + '（用过 ' + heat[slug] + ' 次）');
      a.innerHTML = '<i class="t-ic ' + t.tone + '" aria-hidden="true">' + svgFor(slug, 14) + '</i>' +
        '<b>' + t.name + '</b>' +
        '<span class="mono">×' + heat[slug] + '</span>';
      row.appendChild(a);
    });
    sec.appendChild(row);
    grid.parentNode.insertBefore(sec, grid);
  }

  /* =====================================================
   * 收藏（工具卡片星标）：favorites 表 kind='tool' ref=slug
   * ===================================================== */
  var favSb = null;
  var favSet = {};   // slug → true

  function favClient() {
    if (!favSb && window.supabase && CFG && CFG.SUPABASE_URL) {
      try { favSb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); } catch (e) {}
    }
    return favSb;
  }

  function loadFavs() {
    var c = favClient();
    if (!c || PREVIEW) return;
    c.auth.getSession().then(function (_a) {
      var s = _a.data && _a.data.session;
      if (!s) return;
      c.from('favorites').select('ref').eq('user_id', s.user.id).eq('kind', 'tool')
        .then(function (_b) {
          if (_b.error) return; // 表未就绪时静默（星星只是不可用）
          (_b.data || []).forEach(function (r) { favSet[r.ref] = true; });
          paintStars();
        });
    });
  }

  function paintStars() {
    var stars = document.querySelectorAll('.tc-star[data-slug]');
    Array.prototype.forEach.call(stars, function (b) {
      b.classList.toggle('is-on', !!favSet[b.getAttribute('data-slug')]);
      b.setAttribute('aria-pressed', String(!!favSet[b.getAttribute('data-slug')]));
    });
  }

  function toggleToolFav(slug, btn) {
    var c = favClient();
    if (!c) { miniToast('收藏功能需要登录后使用'); return; }
    var name = TOOLS[slug] ? TOOLS[slug].name : slug;
    c.auth.getSession().then(function (_a) {
      var s = _a.data && _a.data.session;
      if (!s) { miniToast('请先登录后再收藏'); return; }
      if (favSet[slug]) {
        c.from('favorites')
          .delete()
          .eq('user_id', s.user.id).eq('kind', 'tool').eq('ref', slug)
          .then(function (_b) {
            if (_b.error) { miniToast('取消收藏失败'); return; }
            delete favSet[slug];
            btn.classList.remove('is-on');
            btn.setAttribute('aria-pressed', 'false');
            miniToast('已取消收藏「' + name + '」');
          });
      } else {
        c.from('favorites')
          .insert({ user_id: s.user.id, kind: 'tool', ref: slug, title: name })
          .then(function (_b) {
            if (_b.error) {
              if (_b.error.code === '23505') { miniToast('已在收藏中'); return; }
              miniToast('收藏失败：' + (_b.error.message || '未知错误'));
              return;
            }
            favSet[slug] = true;
            btn.classList.add('is-on');
            btn.setAttribute('aria-pressed', 'true');
            miniToast('已收藏「' + name + '」，可在侧栏「收藏」查看');
          });
      }
    });
  }

  function starBtn(slug) {
    var b = h('button', 'tc-star' + (favSet[slug] ? ' is-on' : ''), '');
    b.type = 'button';
    b.setAttribute('data-slug', slug);
    b.setAttribute('aria-pressed', String(!!favSet[slug]));
    b.setAttribute('aria-label', '收藏或取消收藏：' + (TOOLS[slug] ? TOOLS[slug].name : slug));
    b.title = '收藏 / 取消收藏';
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5 14.3 9.3 19.5 10 15.7 13.6 16.6 19 12 16.4 7.4 19 8.3 13.6 4.5 10 9.7 9.3 12 4.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation(); // 卡片是 <a>：星标点击不应触发跳转
      toggleToolFav(slug, b);
    });
    return b;
  }

  /* =====================================================
   * 登录守卫：未登录 → 送回主页；被封禁 → 登出送回主页
   * ===================================================== */
  function guard() {
    if (PREVIEW) return;
    if (!window.supabase || !CFG || !CFG.SUPABASE_URL) return; // 无法校验时放行，由工作台兜底
    try {
      var client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
      client.auth.getSession().then(function (_a) {
        var session = _a.data && _a.data.session;
        if (!session && PATHS && PATHS.MAIN) {
          window.location.replace(PATHS.MAIN + '?next=tools');
          return;
        }
        if (!session) return;
        // 封禁检查（status 列不存在时静默跳过，不影响工具使用）
        client.from('profiles').select('status').eq('id', session.user.id).maybeSingle()
          .then(function (_b) {
            if (_b.data && _b.data.status === 'banned') {
              client.auth.signOut().then(function () {
                window.location.replace(PATHS.MAIN + '?banned=1');
              });
            }
          });
      });
    } catch (e) { /* ignore */ }
  }

  /* =====================================================
   * System 专属入口：目录页末尾追加 Terminal 卡片
   * 仅当登录者恰好是 System 时渲染（预览模式展示外壳）
   * ===================================================== */
  /* 云笔记卡：工具集第 9 位（所有登录用户可见） */
  function notesCard(idx) {
    var a = h('a', 'tc-card tc-card-notes');
    a.href = window.FUO_TOOL_URL ? window.FUO_TOOL_URL('notes') : 'notes/index.html';
    a.setAttribute('aria-label', '打开云笔记（多笔记 · 文件夹 · 云同步）');
    a.style.setProperty('--i', String(idx));

    var ic = h('i', 't-ic tc-card-ic tone-teal');
    ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M6 4h9l4 4v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5.5A1.5 1.5 0 0 1 6.5 4H6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14.5 4v4.5H19M8.5 13h7M8.5 16.5h4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

    var txt = h('div', 'tc-card-txt');
    txt.appendChild(h('b', null, '云笔记'));
    txt.appendChild(h('p', null, '多笔记 · 文件夹 · 快捷笔记 · 实时云同步'));

    a.appendChild(ic);
    a.appendChild(txt);
    a.appendChild(h('span', 'tc-go mono', '打开 →'));
    return a;
  }

  function adminCard(idx) {
    var url = window.FUO_TOOL_URL ? window.FUO_TOOL_URL('terminal') : 'terminal/index.html';
    var a = h('a', 'tc-card tc-card-admin');
    a.href = url;
    a.setAttribute('aria-label', '打开 Terminal（仅 System 账号可用）');
    a.style.setProperty('--i', String(idx)); // 入场交错动画排在最后

    var ic = h('i', 't-ic tc-card-ic tone-rose');
    ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">' +
      '<path d="M4 17l6-5-6-5M12 19h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var txt = h('div', 'tc-card-txt');
    txt.appendChild(h('b', null, 'Terminal'));
    txt.appendChild(h('p', null, 'SYSTEM ONLY · 账号管理控制台'));

    a.appendChild(ic);
    a.appendChild(txt);
    a.appendChild(h('span', 'tc-go mono', '进入 →'));
    return a;
  }

  function maybeAdminCard() {
    var grid = document.getElementById('tc-grid');
    if (!grid) return;
    if (PREVIEW) { grid.appendChild(adminCard(grid.children.length)); return; } // 预览：展示外壳
    if (!window.supabase || !CFG || !CFG.SUPABASE_URL) return;
    try {
      var c = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
      c.auth.getSession().then(function (_a) {
        var s = _a.data && _a.data.session;
        if (!s) return; // 未登录：目录页会被守卫送走，不渲染
        c.from('profiles').select('username').eq('id', s.user.id).maybeSingle()
          .then(function (_b) {
            if (_b.data && _b.data.username === 'System') {
              grid.appendChild(adminCard(grid.children.length));
            }
          });
      });
    } catch (e) { /* ignore */ }
  }

  /* =====================================================
   * 启动：区分目录页 / 工具页
   * ===================================================== */
  function svgFor(id, size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" aria-hidden="true">' + (SVG[id] || '') + '</svg>';
  }

  function renderCluster() {
    var grid = document.getElementById('tc-grid');
    if (!grid) return;
    var i = 0;
    Object.keys(TOOLS).forEach(function (slug) {
      var t = TOOLS[slug];
      var a = h('a', 'tc-card');
      a.href = window.FUO_TOOL_URL ? window.FUO_TOOL_URL(slug) : slug + '/index.html';
      a.setAttribute('aria-label', '打开' + t.name);
      a.style.setProperty('--i', String(i++)); // 入场交错动画（见 tool.css）

      var ic = h('i', 't-ic tc-card-ic ' + t.tone);
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = svgFor(slug, 18);

      var txt = h('div', 'tc-card-txt');
      txt.appendChild(h('b', null, t.name));
      txt.appendChild(h('p', null, t.desc));

      a.appendChild(ic);
      a.appendChild(txt);
      a.appendChild(h('span', 'tc-go mono', '打开 →'));
      if (!PREVIEW) a.appendChild(starBtn(slug)); // 收藏星标（预览模式不显示）
      grid.appendChild(a);
    });

    // 云笔记卡（第 9 张，所有登录用户可见）
    grid.appendChild(notesCard(i++));
  }

  function renderToolPage() {
    var slug = document.body.getAttribute('data-tool');
    var t = TOOLS[slug];
    if (!t) return;

    document.title = t.name + ' · Fuo Tools';

    var titleEl = document.getElementById('tool-title');
    if (titleEl) titleEl.textContent = t.name;
    var descEl = document.getElementById('tool-desc');
    if (descEl) descEl.textContent = t.desc;
    var iconEl = document.getElementById('tool-icon');
    if (iconEl) {
      iconEl.className = 't-ic tc-tool-ic ' + t.tone;
      iconEl.innerHTML = svgFor(slug, 20);
    }
    // 面包屑由共享的 sidebar.js 按 body[data-page/data-tool] 生成（可点击）

    var bodyEl = document.getElementById('tool-body');
    if (bodyEl) {
      bodyEl.innerHTML = '';
      t.render(bodyEl);
    }

    record(slug);
  }

  function setLinks() {
    var back = document.getElementById('back-cluster');
    if (back) back.href = PATHS.TOOL_CLUSTER;
    var back2 = document.getElementById('tc-back');
    if (back2) back2.href = PATHS.TOOL_CLUSTER;
    var home = document.getElementById('back-drive');
    if (home) home.href = PATHS.DRIVE;
  }

  function boot() {
    setLinks();
    if (document.body.getAttribute('data-page') === 'cluster') {
      renderHotStrip(document.getElementById('tc-grid'));
      renderCluster();
      maybeAdminCard();
      loadFavs();
    } else {
      renderToolPage();
    }
    guard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
