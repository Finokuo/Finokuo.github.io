/* =====================================================
 * Fuo Tools · Terminal 引擎（System 管理控制台）
 * 身份链路：session → profiles.username 必须恰好是 "System"
 *   未登录   → 送回主页（与其它工具页一致）
 *   已登录但非 System → 拒绝面板（数据库 RLS 是真正防线）
 *   System  → 渲染终端，命令直连 Supabase
 * 安全说明：管理权由数据库 RLS/触发器保证（supabase-admin.sql），
 *   本页面的门禁只是体验层；改前端无法冒充管理员。
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;
  var USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
  var ADMIN_NAME = 'System';

  var sb = null;
  var me = null;          // { id, username, email }
  var out = null;         // 输出区 DOM
  var input = null;
  var hist = [];          // 命令历史
  var histIdx = -1;

  /* ---------- 小工具 ---------- */
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function esc(s) { return String(s == null ? '' : s); }
  function pad(s, n) {
    s = esc(s);
    return s.length >= n ? s.slice(0, n) : s + new Array(n - s.length + 1).join(' ');
  }
  function trunc(s, n) {
    s = esc(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function fmtDate(iso) {
    if (!iso) return '-';
    try { return new Date(iso).toISOString().slice(0, 10); } catch (e) { return '-'; }
  }
  function dbHint(err) {
    var m = (err && err.message) || '';
    if (err && (err.code === '42P01' || err.code === 'PGRST205' ||
        /could not find the table|schema cache/i.test(m))) {
      return 'profiles 表不存在：请先执行 supabase-setup.sql。';
    }
    if (err && (err.code === 'PGRST204' ||
        /could not find the column/i.test(m))) {
      return '缺少 status 列：请在 SQL Editor 执行 supabase-admin.sql（v3 增量）。';
    }
    if (err && (err.code === '42501' || /row-level security/i.test(m))) {
      return '没有权限：请确认当前登录的是 System 账号，且已执行 supabase-admin.sql。';
    }
    if (/FUO_ADMIN_ONLY|FUO_SYSTEM_SELF_BAN|FUO_SYSTEM_RENAME/.test(m)) {
      return m; // 触发器抛出的中文提示，直接透出
    }
    if (err && (err.code === '23505' || /duplicate key/i.test(m))) {
      return '该用户名已被占用。';
    }
    if (err && err.code === '23514') {
      return '用户名格式不合法（3-20 位字母/数字/下划线）。';
    }
    return '数据库错误：' + (m || '未知');
  }

  /* ---------- 输出 ---------- */
  function print(text, cls) {
    if (!out) return;
    var line = h('div', 'tl' + (cls ? ' ' + cls : ''), null);
    line.textContent = text == null ? '' : String(text);
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
    return line;
  }
  function printRich(parts) {
    // parts: [{t:'文字', b:true}, ...]
    if (!out) return;
    var line = h('div', 'tl');
    parts.forEach(function (p) {
      var n = p.b ? h('b', null, p.t) : document.createTextNode(p.t);
      line.appendChild(n);
    });
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }
  function echoCmd(cmd) {
    printRich([{ t: ADMIN_NAME + '@fuo:~$ ', b: false }, { t: cmd, b: true }]);
  }

  /* ---------- 查询助手 ---------- */
  function q(sql) { // sql(promise) → {data,error}，吞掉 reject 转 error
    return sql.then(function (r) { return r; }, function (e) { return { error: e }; });
  }
  function getProfileByUsername(username) {
    return q(sb.from('profiles')
      .select('id,username,email,status,created_at')
      .eq('username', username)
      .maybeSingle());
  }

  /* ---------- 命令表 ---------- */
  var CMDS = {
    help: {
      desc: '显示所有命令',
      run: function () {
        print('可用命令：', '_dim');
        Object.keys(CMDS).forEach(function (k) {
          printRich([{ t: '  ' + pad(k, 10), b: true }, { t: CMDS[k].desc }]);
        });
      }
    },
    whoami: {
      desc: '当前登录身份',
      run: function () {
        printRich([{ t: '  用户名  : ', b: true }, { t: me.username }]);
        printRich([{ t: '  邮箱    : ', b: true }, { t: me.email || '-' }]);
        printRich([{ t: '  用户 ID : ', b: true }, { t: me.id }]);
        printRich([{ t: '  权限    : ', b: true }, { t: 'SYSTEM (管理员)' }]);
      }
    },
    users: {
      desc: '列出所有账号',
      run: function () {
        if (PREVIEW) return previewUsers();
        print('查询中…', '_dim');
        q(sb.from('profiles')
          .select('username,email,status,created_at')
          .order('created_at', { ascending: true })
          .limit(200)).then(function (r) {
            if (r.error) return print(dbHint(r.error), '_err');
            renderUsers(r.data || []);
          });
      }
    },
    find: {
      desc: '按用户名/邮箱关键词查找  find <关键词>',
      run: function (args) {
        var kw = (args[0] || '').trim();
        if (!kw) return print('用法：find <关键词>（不区分大小写）', '_warn');
        if (PREVIEW) { print('[预览] 需登录 System 后可用。', '_warn'); return; }
        print('查找 "' + kw + '" …', '_dim');
        var like = '%' + kw.replace(/%/g, '') + '%';
        q(sb.from('profiles')
          .select('username,email,status,created_at')
          .or('username.ilike.' + like + ',email.ilike.' + like)
          .limit(50)).then(function (r) {
            if (r.error) return print(dbHint(r.error), '_err');
            if (!r.data || !r.data.length) return print('没有匹配的账号。', '_warn');
            renderUsers(r.data);
          });
      }
    },
    ban: {
      desc: '封禁账号  ban <用户名>',
      run: function (args) { setStatus(args[0], 'banned'); }
    },
    unban: {
      desc: '解封账号  unban <用户名>',
      run: function (args) { setStatus(args[0], 'active'); }
    },
    rename: {
      desc: '修改用户名  rename <旧名> <新名>',
      run: function (args) { doRename(args[0], args[1]); }
    },
    note: {
      desc: '查看某账号的快捷笔记  note <用户名>',
      run: function (args) { showNote(args[0]); }
    },
    setnote: {
      desc: '改写某账号的快捷笔记  setnote <用户名> <内容>',
      run: function (args) { setNote(args[0], args.slice(1).join(' ')); }
    },
    stats: {
      desc: '站点统计',
      run: function () {
        if (PREVIEW) { print('[预览] 需登录 System 后可用。', '_warn'); return; }
        q(sb.from('profiles').select('id,status', { count: 'exact', head: true }))
          .then(function (r1) {
            if (r1.error) return print(dbHint(r1.error), '_err');
            var total = r1.count || 0;
            return q(sb.from('profiles').select('id', { count: 'exact', head: true })
              .eq('status', 'banned')).then(function (r2) {
                printRich([{ t: '  账号总数 : ', b: true }, { t: String(total) }]);
                printRich([{ t: '  已封禁   : ', b: true }, { t: String(r2.error ? '?' : (r2.count || 0)) }]);
              });
          });
      }
    },
    clear: {
      desc: '清屏',
      run: function () { if (out) out.innerHTML = ''; banner(true); }
    },
    exit: {
      desc: '返回工具集',
      run: function () {
        print('再见。', '_dim');
        setTimeout(function () { window.location.href = PATHS.TOOL_CLUSTER; }, 350);
      }
    }
  };

  function renderUsers(rows) {
    print('共 ' + rows.length + ' 个账号：', '_dim');
    printRich([
      { t: '  ' + pad('USERNAME', 17) + pad('EMAIL', 27) + pad('STATUS', 9) + 'CREATED', b: true }
    ]);
    rows.forEach(function (u) {
      var isMe = u.username === ADMIN_NAME;
      printRich([
        { t: '  ' + pad(trunc(u.username, 16), 17) + pad(trunc(u.email || '-', 26), 27) },
        { t: pad(u.status || '-', 9), b: u.status === 'banned' },
        { t: (isMe ? '· 管理员' : fmtDate(u.created_at)) }
      ]);
      if (u.status === 'banned') { /* 上一行已加粗 */ }
    });
  }
  function previewUsers() {
    print('[预览模式] 模拟数据：', '_dim');
    renderUsers([
      { username: 'System', email: 'system@fuo.tools', status: 'active', created_at: new Date().toISOString() },
      { username: '1539399903', email: '1539399903@qq.com', status: 'active', created_at: '2026-11-07' },
      { username: 'demo_user', email: 'demo@example.com', status: 'banned', created_at: '2026-11-08' }
    ]);
  }

  /* ---------- 管理动作 ---------- */
  function setStatus(username, status) {
    username = (username || '').trim();
    if (!username) return print('用法：' + (status === 'banned' ? 'ban' : 'unban') + ' <用户名>', '_warn');
    if (PREVIEW) { print('[预览] 需登录 System 后可用。', '_warn'); return; }
    if (username === ADMIN_NAME) return print('不能对 System 账号执行该操作。', '_err');

    print((status === 'banned' ? '封禁 ' : '解封 ') + username + ' …', '_dim');
    getProfileByUsername(username).then(function (r) {
      if (r.error) return print(dbHint(r.error), '_err');
      if (!r.data) return print('用户名不存在：' + username, '_err');
      if (r.data.status === status) return print(username + ' 已经是 ' + status + ' 状态，无需重复操作。', '_warn');
      q(sb.from('profiles').update({ status: status }).eq('username', username))
        .then(function (r2) {
          if (r2.error) return print(dbHint(r2.error), '_err');
          print('✔ 已' + (status === 'banned' ? '封禁 ' : '解封 ') + username +
            (status === 'banned' ? '（其下次访问即被踢出并无法登录）' : ''), '_ok');
        });
    });
  }

  function doRename(oldName, newName) {
    oldName = (oldName || '').trim();
    newName = (newName || '').trim();
    if (!oldName || !newName) return print('用法：rename <旧名> <新名>', '_warn');
    if (oldName === ADMIN_NAME) return print('System 账号不可改名（数据库触发器同样拦截）。', '_err');
    if (!USERNAME_RE.test(newName)) {
      return print('新用户名格式不合法：3-20 位字母 / 数字 / 下划线。', '_err');
    }
    if (PREVIEW) { print('[预览] 需登录 System 后可用。', '_warn'); return; }

    print('改名 ' + oldName + ' → ' + newName + ' …', '_dim');
    getProfileByUsername(newName).then(function (r0) {
      if (r0.error) return print(dbHint(r0.error), '_err');
      if (r0.data) return print('新用户名已被占用：' + newName, '_err');
      q(sb.from('profiles').update({ username: newName }).eq('username', oldName))
        .then(function (r2) {
          if (r2.error) return print(dbHint(r2.error), '_err');
          print('✔ 已将 ' + oldName + ' 改名为 ' + newName, '_ok');
        });
    });
  }

  function showNote(username) {
    username = (username || '').trim();
    if (!username) return print('用法：note <用户名>', '_warn');
    if (PREVIEW) { print('[预览] 需登录 System 后可用。', '_warn'); return; }
    print('读取 ' + username + ' 的笔记…', '_dim');
    getProfileByUsername(username).then(function (r) {
      if (r.error) return print(dbHint(r.error), '_err');
      if (!r.data) return print('用户名不存在：' + username, '_err');
      q(sb.from('notes').select('content,updated_at').eq('user_id', r.data.id).maybeSingle())
        .then(function (r2) {
          if (r2.error) return print(dbHint(r2.error), '_err');
          if (!r2.data || !r2.data.content) {
            return print(username + ' 没有笔记内容。', '_warn');
          }
          print('· ' + username + ' 的笔记（更新于 ' + fmtDate(r2.data.updated_at) + '）：', '_ok');
          r2.data.content.split('\n').forEach(function (l) { print('  ' + l); });
        });
    });
  }

  function setNote(username, text) {
    username = (username || '').trim();
    if (!username || !text) return print('用法：setnote <用户名> <内容>', '_warn');
    if (text.length > 2000) return print('内容过长（上限 2000 字）。', '_err');
    if (PREVIEW) { print('[预览] 需登录 System 后可用。', '_warn'); return; }
    print('写入 ' + username + ' 的笔记…', '_dim');
    getProfileByUsername(username).then(function (r) {
      if (r.error) return print(dbHint(r.error), '_err');
      if (!r.data) return print('用户名不存在：' + username, '_err');
      q(sb.from('notes').upsert({ user_id: r.data.id, content: text }))
        .then(function (r2) {
          if (r2.error) return print(dbHint(r2.error), '_err');
          print('✔ 已写入 ' + username + ' 的笔记（' + text.length + ' 字）。', '_ok');
        });
    });
  }

  /* ---------- 渲染：拒绝面板 / 终端 ---------- */
  function renderDenied(who) {
    var gate = document.getElementById('gate-body');
    if (!gate) return;
    gate.className = 'term-denied';
    gate.innerHTML = '';
    var ic = h('div', 'term-denied-ic');
    ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" stroke-width="1.8"/>' +
      '<circle cx="12" cy="15" r="1.4" fill="currentColor"/></svg>';
    gate.appendChild(ic);
    gate.appendChild(h('h2', null, 'ACCESS DENIED'));
    var p = h('p', null, null);
    p.textContent = '此终端仅对 System 账号开放。';
    gate.appendChild(p);
    var p2 = h('p', null, null);
    p2.textContent = '当前身份：' + (who || '未知用户');
    gate.appendChild(p2);
    var p3 = h('p', 'mono', null);
    p3.textContent = '// 管理权由数据库 RLS 校验，本页面只是门面';
    gate.appendChild(p3);
    var back = h('a', null, '← 返回工具集');
    back.href = PATHS.TOOL_CLUSTER;
    gate.appendChild(back);
  }

  function renderGateError(msg, hint) {
    var gate = document.getElementById('gate-body');
    if (!gate) return;
    gate.className = 'term-denied';
    gate.innerHTML = '';
    gate.appendChild(h('h2', null, '无法连接数据库'));
    var p = h('p', null, null);
    p.textContent = msg;
    gate.appendChild(p);
    if (hint) { var m = h('p', 'mono', null); m.textContent = hint; gate.appendChild(m); }
    var back = h('a', null, '← 返回工具集');
    back.href = PATHS.TOOL_CLUSTER;
    gate.appendChild(back);
  }

  function banner(short) {
    if (short) return;
    print('FUO Tools · System Terminal v1.0', '_ok');
    printRich([{ t: '已登录：' }, { t: 'System', b: true }, { t: '（' + (me.email || '-') + '）' }]);
    if (PREVIEW) print('⚠ 预览模式：仅演示界面，数据库命令不可用。', '_warn');
    print('输入 help 查看可用命令。', '_dim');
    print('', null);
  }

  function renderTerminal() {
    var card = document.getElementById('gate-card');
    if (!card) return;
    card.innerHTML = '';

    var term = h('div', 'term');

    var head = h('div', 'term-head');
    ['_r', '_y', '_g'].forEach(function (c) { head.appendChild(h('span', 'term-dot ' + c)); });
    var title = h('span', 'term-title', 'system@fuo — admin console');
    head.appendChild(title);
    if (PREVIEW) head.appendChild(h('span', 'term-badge', 'PREVIEW'));

    var body = h('div', 'term-body');
    body.setAttribute('role', 'log');
    body.setAttribute('aria-label', '终端输出');
    body.id = 'term-out';

    var row = h('div', 'term-input-row');
    var prompt = h('span', 'term-prompt', ADMIN_NAME + '@fuo:~$');
    input = h('input', 'term-input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', '输入命令');
    input.placeholder = 'help';
    row.appendChild(prompt);
    row.appendChild(input);

    term.appendChild(head);
    term.appendChild(body);
    term.appendChild(row);
    card.appendChild(term);

    out = body;
    banner(false);

    // 点击终端任意处聚焦输入框
    term.addEventListener('click', function (e) {
      if (window.getSelection && String(window.getSelection())) return; // 选文本时不抢焦点
      input.focus();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var cmd = input.value;
        input.value = '';
        if (cmd.trim()) { hist.push(cmd); if (hist.length > 60) hist.shift(); }
        histIdx = -1;
        exec(cmd);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        if (!hist.length) return;
        if (histIdx === -1) histIdx = hist.length - 1;
        else if (histIdx > 0) histIdx--;
        input.value = hist[histIdx] || '';
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        if (histIdx === -1) return;
        histIdx++;
        if (histIdx >= hist.length) { histIdx = -1; input.value = ''; }
        else input.value = hist[histIdx] || '';
        e.preventDefault();
      } else if (e.key === 'Tab') {
        // 首词命令名补全
        var v = input.value;
        if (v && v.indexOf(' ') === -1) {
          var hit = Object.keys(CMDS).filter(function (k) { return k.indexOf(v) === 0; });
          if (hit.length === 1) { input.value = hit[0] + ' '; }
          else if (hit.length > 1) { echoCmd(v); print(hit.join('   '), '_dim'); }
        }
        e.preventDefault();
      }
    });

    setTimeout(function () { input.focus(); }, 60);
  }

  function exec(cmdRaw) {
    var cmd = (cmdRaw || '').trim();
    if (!cmd) { print('', null); return; }
    echoCmd(cmd);
    var parts = cmd.split(/\s+/);
    var name = parts[0].toLowerCase();
    var args = parts.slice(1);
    if (CMDS[name]) {
      try { CMDS[name].run(args); }
      catch (e) { print('命令执行出错：' + (e && e.message), '_err'); }
    } else {
      print('未知命令：' + name + '（输入 help 查看可用命令）', '_err');
    }
  }

  /* ---------- 启动 ---------- */
  function setLinks() {
    var back = document.getElementById('back-cluster');
    if (back) back.href = PATHS.TOOL_CLUSTER;
    var back2 = document.getElementById('tc-back');
    if (back2) back2.href = PATHS.TOOL_CLUSTER;
  }

  function boot() {
    setLinks();

    if (PREVIEW) {
      me = { id: '(preview)', username: ADMIN_NAME, email: 'preview@fuo.tools' };
      renderTerminal();
      return;
    }

    if (!window.supabase || !CFG || !CFG.SUPABASE_URL) {
      renderGateError('SDK 未就绪：assets/vendor/supabase.min.js 缺失或被拦截。');
      return;
    }

    try {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    } catch (e) {
      renderGateError('Supabase 客户端初始化失败。');
      return;
    }

    sb.auth.getSession().then(function (_a) {
      var session = _a.data && _a.data.session;
      if (!session) {
        window.location.replace(PATHS.MAIN + '?next=tools');
        return;
      }
      var uid = session.user.id;
      q(sb.from('profiles')
        .select('username,email,status')
        .eq('id', uid)
        .maybeSingle()).then(function (r) {
          if (r.error) {
            renderGateError(dbHint(r.error));
            return;
          }
          if (!r.data) {
            renderGateError('你的账号还没有 profile 记录（数据库可能未初始化）。',
              '// 请在 Supabase SQL Editor 执行 supabase-setup.sql');
            return;
          }
          if (r.data.status === 'banned') {
            sb.auth.signOut().then(function () {
              window.location.replace(PATHS.MAIN + '?banned=1');
            });
            return;
          }
          if (r.data.username !== ADMIN_NAME) {
            renderDenied(r.data.username);
            return;
          }
          me = { id: uid, username: r.data.username, email: r.data.email };
          renderTerminal();
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
