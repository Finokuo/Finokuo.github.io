/* =====================================================
 * Fuo Tools · 图形化管理台逻辑（admin/index.html 专用）
 * 身份：仅 System（profiles.username === 'System'）可进入
 * 三个面板：用户（搜索/分页/封禁/改名）· 公告（发布/删除）
 *          日志（audit_log 分页时间线）
 * 所有写操作自动写 audit_log 留痕（失败静默，不阻塞主流程）
 * 权限全部由数据库 RLS 保证，前端只做交互。
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS || {};
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;

  var sb = null;
  var user = null;

  var $ = function (id) { return document.getElementById(id); };
  var toastEl = $('toast');

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.hidden = true; }, 2400);
  }

  function client() {
    if (sb) return sb;
    if (window.supabase && CFG && CFG.SUPABASE_URL) {
      try { sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); } catch (e) { /* ignore */ }
    }
    return sb;
  }

  function isMissingTable(err) {
    if (!err) return false;
    var m = err.message || '';
    return err.code === '42P01' || err.code === 'PGRST205' ||
      /relation .* does not exist/i.test(m) || /schema cache/i.test(m);
  }

  /* ---------- 审计留痕（写失败静默） ---------- */
  function logAudit(action, target, detail) {
    var c = client();
    if (!c || !user) return;
    c.from('audit_log')
      .insert({ actor_id: user.id, action: action, target: target || '', detail: detail || '' })
      .then(function () { /* 忽略 */ });
  }

  /* ---------- 身份守卫：仅 System ---------- */
  function guard() {
    if (PREVIEW) {
      $('ad-loading').hidden = true;
      $('ad-root').hidden = false;
      bootAll(true);
      return;
    }
    var c = client();
    if (!c) {
      $('ad-loading').textContent = '// SDK 未就绪，请刷新重试';
      return;
    }
    c.auth.getSession().then(function (_a) {
      var session = _a.data && _a.data.session;
      if (!session) {
        window.location.replace((PATHS.MAIN || '../') + '?next=tools');
        return;
      }
      user = session.user;
      c.from('profiles').select('username,status').eq('id', user.id).maybeSingle()
        .then(function (_b) {
          var p = _b.data;
          if (p && p.status === 'banned') {
            c.auth.signOut().then(function () {
              window.location.replace((PATHS.MAIN || '../') + '?banned=1');
            });
            return;
          }
          if (!p || p.username !== 'System') {
            $('ad-loading').hidden = true;
            $('ad-denied').hidden = false;
            return;
          }
          $('ad-loading').hidden = true;
          $('ad-root').hidden = false;
          bootAll(false);
        });
    });
  }

  /* =====================================================
   * 标签页切换
   * ===================================================== */
  function initTabs() {
    var tabs = document.querySelectorAll('.ad-tab');
    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener('click', function () {
        var name = t.getAttribute('data-tab');
        Array.prototype.forEach.call(tabs, function (x) {
          var on = x === t;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-selected', String(on));
        });
        ['users', 'ann', 'audit'].forEach(function (p) {
          $('ad-panel-' + p).hidden = p !== name;
        });
        if (name === 'ann' && !annLoaded) loadAnnList();
        if (name === 'audit' && !auditLoaded) loadAudit();
      });
    });
  }

  /* =====================================================
   * 用户面板
   * ===================================================== */
  var PAGE_SIZE = 12;
  var uPage = 0;
  var uTotal = 0;
  var uQuery = '';
  var uTimer = null;

  function initUsers() {
    $('ad-user-q').addEventListener('input', function () {
      clearTimeout(uTimer);
      uTimer = setTimeout(function () {
        uQuery = $('ad-user-q').value.trim();
        uPage = 0;
        loadUsers();
      }, 260);
    });
    $('ad-user-prev').addEventListener('click', function () {
      if (uPage > 0) { uPage--; loadUsers(); }
    });
    $('ad-user-next').addEventListener('click', function () {
      if ((uPage + 1) * PAGE_SIZE < uTotal) { uPage++; loadUsers(); }
    });
  }

  function loadUsers() {
    var c = client();
    var rows = $('ad-user-rows');
    rows.innerHTML = '<tr><td colspan="5" class="ad-td-empty">读取中…</td></tr>';
    if (PREVIEW) {
      uTotal = 3;
      renderUsers([
        { id: 'sys', username: 'System', status: 'active', created_at: new Date().toISOString(), noteCount: 1 },
        { id: 'me', username: 'Finokuo', status: 'active', created_at: new Date().toISOString(), noteCount: 6 },
        { id: 'x', username: 'RippleTester', status: 'banned', created_at: new Date().toISOString(), noteCount: 2 },
      ], true);
      return;
    }

    var from = uPage * PAGE_SIZE;
    var req = c.from('profiles').select('id,username,status,created_at', { count: 'exact' })
      .order('created_at', { ascending: true });
    if (uQuery) req = req.ilike('username', '%' + uQuery.replace(/[%_]/g, '') + '%');
    req.range(from, from + PAGE_SIZE - 1)
      .then(function (_a) {
        if (_a.error) {
          rows.innerHTML = '<tr><td colspan="5" class="ad-td-empty">读取失败：' +
            (_a.error.message || '未知错误') + '</td></tr>';
          return;
        }
        uTotal = (_a.count != null) ? _a.count : (_a.data || []).length;
        var list = _a.data || [];
        // 批量取这页用户的笔记数（在册 + 回收站都算）
        var ids = list.map(function (p) { return p.id; });
        if (!ids.length) { renderUsers([], false); return; }
        c.from('notes').select('user_id').in('user_id', ids)
          .then(function (_b) {
            var counts = {};
            ((_b.data) || []).forEach(function (n) {
              counts[n.user_id] = (counts[n.user_id] || 0) + 1;
            });
            list.forEach(function (p) { p.noteCount = counts[p.id] || 0; });
            renderUsers(list, false);
          })
          .catch(function () {
            list.forEach(function (p) { p.noteCount = 0; });
            renderUsers(list, false);
          });
      });
  }

  function renderUsers(list, isPreview) {
    var rows = $('ad-user-rows');
    rows.innerHTML = '';
    var pages = Math.max(1, Math.ceil(uTotal / PAGE_SIZE));
    $('ad-user-page').textContent = (uPage + 1) + ' / ' + pages;
    $('ad-user-prev').disabled = uPage <= 0;
    $('ad-user-next').disabled = (uPage + 1) >= pages;
    $('ad-user-total').textContent = uTotal + ' 个账号';

    if (!list.length) {
      rows.innerHTML = '<tr><td colspan="5" class="ad-td-empty">' +
        (uQuery ? '没有匹配「' + uQuery + '」的用户' : '还没有注册用户') + '</td></tr>';
      return;
    }

    list.forEach(function (p) {
      var isSelf = user && p.id === user.id;
      var isSystem = p.username === 'System';
      var banned = p.status === 'banned';

      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      var name = document.createElement('span');
      name.className = 'ad-u-name' + (isSelf ? ' is-self' : isSystem ? ' is-system' : '');
      name.textContent = p.username;
      tdName.appendChild(name);
      if (isSelf) {
        var me = document.createElement('small');
        me.className = 'ad-chip';
        me.style.marginLeft = '8px';
        me.textContent = '你';
        tdName.appendChild(me);
      }

      var tdStatus = document.createElement('td');
      var chip = document.createElement('span');
      chip.className = 'ad-chip' + (banned ? ' is-banned' : ' is-active');
      chip.textContent = banned ? '已封禁' : '正常';
      tdStatus.appendChild(chip);

      var tdNotes = document.createElement('td');
      tdNotes.textContent = String(p.noteCount != null ? p.noteCount : '–');

      var tdCreated = document.createElement('td');
      try {
        tdCreated.textContent = new Date(p.created_at).toLocaleDateString('zh-CN');
      } catch (e) { tdCreated.textContent = '—'; }

      var tdOps = document.createElement('td');
      tdOps.style.whiteSpace = 'nowrap';

      var bBan = document.createElement('button');
      bBan.type = 'button';
      bBan.className = 'ad-op' + (banned ? '' : ' is-danger');
      bBan.textContent = banned ? '解封' : '封禁';
      bBan.disabled = isSelf || isPreview;
      bBan.title = isSelf ? '不能封禁自己' : (banned ? '恢复该账号登录' : '禁止该账号登录并踢下线');
      bBan.addEventListener('click', function () {
        askConfirm(banned ? 'unban' : 'ban', p);
      });
      tdOps.appendChild(bBan);

      var bRen = document.createElement('button');
      bRen.type = 'button';
      bRen.className = 'ad-op';
      bRen.textContent = '改名';
      bRen.disabled = isSelf || isPreview; // System 不能改名自己（数据库触发器同款限制）
      bRen.title = isSelf ? '不能改名自己' : '修改该账号的用户名';
      bRen.addEventListener('click', function () { openRename(p); });
      tdOps.appendChild(bRen);

      tr.appendChild(tdName);
      tr.appendChild(tdStatus);
      tr.appendChild(tdNotes);
      tr.appendChild(tdCreated);
      tr.appendChild(tdOps);
      rows.appendChild(tr);
    });
  }

  function setBan(p, ban) {
    var c = client();
    c.from('profiles').update({ status: ban ? 'banned' : 'active' }).eq('id', p.id)
      .then(function (_a) {
        if (_a.error) {
          showToast((ban ? '封禁' : '解封') + '失败：' + (_a.error.message || '未知错误'));
          return;
        }
        logAudit(ban ? 'ban' : 'unban', p.username, ban ? '封禁账号（管理台）' : '解封账号（管理台）');
        showToast(ban ? '已封禁「' + p.username + '」，其会话将在下次请求时被踢出'
                      : '已解封「' + p.username + '」');
        loadUsers();
      });
  }

  /* ---------- 改名 ---------- */
  var renameTarget = null;
  var USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

  function openRename(p) {
    renameTarget = p;
    $('ad-rename-input').value = p.username;
    $('ad-rename-msg').hidden = true;
    $('ad-rename').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var i = $('ad-rename-input');
      i.focus(); i.select();
    }, 60);
  }
  function closeRename() {
    $('ad-rename').hidden = true;
    document.body.style.overflow = '';
    renameTarget = null;
  }
  function saveRename() {
    if (!renameTarget) return;
    var name = $('ad-rename-input').value.trim();
    var msg = $('ad-rename-msg');
    function fail(t) {
      msg.className = 'tf-msg is-err';
      msg.textContent = t;
      msg.hidden = false;
    }
    if (!USERNAME_RE.test(name)) { fail('用户名需为 3-20 位，仅限字母、数字和下划线。'); return; }
    if (name === renameTarget.username) { fail('这就是该用户现在的用户名。'); return; }

    var p = renameTarget;
    client().from('profiles').update({ username: name }).eq('id', p.id)
      .then(function (_a) {
        if (_a.error) {
          if (_a.error.code === '23505' || /duplicate key/i.test(_a.error.message || '')) {
            fail('该用户名已被占用，换一个试试。');
          } else {
            fail('保存失败：' + (_a.error.message || '未知错误'));
          }
          return;
        }
        logAudit('rename', p.username, '→ ' + name + '（管理台）');
        closeRename();
        showToast('已将「' + p.username + '」改名为「' + name + '」');
        loadUsers();
      });
  }

  /* =====================================================
   * 公告面板
   * ===================================================== */
  var annLoaded = false;

  function initAnn() {
    var ta = $('ad-ann-text');
    ta.addEventListener('input', function () {
      $('ad-ann-count').textContent = ta.value.length + ' / 500';
    });
    $('ad-ann-publish').addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { showToast('公告内容不能为空'); return; }
      if (PREVIEW) { showToast('预览模式：演示发布（不写库）'); return; }
      var btn = $('ad-ann-publish');
      btn.disabled = true;
      btn.textContent = '发布中…';
      client().from('announcements')
        .insert({ author_id: user.id, content: text })
        .then(function (_a) {
          btn.disabled = false;
          btn.textContent = '发布公告';
          if (_a.error) {
            if (isMissingTable(_a.error)) {
              showToast('公告表尚未创建：请先执行 supabase-v5.sql');
            } else {
              showToast('发布失败：' + (_a.error.message || '未知错误'));
            }
            return;
          }
          logAudit('announce', '', '发布公告：' + text.slice(0, 40) + (text.length > 40 ? '…' : ''));
          ta.value = '';
          $('ad-ann-count').textContent = '0 / 500';
          showToast('公告已发布，全站登录用户可见');
          loadAnnList();
        });
    });
  }

  function loadAnnList() {
    var box = $('ad-ann-list');
    box.innerHTML = '<p class="ad-td-empty mono">读取中…</p>';
    if (PREVIEW) {
      renderAnnList([
        { id: 'a1', content: 'Fuo Tools v0.8.0 上线：新增办公集与主题色系统。', created_at: new Date().toISOString(), isCurrent: true },
      ]);
      annLoaded = true;
      return;
    }
    client().from('announcements')
      .select('id,content,created_at')
      .order('created_at', { ascending: false })
      .limit(10)
      .then(function (_a) {
        if (_a.error) {
          box.innerHTML = '<p class="ad-td-empty">' + (isMissingTable(_a.error)
            ? '公告表尚未创建：请先执行 supabase-v5.sql'
            : '读取失败：' + (_a.error.message || '未知错误')) + '</p>';
          return;
        }
        renderAnnList(_a.data || []);
        annLoaded = true;
      });
  }

  function renderAnnList(list) {
    var box = $('ad-ann-list');
    box.innerHTML = '';
    if (!list.length) {
      var e = document.createElement('p');
      e.className = 'ad-td-empty';
      e.textContent = '还没有发布过公告。';
      box.appendChild(e);
      return;
    }
    list.forEach(function (a, idx) {
      var item = document.createElement('div');
      item.className = 'ad-ann-item' + (idx === 0 ? ' is-current' : '');

      var p = document.createElement('p');
      p.textContent = a.content;
      item.appendChild(p);

      var foot = document.createElement('div');
      foot.className = 'ad-ann-foot';
      var time = document.createElement('span');
      time.className = 'mono';
      try {
        time.textContent = new Date(a.created_at).toLocaleString('zh-CN', {
          year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
      } catch (err) { time.textContent = '—'; }
      time.textContent += idx === 0 ? ' · 当前生效' : '';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ad-op is-danger';
      del.textContent = '删除';
      del.disabled = PREVIEW;
      del.addEventListener('click', function () { askConfirm('delann', a); });
      foot.appendChild(time);
      foot.appendChild(del);

      item.appendChild(p);
      item.appendChild(foot);
      box.appendChild(item);
    });
  }

  function deleteAnn(a) {
    client().from('announcements').delete().eq('id', a.id)
      .then(function (_a) {
        if (_a.error) { showToast('删除失败：' + (_a.error.message || '未知错误')); return; }
        logAudit('delannounce', String(a.id).slice(0, 8), '删除公告：' + (a.content || '').slice(0, 40) + '…');
        showToast('公告已删除');
        loadAnnList();
      });
  }

  /* =====================================================
   * 日志面板（audit_log 时间线）
   * ===================================================== */
  var auditLoaded = false;
  var aPage = 0;
  var aTotal = 0;
  var AUDIT_PAGE = 15;

  function initAudit() {
    $('ad-audit-prev').addEventListener('click', function () {
      if (aPage > 0) { aPage--; loadAudit(); }
    });
    $('ad-audit-next').addEventListener('click', function () {
      if ((aPage + 1) * AUDIT_PAGE < aTotal) { aPage++; loadAudit(); }
    });
  }

  var ACT_NAMES = {
    ban: '封禁账号', unban: '解封账号', rename: '重命名',
    setnote: '设置便签', announce: '发布公告', delannounce: '删除公告',
    audit: '查看日志', purge: '清理数据',
  };

  function loadAudit() {
    var box = $('ad-audit-list');
    box.innerHTML = '<p class="ad-td-empty mono">读取中…</p>';
    if (PREVIEW) {
      aTotal = 3;
      renderAudit([
        { action: 'announce', target: '', detail: '发布公告：Fuo Tools v0.8.0 上线…', created_at: new Date().toISOString() },
        { action: 'ban', target: 'RippleTester', detail: '封禁账号（管理台）', created_at: new Date(Date.now() - 3600000).toISOString() },
        { action: 'rename', target: 'OldName', detail: '→ NewName（Terminal）', created_at: new Date(Date.now() - 86400000).toISOString() },
      ]);
      auditLoaded = true;
      return;
    }
    var from = aPage * AUDIT_PAGE;
    client().from('audit_log')
      .select('action,target,detail,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + AUDIT_PAGE - 1)
      .then(function (_a) {
        if (_a.error) {
          box.innerHTML = '<p class="ad-td-empty">' + (isMissingTable(_a.error)
            ? '日志表尚未创建：请先执行 supabase-v5.sql'
            : '读取失败：' + (_a.error.message || '未知错误')) + '</p>';
          return;
        }
        aTotal = (_a.count != null) ? _a.count : (_a.data || []).length;
        renderAudit(_a.data || []);
        auditLoaded = true;
      });
  }

  function renderAudit(list) {
    var box = $('ad-audit-list');
    box.innerHTML = '';
    var pages = Math.max(1, Math.ceil(aTotal / AUDIT_PAGE));
    $('ad-audit-page').textContent = (aPage + 1) + ' / ' + pages;
    $('ad-audit-prev').disabled = aPage <= 0;
    $('ad-audit-next').disabled = (aPage + 1) >= pages;

    if (!list.length) {
      var e = document.createElement('p');
      e.className = 'ad-td-empty';
      e.textContent = '还没有操作记录。封禁 / 改名 / 公告等操作会自动出现在这里。';
      box.appendChild(e);
      return;
    }

    var DANGER_ACTS = { ban: 1, delannounce: 1, purge: 1 };
    list.forEach(function (a) {
      var item = document.createElement('div');
      item.className = 'ad-audit-item' + (DANGER_ACTS[a.action] ? ' is-danger' : '');

      var dot = document.createElement('span');
      dot.className = 'ad-audit-dot';
      dot.setAttribute('aria-hidden', 'true');

      var main = document.createElement('div');
      main.className = 'ad-audit-main';
      var act = document.createElement('p');
      act.className = 'ad-audit-act';
      var code = document.createElement('code');
      code.textContent = a.action;
      act.appendChild(code);
      act.appendChild(document.createTextNode((ACT_NAMES[a.action] || '操作') +
        (a.target ? ' · ' + a.target : '')));
      var detail = document.createElement('p');
      detail.className = 'ad-audit-detail';
      detail.textContent = a.detail || '—';
      main.appendChild(act);
      main.appendChild(detail);

      var time = document.createElement('span');
      time.className = 'ad-audit-time mono';
      try {
        time.textContent = new Date(a.created_at).toLocaleString('zh-CN', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
      } catch (err) { time.textContent = '—'; }

      item.appendChild(dot);
      item.appendChild(main);
      item.appendChild(time);
      box.appendChild(item);
    });
  }

  /* =====================================================
   * 确认弹窗
   * ===================================================== */
  var confirmAct = null; // {kind, payload}

  function askConfirm(kind, payload) {
    confirmAct = { kind: kind, payload: payload };
    var text = '';
    if (kind === 'ban') text = '确定封禁「' + payload.username + '」吗？该账号将无法登录，正在线上的会话会被踢出。';
    else if (kind === 'unban') text = '确定解封「' + payload.username + '」吗？';
    else if (kind === 'delann') text = '确定删除这条公告吗？删除后用户端横幅立即消失。';
    $('ad-confirm-text').textContent = text;
    $('ad-confirm').hidden = false;
  }

  function initConfirm() {
    $('ad-confirm-ok').addEventListener('click', function () {
      if (!confirmAct) { $('ad-confirm').hidden = true; return; }
      var act = confirmAct;
      confirmAct = null;
      $('ad-confirm').hidden = true;
      if (act.kind === 'ban') setBan(act.payload, true);
      else if (act.kind === 'unban') setBan(act.payload, false);
      else if (act.kind === 'delann') deleteAnn(act.payload);
    });
    $('ad-confirm').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-ad-cancel]')) {
        $('ad-confirm').hidden = true;
        confirmAct = null;
      }
    });
    $('ad-rename-save').addEventListener('click', saveRename);
    $('ad-rename-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
    });
    $('ad-rename').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-ad-close]')) closeRename();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('ad-confirm').hidden) { $('ad-confirm').hidden = true; confirmAct = null; }
      if (!$('ad-rename').hidden) closeRename();
    });
  }

  /* ---------- 链接 ---------- */
  function initLinks() {
    var drive = PATHS.DRIVE || '../';
    // Terminal 地址：tool-cluster/terminal/
    var tUrl = (window.FUO_BASE || '') + '/drive/tool-cluster/terminal' + (window.FUO_SUFFIX || '/');
    if (PREVIEW) tUrl += (tUrl.indexOf('?') === -1 ? '?' : '&') + 'preview=1';
    $('ad-back-drive').href = drive;
    $('ad-back-drive-2').href = drive;
    $('ad-link-terminal').href = tUrl;
  }

  /* ---------- 启动 ---------- */
  function bootAll(isPreview) {
    initTabs();
    initUsers();
    initAnn();
    initAudit();
    initConfirm();
    initLinks();
    loadUsers();
  }

  guard();
})();
