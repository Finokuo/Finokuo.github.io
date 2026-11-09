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

      var top = h('div', 'color-top');
      top.appendChild(picker);
      top.appendChild(preview);
      body.appendChild(top);
      body.appendChild(btnRow(bRand, copyBtn(function () { return rows.HEX.textContent; })));
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
      body.appendChild(btnRow(bGen, bCopy));
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

  /* =====================================================
   * 使用记录（与仪表盘「最近使用」共用 localStorage 键）
   * ===================================================== */
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
    } catch (e) { /* 隐私模式忽略 */ }
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

  function adminCard() {
    var url = window.FUO_TOOL_URL ? window.FUO_TOOL_URL('terminal') : 'terminal/index.html';
    var a = h('a', 'tc-card tc-card-admin');
    a.href = url;
    a.setAttribute('aria-label', '打开 Terminal（仅 System 账号可用）');
    a.style.setProperty('--i', '9'); // 入场交错动画排在最后

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
    if (PREVIEW) { grid.appendChild(adminCard()); return; } // 预览：展示外壳
    if (!window.supabase || !CFG || !CFG.SUPABASE_URL) return;
    try {
      var c = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
      c.auth.getSession().then(function (_a) {
        var s = _a.data && _a.data.session;
        if (!s) return; // 未登录：目录页会被守卫送走，不渲染
        c.from('profiles').select('username').eq('id', s.user.id).maybeSingle()
          .then(function (_b) {
            if (_b.data && _b.data.username === 'System') {
              grid.appendChild(adminCard());
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
