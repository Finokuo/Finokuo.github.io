/* =====================================================
 * Fuo Tools · AI 管理大师（office/ai/index.html 专用）
 *
 * 定位：一处指挥设备上所有的 AI —— 扫描 → 派发 → 回填归档。
 *
 * 数据（office_data 表，v6）：
 *   kind='aihub'        { device, detected, custom, lastScan }
 *   kind='aihub-tasks'  { list: [...] }
 *   未建表 / 未登录时自动降级「仅本机」模式（office-store.js 负责）。
 *
 * 扫描原理（诚实版，无后端）：
 *   · PC        → 隐藏 iframe 逐个加载自定义协议，浏览器弹「打开 xx？」
 *                 弹框 + 页面失焦/切走 = 已安装；可自动连扫。
 *   · iPhone    → 用户手势内 location.href 唤起（iOS 忽略 iframe 协议），
 *                 逐步向导，每次点击检测一个。
 *   · Android   → 用户手势内 iframe 唤起（直接导航未注册协议会跳出
 *                 错误页），逐步向导。
 *   探测 = blur / visibilitychange / pagehide 三信号，2.2s 窗口。
 *
 * 派发原理：指令复制到剪贴板 + 依次唤起目标（scheme / 网页版），
 *   每步都是真实点击触发（不被弹窗拦截器误伤）。
 *   受应用沙箱限制，AI 回复需用户回「任务台」归档。
 * ===================================================== */
