/* =====================================================
 * Fuo Tools · 内置小工具（纯前端，零依赖，离线可用）
 * 8 款：JSON / 颜色 / 密码 / 文本统计 / 时间戳 / Base64 / UUID / Diff
 * 每次使用写入 localStorage（最近使用 + 次数），并广播
 * 'fuo:tool-used' 事件供 app.js 刷新工作台卡片。
 * ===================================================== */
(function () {
  'use strict';

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
   * 工具注册表
   * ===================================================== */
  var TOOLS = {};

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

      var cUp = document.createElement('input'); cUp.type = 'checkbox'; cUp.checked = true; cUp.id = 'pw-up';
      var cNum = document.createElement('input'); cNum.type = 'checkbox'; cNum.checked = true; cNum.id = 'pw-num';
      var cSym = document.createElement('input'); cSym.type = 'checkbox'; cSym.checked = true; cSym.id = 'pw-sym';
      var cAmb = document.createElement('input'); cAmb.type = 'checkbox'; cAmb.id = 'pw-amb';

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
        $('ts-chars').textContent = chars.toLocaleString();
        $('ts-words').textContent = words.toLocaleString();
        $('ts-lines').textContent = lines.toLocaleString();
        $('ts-paras').textContent = paras.toLocaleString();
        $('ts-sents').textContent = sents.toLocaleString();
        $('ts-read').textContent = words ? (mins + ' 分钟') : '0';
      }
      function $(id) { return document.getElementById(id); }
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
        /* dp[i][j] = A[i..] 与 B[j..] 的最长公共子序列长度 */
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
   * 弹窗控制 + 使用记录
   * ===================================================== */
  var modal = null, body = null, titleEl = null, descEl = null, iconEl = null;
  var current = null;

  function record(id, name) {
    try {
      var list = JSON.parse(localStorage.getItem('fuo-recent-tools') || '[]');
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (x) { return x && x.id !== id; });
      list.unshift({ id: id, name: name, at: Date.now() });
      localStorage.setItem('fuo-recent-tools', JSON.stringify(list.slice(0, 12)));

      var count = parseInt(localStorage.getItem('fuo-tool-count') || '0', 10) || 0;
      localStorage.setItem('fuo-tool-count', String(count + 1));
    } catch (e) { /* 隐私模式忽略 */ }
    document.dispatchEvent(new CustomEvent('fuo:tool-used'));
  }

  function open(id) {
    var t = TOOLS[id];
    if (!t || !modal) return;
    current = id;
    titleEl.textContent = t.name;
    descEl.textContent = t.desc;
    iconEl.className = 't-ic modal-tool-ic ' + t.tone;
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none">' +
      document.querySelector('[data-tool="' + id + '"] svg').innerHTML + '</svg>';
    body.innerHTML = '';
    t.render(body);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    record(id, t.name);
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    body.innerHTML = '';
    current = null;
  }

  function boot() {
    modal = document.getElementById('tool-modal');
    if (!modal) return;
    body = document.getElementById('tool-body');
    titleEl = document.getElementById('tool-title');
    descEl = document.getElementById('tool-desc');
    iconEl = document.getElementById('tool-icon');

    document.querySelectorAll('[data-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () { open(btn.getAttribute('data-tool')); });
    });
    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-tool-close]')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) close();
    });

    /* 侧栏“工具集”入口：滚动到工具卡片 */
    var sideTool = document.querySelector('.side-item.is-soon[data-soon="工具集正在筹备中"]');
    if (sideTool) {
      sideTool.removeAttribute('data-soon');
      sideTool.classList.remove('is-soon');
      var i = sideTool.querySelector('i');
      if (i) i.remove();
      sideTool.addEventListener('click', function (e) {
        e.preventDefault();
        var card = document.querySelector('.card-tools');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.style.boxShadow = '0 0 0 2px var(--field-focus)';
          setTimeout(function () { card.style.boxShadow = ''; }, 900);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