(function () {
  'use strict';

  var PATHS = window.FUO_PATHS || {};
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;

  /* ---------- 内置 AI 注册表 ----------
   * scheme：iOS / Android 的 URL Scheme（PC 走网页版或自定义协议）
   * scheme 尽力核实过，个别应用若检测不到可手动标记——这是
   * URL Scheme 探测的天然局限。 */
  var BUILTIN = [
    { id: 'workbuddy', name: 'WorkBuddy',  emoji: '🤝', web: '',                 ios: '',            android: '' },
    { id: 'autoclaw',  name: 'AutoClaw',   emoji: '🐾', web: '',                 ios: '',            android: '' },
    { id: 'doubao',    name: '豆包',       emoji: '🫘', web: 'https://www.doubao.com/chat/',   ios: 'sslocal://',  android: 'sslocal://' },
    { id: 'qwen',      name: '通义千问',   emoji: '🟣', web: 'https://www.tongyi.com/',        ios: 'tongyi://',   android: 'tongyi://' },
    { id: 'kimi',      name: 'Kimi',       emoji: '🌙', web: 'https://kimi.moonshot.cn/',      ios: 'kimi://',     android: 'kimi://' },
    { id: 'deepseek',  name: 'DeepSeek',   emoji: '🐋', web: 'https://chat.deepseek.com/',     ios: 'deepseek://', android: 'deepseek://' },
    { id: 'chatglm',   name: '智谱清言',   emoji: '✨', web: 'https://chatglm.cn/',            ios: 'chatglm://',  android: 'chatglm://' },
    { id: 'yuanbao',   name: '腾讯元宝',   emoji: '🐠', web: 'https://yuanbao.tencent.com/',   ios: 'yuanbao://',  android: 'yuanbao://' },
    { id: 'yiyan',     name: '文心一言',   emoji: '☁️', web: 'https://yiyan.baidu.com/',       ios: 'yiyan://',    android: 'yiyan://' },
    { id: 'xinghuo',   name: '讯飞星火',   emoji: '🔥', web: 'https://xinghuo.xfyun.cn/',     ios: 'xinghuo://',  android: 'xinghuo://' },
    { id: 'chatgpt',   name: 'ChatGPT',    emoji: '🤖', web: 'https://chatgpt.com/',           ios: 'chatgpt://',  android: 'chatgpt://' },
    { id: 'claude',    name: 'Claude',     emoji: '📜', web: 'https://claude.ai/',             ios: 'claude://',   android: 'claude://' },
    { id: 'gemini',    name: 'Gemini',     emoji: '💠', web: 'https://gemini.google.com/',     ios: 'gemini://',   android: 'gemini://' },
    { id: 'copilot',   name: 'Copilot',    emoji: '🛸', web: 'https://copilot.microsoft.com/', ios: 'copilot://',  android: 'copilot://' },
  ];

  var DEVICE_NAMES = { pc: 'PC / 电脑', ios: 'iPhone', android: 'Android' };

  /* ---------- 状态 ---------- */
  var profile = { device: null, detected: {}, custom: [], lastScan: null };
  var tasks = { list: [] };
  var scan = { running: false, queue: [], idx: 0, manual: false };
  var taskFilter = 'all';
  var pickedTargets = {};
  var resultTarget = null;   // 回填弹窗对应任务
  var confirmFn = null;      // 确认弹窗回调

  var $ = function (id) { return document.getElementById(id); };
  var toastEl = null;

  function showToast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch (e) { return '—'; }
  }

  /* ---------- 数据层 ---------- */
  function saveProfile() {
    if (window.FUO_OFFICE) window.FUO_OFFICE.save('aihub', profile);
  }
  function saveTasks() {
    if (window.FUO_OFFICE) window.FUO_OFFICE.save('aihub-tasks', tasks);
  }

  function mergeProfile(d) {
    var p = {
      device: (d && (d.device === 'pc' || d.device === 'ios' || d.device === 'android')) ? d.device : null,
      detected: (d && d.detected && typeof d.detected === 'object') ? d.detected : {},
      custom: Array.isArray(d && d.custom) ? d.custom.filter(function (c) {
        return c && c.name && c.scheme;
      }) : [],
      lastScan: (d && d.lastScan) || null,
    };
    return p;
  }

  /* ---------- AI 合并视图 ---------- */
  function allAIs() {
    var list = BUILTIN.map(function (b) {
      return { id: b.id, name: b.name, emoji: b.emoji, web: b.web, ios: b.ios, android: b.android, custom: false };
    });
    (profile.custom || []).forEach(function (c) {
      list.push({ id: c.id, name: c.name, emoji: c.emoji || '🧩', web: c.web || '', ios: c.scheme || '', android: c.scheme || '', custom: true });
    });
    return list;
  }

  function aiById(id) {
    var found = null;
    allAIs().some(function (a) { if (a.id === id) { found = a; return true; } return false; });
    return found;
  }

  /* 当前设备下该 AI 的唤起 scheme（自定义条目任何设备都用它的 scheme） */
  function schemeOf(ai) {
    var dev = profile.device || 'pc';
    if (ai.custom) return ai.ios || '';          // 自定义条目 scheme 存 ios 字段
    if (dev === 'ios') return ai.ios || '';
    if (dev === 'android') return ai.android || '';
    return '';                                    // PC：内置条目无协议，走网页版
  }

  /* 可派发 = 已检出（yes）或 有网页版且未被标记为「未安装」 */
  function dispatchable(ai) {
    var d = profile.detected[ai.id];
    if (d === 'no') return false;
    if (d === 'yes') return true;
    return !!ai.web;
  }

  function badgeState(ai) {
    var d = profile.detected[ai.id];
    if (d === 'yes') return 'yes';
    if (d === 'no') return 'no';
    return ai.web ? 'web' : 'unknown';
  }

  var BADGE_TEXT = {
    yes: '✓ 已安装', no: '✕ 未安装', web: '🌐 网页版', unknown: '— 未测试',
  };

  /* ---------- Tab 切换 ---------- */
  function initTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.ai-tab'), function (t) {
      t.addEventListener('click', function () {
        var name = t.getAttribute('data-tab');
        Array.prototype.forEach.call(document.querySelectorAll('.ai-tab'), function (x) {
          var on = x === t;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-selected', String(on));
        });
        ['dev', 'send', 'list'].forEach(function (p) {
          $('ai-panel-' + p).hidden = p !== name;
        });
        if (name === 'send') renderTargets();
        if (name === 'list') renderTasks();
      });
    });
  }

  /* =====================================================
   * Tab 1 · 设备与 AI
   * ===================================================== */
  function renderDevices() {
    Array.prototype.forEach.call(document.querySelectorAll('.ai-device'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-device') === profile.device);
    });
    var hint = $('ai-dev-hint');
    if (!hint) return;
    if (profile.device) {
      hint.textContent = '当前设备：' + DEVICE_NAMES[profile.device] +
        (profile.lastScan ? ' · 上次扫描 ' + fmtTime(profile.lastScan) : ' · 尚未扫描');
      hint.classList.add('is-set');
    } else {
      hint.textContent = '尚未选择设备——扫描前请先告诉大师你在用什么设备。';
      hint.classList.remove('is-set');
    }
  }

  function initDevices() {
    Array.prototype.forEach.call(document.querySelectorAll('.ai-device'), function (b) {
      b.addEventListener('click', function () {
        if (scan.running) { showToast('扫描进行中，请先停止'); return; }
        profile.device = b.getAttribute('data-device');
        saveProfile();
        renderDevices();
        renderScan();
        renderList();
        renderTargets();
      });
    });
  }

  /* ---------- 扫描 ---------- */
  function scanCandidates() {
    // 依设备决定探测对象：有 scheme 的条目
    var dev = profile.device || 'pc';
    return allAIs().filter(function (ai) {
      if (dev === 'pc') return !!(ai.custom && schemeOf(ai)); // PC：仅自定义协议条目
      return !!schemeOf(ai);
    });
  }

  function renderScan() {
    var start = $('ai-scan-start');
    var stop = $('ai-scan-stop');
    var prog = $('ai-scan-progress');
    var log = $('ai-scan-log');
    if (!start) return;

    if (!profile.device) {
      start.disabled = true;
      start.textContent = '请先选择设备';
      stop.hidden = true;
      prog.hidden = true;
      return;
    }
    start.disabled = false;

    var cands = scanCandidates();
    if (scan.running) {
      start.hidden = true;
      stop.hidden = false;
      prog.hidden = false;
      if (scan.manual && scan.idx < scan.queue.length) {
        var cur = scan.queue[scan.idx];
        prog.textContent = '逐步向导 ' + (scan.idx + 1) + ' / ' + scan.queue.length + ' · 当前：' + cur.name;
        start.hidden = false;
        start.disabled = false;
        start.textContent = '▶ 唤起「' + cur.name + '」检测';
      } else {
        prog.textContent = '扫描中 ' + Math.min(scan.idx + 1, scan.queue.length) + ' / ' + scan.queue.length + '…';
      }
      log.hidden = false;
    } else {
      start.hidden = false;
      stop.hidden = true;
      prog.hidden = true;
      start.textContent = devScanLabel();
      if (!cands.length) start.disabled = true; // 没有可探测条目
    }
  }

  function devScanLabel() {
    var cands = scanCandidates();
    if (profile.device === 'pc') {
      return cands.length ? '开始扫描（' + cands.length + ' 个协议条目）'
        : '没有可探测的条目（PC 先到「自定义 AI」登记协议）';
    }
    return cands.length ? '开始扫描（' + cands.length + ' 个应用）' : '开始扫描';
  }

  /* 唤起探测：inGesture=true 时为用户手势内（移动端必须） */
  function triggerScheme(scheme) {
    var dev = profile.device || 'pc';
    if (dev === 'ios') {
      // iOS 忽略 iframe 协议，必须导航；已安装时页面切走，回来后 Promise 继续
      window.location.href = scheme;
      return null;
    }
    var f = document.createElement('iframe');
    f.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;border:0;opacity:0';
    f.setAttribute('aria-hidden', 'true');
    f.src = scheme;
    document.body.appendChild(f);
    return f;
  }

  /* 三信号探测：2.2s 内页面切走 / 失焦 / pagehide → 已安装 */
  function watchProbe(frame, ms) {
    return new Promise(function (resolve) {
      var gone = false;
      function mark() { gone = true; }
      function onVis() { if (document.hidden) mark(); }
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('pagehide', mark);
      window.addEventListener('blur', mark);
      setTimeout(function () {
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', mark);
        window.removeEventListener('blur', mark);
        if (frame && frame.parentNode) { try { frame.remove(); } catch (e) { /* ignore */ } }
        resolve(gone);
      }, ms || 2200);
    });
  }

  function scanLogLine(html, cls) {
    var log = $('ai-scan-log');
    if (!log) return;
    var p = document.createElement('p');
    if (cls) p.className = cls;
    p.innerHTML = html;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }

  function beginScan() {
    if (scan.running) { showToast('扫描已在进行'); return; }
    if (PREVIEW) { showToast('预览模式：不执行真实唤起'); return; }
    if (!profile.device) { showToast('请先选择设备类型'); return; }
    var cands = scanCandidates();
    if (!cands.length) {
      showToast(profile.device === 'pc'
        ? 'PC 上没有可探测的协议条目——先到「自定义 AI」登记 WorkBuddy 等'
        : '没有可探测的应用');
      return;
    }
    scan = { running: true, queue: cands, idx: 0, manual: profile.device !== 'pc' };
    var log = $('ai-scan-log');
    if (log) { log.innerHTML = ''; log.hidden = false; }
    scanLogLine('// 开始扫描 ' + DEVICE_NAMES[profile.device] + ' · 共 ' + cands.length + ' 个条目', 'lg-cur');
    if (scan.manual) {
      scanLogLine('· 逐步向导已开启：每次点击「唤起检测」，弹出「打开应用？」时选择「打开」', 'lg-skip');
    }
    renderScan();
    if (!scan.manual) stepAuto();
  }

  /* PC：自动连扫 */
  function stepAuto() {
    if (!scan.running) return;
    if (scan.idx >= scan.queue.length) { finishScan(); return; }
    var ai = scan.queue[scan.idx];
    scanLogLine('→ 尝试唤起 ' + ai.emoji + ' ' + esc(ai.name) + ' …', 'lg-cur');
    renderScan();
    var f = triggerScheme(schemeOf(ai));
    watchProbe(f, 2400).then(function (gone) {
      if (!scan.running) return;
      applyDetect(ai, gone ? 'yes' : 'no');
      scanLogLine(gone ? '✓ ' + esc(ai.name) + ' 已检出' : '✗ ' + esc(ai.name) + ' 未检出（可手动标记）', gone ? 'lg-ok' : 'lg-no');
      scan.idx++;
      setTimeout(stepAuto, 500);
    });
  }

  /* 手机：用户点击「唤起检测」 */
  function stepManual() {
    if (!scan.running || !scan.manual) return;
    if (scan.idx >= scan.queue.length) { finishScan(); return; }
    var ai = scan.queue[scan.idx];
    scanLogLine('→ 唤起 ' + ai.emoji + ' ' + esc(ai.name) + ' …（弹出确认框请选「打开」）', 'lg-cur');
    var f = triggerScheme(schemeOf(ai));
    watchProbe(f, 2400).then(function (gone) {
      if (!scan.running) return;
      applyDetect(ai, gone ? 'yes' : 'no');
      scanLogLine(gone ? '✓ ' + esc(ai.name) + ' 已检出' : '✗ ' + esc(ai.name) + ' 未检出（可手动标记）', gone ? 'lg-ok' : 'lg-no');
      scan.idx++;
      renderScan();
      renderList();
      if (scan.idx >= scan.queue.length) finishScan();
    });
  }

  function applyDetect(ai, val) {
    profile.detected[ai.id] = val;
    saveProfile();
  }

  function finishScan() {
    scanLogLine('// 扫描完成 · 结果已保存' + (window.FUO_OFFICE && window.FUO_OFFICE.status() === 'cloud' ? '（云同步）' : '（本机）'), 'lg-cur');
    profile.lastScan = new Date().toISOString();
    saveProfile();
    scan.running = false;
    renderScan();
    renderList();
    renderDevices();
    renderTargets();
    showToast('扫描完成，清单已更新');
  }

  function initScan() {
    var start = $('ai-scan-start');
    var stop = $('ai-scan-stop');
    if (start) {
      start.addEventListener('click', function () {
        if (scan.running && scan.manual) { stepManual(); return; }
        beginScan();
      });
    }
    if (stop) {
      stop.addEventListener('click', function () {
        scan.running = false;
        scanLogLine('■ 已停止', 'lg-skip');
        renderScan();
      });
    }
  }

  /* ---------- 清单 ---------- */
  function renderList() {
    var box = $('ai-list');
    if (!box) return;
    var ais = allAIs();
    if (!ais.length) {
      box.innerHTML = '<p class="of-empty">清单为空。</p>';
      return;
    }
    var html = '';
    ais.forEach(function (ai) {
      var st = badgeState(ai);
      var scheme = schemeOf(ai);
      var sub = scheme ? (esc(scheme) + (ai.web ? ' · ' + esc(ai.web.replace(/^https?:\/\//, '')) : ''))
                       : (ai.web ? esc(ai.web) : '无协议 · 请在「自定义 AI」补充');
      html +=
        '<div class="ai-row">' +
          '<span class="ai-emoji" aria-hidden="true">' + ai.emoji + '</span>' +
          '<span class="ai-info"><b>' + esc(ai.name) + (ai.custom ? ' <small style="color:var(--faint)">·自定义</small>' : '') + '</b>' +
            '<small class="mono">' + sub + '</small></span>' +
          '<button class="ai-badge is-' + st + '" data-cycle="' + ai.id + '" type="button" title="点击切换：未测试 → 已安装 → 未安装">' + BADGE_TEXT[st] + '</button>' +
          '<button class="ai-try" data-try="' + ai.id + '" type="button" title="唤起一次试试">测试</button>' +
        '</div>';
    });
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('[data-cycle]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-cycle');
        var cur = profile.detected[id];
        var next = cur === 'yes' ? 'no' : cur === 'no' ? 'unknown' : 'yes';
        if (next === 'unknown') delete profile.detected[id];
        else profile.detected[id] = next;
        saveProfile();
        renderList();
        renderTargets();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-try]'), function (b) {
      b.addEventListener('click', function () {
        var ai = aiById(b.getAttribute('data-try'));
        if (ai) openAI(ai, true);
      });
    });
  }

  /* ---------- 自定义 AI ---------- */
  function renderCustomList() {
    var box = $('ai-custom-list');
    if (!box) return;
    var list = profile.custom || [];
    if (!list.length) {
      box.innerHTML = '<p class="of-empty" style="padding:14px">还没有登记自定义 AI。</p>';
      return;
    }
    var html = '';
    list.forEach(function (c) {
      html +=
        '<div class="ai-custom-item">' +
          '<b>' + esc(c.name) + '</b>' +
          '<code>' + esc(c.scheme) + (c.web ? ' · ' + esc(c.web) : '') + '</code>' +
          '<button class="ai-x" data-del="' + esc(c.id) + '" type="button" title="删除该条目" aria-label="删除 ' + esc(c.name) + '">✕</button>' +
        '</div>';
    });
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        profile.custom = profile.custom.filter(function (c) { return c.id !== id; });
        saveProfile();
        renderCustomList();
        renderList();
        renderTargets();
        renderScan();
        showToast('已删除该条目');
      });
    });
  }

  function initCustomForm() {
    var add = $('ai-c-add');
    if (!add) return;
    add.addEventListener('click', function () {
      var name = ($('ai-c-name').value || '').trim();
      var scheme = ($('ai-c-scheme').value || '').trim();
      var web = ($('ai-c-web').value || '').trim();
      if (!name) { showToast('请填写名称'); return; }
      if (!scheme && !web) { showToast('Scheme 和网页版至少填一个'); return; }
      if (scheme && !/^[a-z][a-z0-9+.-]*:\/\//i.test(scheme)) {
        showToast('Scheme 格式应形如 workbuddy://');
        return;
      }
      if (web && !/^https?:\/\//i.test(web)) {
        showToast('网页版地址需以 http(s):// 开头');
        return;
      }
      profile.custom.push({ id: uid('c'), name: name, scheme: scheme, web: web });
      saveProfile();
      $('ai-c-name').value = ''; $('ai-c-scheme').value = ''; $('ai-c-web').value = '';
      renderCustomList();
      renderList();
      renderTargets();
      renderScan();
      showToast('已登记「' + name + '」，可以扫描或直接派发了');
    });
  }

  /* =====================================================
   * Tab 2 · 派发任务
   * ===================================================== */
  function renderTargets() {
    var box = $('ai-targets');
    if (!box) return;
    var ok = allAIs().filter(dispatchable);
    if (!ok.length) {
      box.innerHTML = '<p class="of-empty" style="padding:14px 8px">清单里还没有可用 AI——先到「设备与 AI」标记几个，或登记自定义 AI。</p>';
      return;
    }
    var html = '';
    ok.forEach(function (ai) {
      var on = !!pickedTargets[ai.id];
      var dim = !on && ai.web && !profile.detected[ai.id] ? '' : '';
      html += '<button class="ai-chip' + (on ? ' is-on' : '') + dim + '" data-pick="' + ai.id + '" type="button">' +
        '<span aria-hidden="true">' + ai.emoji + '</span>' + esc(ai.name) +
        (badgeState(ai) === 'web' ? ' <small class="mono" style="opacity:.6">网页</small>' : '') +
        '</button>';
    });
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('[data-pick]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-pick');
        if (pickedTargets[id]) delete pickedTargets[id];
        else pickedTargets[id] = true;
        renderTargets();
      });
    });
  }

  function pickedList() {
    return Object.keys(pickedTargets).map(aiById).filter(Boolean);
  }

  function collectForm() {
    var title = ($('ai-t-title').value || '').trim();
    var prompt = ($('ai-t-prompt').value || '').trim();
    var targets = pickedList().map(function (a) { return a.id; });
    if (!title) { showToast('请填写任务标题'); return null; }
    if (!prompt) { showToast('请填写指令全文'); return null; }
    if (!targets.length) { showToast('请至少选择一个目标 AI'); return null; }
    return { title: title, prompt: prompt, targets: targets };
  }

  /* 唤起一个 AI（scheme 优先，其次网页版）。test=true 时只是测试 */
  function openAI(ai, isTest) {
    var scheme = schemeOf(ai);
    if (scheme) {
      if (profile.device === 'ios') {
        window.location.href = scheme;
      } else {
        var f = document.createElement('iframe');
        f.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;border:0;opacity:0';
        f.src = scheme;
        document.body.appendChild(f);
        setTimeout(function () { try { f.remove(); } catch (e) { /* ignore */ } }, 4000);
      }
      if (!isTest) showToast('已唤起「' + ai.name + '」· 指令在剪贴板，粘贴发送即可');
      return true;
    }
    if (ai.web) {
      window.open(ai.web, '_blank', 'noopener');
      if (!isTest) showToast('已打开「' + ai.name + '」网页版 · 指令在剪贴板');
      return true;
    }
    if (!isTest) showToast('「' + ai.name + '」没有可用的唤起方式');
    return false;
  }

  function copyText(text) {
    var done = function () { return Promise.resolve(true); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (e) { /* ignore */ }
    return true;
  }

  /* 派发：复制 → 状态 sending → 打开第一个 */
  function startDispatch(form) {
    var t = {
      id: uid('t'),
      title: form.title,
      prompt: form.prompt,
      targets: form.targets,
      status: 'sending',
      opened: 0,
      result: '',
      file: '',
      createdAt: new Date().toISOString(),
      sentAt: null,
      doneAt: null,
    };
    tasks.list.unshift(t);
    saveTasks();
    $('ai-t-title').value = '';
    $('ai-t-prompt').value = '';
    pickedTargets = {};
    renderTargets();

    copyText(form.prompt).then(function () {
      var first = aiById(t.targets[0]);
      if (first) {
        t.opened = 1;
        saveTasks();
        openAI(first, false);
      } else {
        t.status = 'sent';
        t.sentAt = new Date().toISOString();
        saveTasks();
      }
      if (t.opened >= t.targets.length && t.status === 'sending') {
        t.status = 'sent';
        t.sentAt = new Date().toISOString();
        saveTasks();
      }
      renderTasks();
      updateTabCount();
      switchTab('list');
      showToast(t.targets.length > 1
        ? '派发开始：第一个已唤起，回任务台继续打开其余'
        : '已唤起 · 指令在剪贴板');
    });
  }

  function initSend() {
    var send = $('ai-send');
    var draft = $('ai-draft');
    if (send) {
      send.addEventListener('click', function () {
        var form = collectForm();
        if (!form) return;
        var names = pickedList().map(function (a) { return a.name; }).join('、');
        openConfirm('将把指令复制到剪贴板，并唤起：' + names + '。唤起后你在各 AI 里粘贴发送即可。确定开始？',
          function () { startDispatch(form); });
      });
    }
    if (draft) {
      draft.addEventListener('click', function () {
        var form = collectForm();
        if (!form) return;
        tasks.list.unshift({
          id: uid('t'),
          title: form.title,
          prompt: form.prompt,
          targets: form.targets,
          status: 'draft',
          opened: 0,
          result: '',
          file: '',
          createdAt: new Date().toISOString(),
          sentAt: null,
          doneAt: null,
        });
        saveTasks();
        $('ai-t-title').value = '';
        $('ai-t-prompt').value = '';
        pickedTargets = {};
        renderTargets();
        renderTasks();
        updateTabCount();
        switchTab('list');
        showToast('已存为草稿');
      });
    }
  }

  /* =====================================================
   * Tab 3 · 任务台
   * ===================================================== */
  var ST_TEXT = { draft: '草稿', sending: '派发中', sent: '进行中', done: '已完成' };

  function switchTab(name) {
    var btn = $('ai-tab-btn-' + name);
    if (btn) btn.click();
  }

  function updateTabCount() {
    var el = $('ai-tab-count');
    if (!el) return;
    var n = tasks.list.length;
    if (n) { el.textContent = String(n); el.hidden = false; }
    else el.hidden = true;
  }

  function renderTasks() {
    var box = $('ai-tasks');
    if (!box) return;

    var counts = { all: tasks.list.length, sending: 0, sent: 0, draft: 0, done: 0 };
    tasks.list.forEach(function (t) { counts[t.status] = (counts[t.status] || 0) + 1; });
    ['all', 'sending', 'sent', 'draft', 'done'].forEach(function (k) {
      var el = $('ai-f-' + k);
      if (el) el.textContent = counts[k] || 0;
    });

    var list = tasks.list.filter(function (t) {
      return taskFilter === 'all' ? true : t.status === taskFilter;
    });
    if (!list.length) {
      box.innerHTML = '<p class="of-empty">这里空空如也。' +
        (taskFilter === 'all' ? '到「派发任务」给 AI 们安排第一件事吧。' : '该筛选下没有任务。') + '</p>';
      return;
    }

    var html = '';
    list.forEach(function (t) {
      var targetChips = t.targets.map(function (id, i) {
        var ai = aiById(id);
        var opened = t.status === 'done' || (t.status === 'sent') || (t.status === 'sending' && i < t.opened);
        return '<span class="tt' + (opened ? ' is-opened' : '') + '">' +
          (ai ? ai.emoji + ' ' + esc(ai.name) : '·已删') + '</span>';
      }).join('');

      var ops = '';
      if (t.status === 'draft') {
        ops += '<button class="tbtn is-primary" data-op="go" data-id="' + t.id + '" type="button">🚀 派发</button>';
      } else if (t.status === 'sending') {
        if (t.opened < t.targets.length) {
          ops += '<button class="tbtn is-primary" data-op="next" data-id="' + t.id + '" type="button">▶ 打开下一个（' + (t.opened + 1) + ' / ' + t.targets.length + '）</button>';
        }
        ops += '<button class="tbtn" data-op="fill" data-id="' + t.id + '" type="button">回填结果</button>';
      } else if (t.status === 'sent') {
        ops += '<button class="tbtn is-primary" data-op="fill" data-id="' + t.id + '" type="button">回填结果</button>';
        ops += '<button class="tbtn" data-op="go" data-id="' + t.id + '" type="button">再次派发</button>';
      } else if (t.status === 'done') {
        ops += '<button class="tbtn" data-op="fill" data-id="' + t.id + '" type="button">编辑结果</button>';
        ops += '<button class="tbtn" data-op="go" data-id="' + t.id + '" type="button">再次派发</button>';
      }
      ops += '<button class="tbtn ai-del" data-op="del" data-id="' + t.id + '" type="button">删除</button>';

      var result = '';
      if (t.status === 'done' && (t.result || t.file)) {
        result += '<div class="ai-task-result">';
        result += '<p class="rr-t mono">// RESULT' + (t.doneAt ? ' · ' + fmtTime(t.doneAt) : '') + '</p>';
        if (t.result) result += '<p>' + esc(t.result) + '</p>';
        if (t.file) {
          var isUrl = /^https?:\/\//i.test(t.file);
          result += '<p class="rr-file mono">📦 交付：' + (isUrl
            ? '<a href="' + esc(t.file) + '" target="_blank" rel="noopener">' + esc(t.file) + '</a>'
            : esc(t.file)) + '</p>';
        }
        result += '</div>';
      }

      html +=
        '<div class="ai-task' + (t.status === 'done' ? ' is-done' : '') + '">' +
          '<div class="ai-task-head">' +
            '<b>' + esc(t.title) + '</b>' +
            '<span class="ai-st is-' + t.status + ' mono">' + ST_TEXT[t.status] + '</span>' +
          '</div>' +
          '<div class="ai-task-targets">' + targetChips + '</div>' +
          '<p class="ai-task-prompt">' + esc(t.prompt) + '</p>' +
          result +
          '<div class="ai-task-ops">' + ops +
            '<span class="ai-task-time mono">' + fmtTime(t.createdAt) + ' 创建' +
            (t.sentAt ? ' · ' + fmtTime(t.sentAt) + ' 派发' : '') + '</span>' +
          '</div>' +
        '</div>';
    });
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('[data-op]'), function (b) {
      b.addEventListener('click', function () { onTaskOp(b.getAttribute('data-op'), b.getAttribute('data-id'), b); });
    });
  }

  function taskById(id) {
    var f = null;
    tasks.list.some(function (t) { if (t.id === id) { f = t; return true; } return false; });
    return f;
  }

  function onTaskOp(op, id, btn) {
    var t = taskById(id);
    if (!t) return;

    if (op === 'go') {
      // 再次派发 / 草稿派发：复制并打开第一个
      copyText(t.prompt).then(function () {
        t.status = 'sending';
        t.opened = 1;
        t.sentAt = null;
        t.doneAt = null;
        var first = aiById(t.targets[0]);
        if (first) openAI(first, false);
        if (t.opened >= t.targets.length) {
          t.status = 'sent';
          t.sentAt = new Date().toISOString();
        }
        saveTasks();
        renderTasks();
        showToast(t.targets.length > 1 ? '重新派发：第一个已唤起' : '已唤起 · 指令在剪贴板');
      });
    } else if (op === 'next') {
      var next = aiById(t.targets[t.opened]);
      copyText(t.prompt); // 再备一份，防剪贴板被覆盖
      if (next) {
        t.opened++;
        openAI(next, false);
      }
      if (t.opened >= t.targets.length) {
        t.status = 'sent';
        t.sentAt = new Date().toISOString();
        showToast('全部目标已唤起');
      }
      saveTasks();
      renderTasks();
    } else if (op === 'fill') {
      openResultModal(t);
    } else if (op === 'del') {
      // 两段式删除，防误触
      if (btn.classList.contains('ai-del-confirm')) {
        tasks.list = tasks.list.filter(function (x) { return x.id !== id; });
        saveTasks();
        renderTasks();
        updateTabCount();
        showToast('任务已删除');
      } else {
        btn.classList.add('ai-del-confirm');
        btn.textContent = '确认删除？';
        setTimeout(function () {
          btn.classList.remove('ai-del-confirm');
          btn.textContent = '删除';
        }, 2600);
      }
    }
  }

  function initFilters() {
    Array.prototype.forEach.call(document.querySelectorAll('.ai-filter'), function (b) {
      b.addEventListener('click', function () {
        taskFilter = b.getAttribute('data-f');
        Array.prototype.forEach.call(document.querySelectorAll('.ai-filter'), function (x) {
          var on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-selected', String(on));
        });
        renderTasks();
      });
    });
  }

  /* ---------- 回填弹窗 ---------- */
  function openResultModal(t) {
    resultTarget = t;
    $('ai-r-text').value = t.result || '';
    $('ai-r-file').value = t.file || '';
    $('ai-result-sub').textContent = '「' + t.title + '」· 记录 AI 的回复与交付';
    $('ai-modal-result').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $('ai-r-text').focus(); }, 60);
  }
  function closeResultModal() {
    $('ai-modal-result').hidden = true;
    document.body.style.overflow = '';
    resultTarget = null;
  }

  function initModals() {
    var m = $('ai-modal-result');
    m.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-ai-close]')) closeResultModal();
    });
    $('ai-r-save').addEventListener('click', function () {
      if (!resultTarget) { closeResultModal(); return; }
      resultTarget.result = $('ai-r-text').value.trim();
      resultTarget.file = $('ai-r-file').value.trim();
      resultTarget.status = 'done';
      resultTarget.doneAt = new Date().toISOString();
      saveTasks();
      closeResultModal();
      renderTasks();
      updateTabCount();
      showToast('结果已归档，任务完结 ✓');
    });

    var cm = $('ai-modal-confirm');
    cm.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-ai-cancel]')) {
        cm.hidden = true;
        confirmFn = null;
      }
    });
    $('ai-confirm-ok').addEventListener('click', function () {
      cm.hidden = true;
      var fn = confirmFn;
      confirmFn = null;
      if (fn) fn();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('ai-modal-result').hidden) closeResultModal();
      if (!$('ai-modal-confirm').hidden) { $('ai-modal-confirm').hidden = true; confirmFn = null; }
    });
  }

  function openConfirm(text, fn) {
    confirmFn = fn;
    $('ai-confirm-text').textContent = text;
    $('ai-modal-confirm').hidden = false;
  }

  /* ---------- 同步徽标 ---------- */
  function initSync() {
    if (!window.FUO_OFFICE) return;
    window.FUO_OFFICE.onStatus(function (s) {
      var chip = $('ai-sync');
      var txt = $('ai-sync-txt');
      if (!chip || !txt) return;
      chip.className = 'of-sync is-' + s;
      txt.textContent = s === 'cloud' ? '云同步 ✓'
        : s === 'saving' ? '同步中…'
        : s === 'error' ? '云端暂不可达 · 本地已保存'
        : '仅本机 · 执行 supabase-v6.sql 开启云同步';
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    toastEl = $('toast');
    var back = $('ai-back');
    if (back) back.href = PATHS.DRIVE || '../../';

    initTabs();
    initDevices();
    initScan();
    initCustomForm();
    initSend();
    initFilters();
    initModals();
    initSync();
    renderDevices();
    renderScan();
    renderCustomList();
    renderTargets();

    if (window.FUO_OFFICE) {
      window.FUO_OFFICE.load('aihub', { device: null, detected: {}, custom: [], lastScan: null }, function (d) {
        profile = mergeProfile(d);
        renderDevices();
        renderScan();
        renderList();
        renderCustomList();
        renderTargets();
      });
      window.FUO_OFFICE.load('aihub-tasks', { list: [] }, function (d) {
        tasks = (d && Array.isArray(d.list)) ? d : { list: [] };
        renderTasks();
        updateTabCount();
      });
    } else {
      renderList();
      renderTasks();
    }

    if (PREVIEW) {
      var n1 = $('sb-name');
      var s1 = $('sb-state');
      if (n1) n1.textContent = '预览模式';
      if (s1) s1.textContent = 'preview';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
