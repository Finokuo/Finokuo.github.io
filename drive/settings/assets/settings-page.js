/* =====================================================
 * Fuo Tools · 设置页逻辑（settings/index.html 专用）
 * 开关即时写入 localStorage（fuo-settings / fu-theme）并生效
 * 账户信息来自 Supabase；支持改名 / 退出 / 清除本地数据
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;
  var S = window.FUO_SETTINGS;
  var sb = null;
  var user = null;
  var profile = null;
  var unBusy = false;

  var $ = function (id) { return document.getElementById(id); };
  var toast = $('toast');
  var USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.hidden = true; }, 2400);
  }

  function client() {
    if (sb) return sb;
    if (window.supabase && CFG && CFG.SUPABASE_URL) {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    }
    return sb;
  }

  /* ---------- 开关 ---------- */
  function initSwitches() {
    document.querySelectorAll('input[data-set]').forEach(function (input) {
      var key = input.getAttribute('data-set');
      input.checked = !!S.get(key);
      input.addEventListener('change', function () {
        S.set(key, input.checked);
        showToast(input.checked ? '已开启：' + labelOf(input) : '已关闭：' + labelOf(input));
      });
    });

    // 主题模式分段
    var seg = $('st-theme-seg');
    var mode = (window.FUO_THEME && window.FUO_THEME.mode) ? window.FUO_THEME.mode() : 'dark';
    paintSeg(mode);
    seg.querySelectorAll('.st-seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var m = btn.getAttribute('data-mode');
        paintSeg(m);
        if (window.FUO_THEME) window.FUO_THEME.set(m);
        S.set('themeMode', m);
        showToast(m === 'system' ? '主题将跟随系统深浅色' : (m === 'dark' ? '已切换到暗色' : '已切换到亮色'));
      });
    });
  }

  function paintSeg(mode) {
    document.querySelectorAll('#st-theme-seg .st-seg-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-mode') === mode;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(on));
    });
  }

  /* ---------- 主题色（v0.8：色板，FUO_THEME.setAccent 全站生效） ---------- */
  var ACCENT_NAMES = {
    teal: '青', orange: '橙', rose: '粉',
    violet: '紫', emerald: '绿', amber: '金',
  };
  function paintAccents(cur) {
    document.querySelectorAll('#st-accent-row .st-accent-dot').forEach(function (btn) {
      var on = btn.getAttribute('data-accent') === cur;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(on));
    });
  }
  function initAccents() {
    var row = $('st-accent-row');
    if (!row) return;
    var cur = (window.FUO_THEME && window.FUO_THEME.accent) ? window.FUO_THEME.accent() : 'teal';
    paintAccents(cur);
    row.querySelectorAll('.st-accent-dot').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-accent');
        if (window.FUO_THEME && window.FUO_THEME.setAccent) window.FUO_THEME.setAccent(key);
        paintAccents(key);
        showToast('主题色已切换为「' + (ACCENT_NAMES[key] || key) + '」');
      });
    });
  }

  function labelOf(input) {
    var row = input.closest('.st-row');
    var b = row ? row.querySelector('.st-info b') : null;
    return b ? b.textContent : '该选项';
  }

  /* ---------- 账户 ---------- */
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return '—'; }
  }

  function loadAccount() {
    var c = client();
    if (!c) return;
    c.auth.getSession().then(function (_a) {
      var session = _a.data && _a.data.session;
      if (!session) {
        window.location.replace((PATHS.MAIN || '../../') + '?next=settings');
        return;
      }
      user = session.user;
      $('st-email').textContent = user.email || '—';
      $('st-uid').textContent = (user.id || '').slice(0, 8) || '—';
      $('st-created').textContent = user.created_at ? fmtDate(user.created_at) : '—';
      $('st-username').textContent =
        (user.user_metadata && user.user_metadata.username) || '加载中…';

      loadProfile();
    });
    c.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') window.location.replace(PATHS.MAIN || '../../');
    });
  }

  function loadProfile() {
    var c = client();
    // v5 表带 bio（简介）；旧表报 PGRST204 → 降级不带该列
    c.from('profiles').select('username,status,bio').eq('id', user.id).maybeSingle()
      .then(function (_b) {
        if (_b.error && (_b.error.code === 'PGRST204' || _b.error.code === '42703' ||
            /could not find the column|does not exist/i.test(_b.error.message || ''))) {
          return c.from('profiles').select('username,status').eq('id', user.id).maybeSingle()
            .then(function (_c) { paintProfile(_c.data, null); });
        }
        paintProfile(_b.data, _b.data ? (_b.data.bio || '') : null);
      });
  }

  function paintProfile(p, bio) {
    if (p && p.status === 'banned') {
      client().auth.signOut().then(function () {
        window.location.replace((PATHS.MAIN || '../../') + '?banned=1');
      });
      return;
    }
    if (!p) return;
    profile = p;
    $('st-username').textContent = p.username;
    var bioEl = $('st-bio');
    if (bioEl && bio != null) {
      bioEl.textContent = bio || '（未填写）';
      bioEl.title = bio || '';
    } else if (bioEl) {
      bioEl.textContent = '（需执行 supabase-v5.sql）';
    }
  }

  /* ---------- 修改用户名 ---------- */
  function openModal() {
    $('st-un-input').value = (profile && profile.username) ||
      (user && user.user_metadata && user.user_metadata.username) ||
      (user && user.email ? user.email.split('@')[0] : '');
    $('st-un-msg').hidden = true;
    $('st-modal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var input = $('st-un-input');
      input.focus(); input.select();
    }, 60);
  }
  function closeModal() {
    $('st-modal').hidden = true;
    document.body.style.overflow = '';
    unBusy = false;
    $('st-un-save').disabled = false;
    $('st-un-save').textContent = '保存';
  }

  function saveUsername() {
    if (unBusy) return;
    var input = $('st-un-input');
    var name = input.value.trim();
    var msg = $('st-un-msg');
    function fail(text) {
      msg.className = 'tf-msg is-err';
      msg.textContent = text;
      msg.hidden = false;
    }
    if (!USERNAME_RE.test(name)) { fail('用户名需为 3-20 位，仅限字母、数字和下划线。'); return; }
    if (profile && profile.username === name) { fail('这就是你现在的用户名。'); return; }

    unBusy = true;
    $('st-un-save').disabled = true;
    $('st-un-save').textContent = '保存中…';
    msg.hidden = true;

    client().from('profiles').update({ username: name }).eq('id', user.id)
      .then(function (_a) {
        if (_a.error) {
          unBusy = false;
          $('st-un-save').disabled = false;
          $('st-un-save').textContent = '保存';
          if (_a.error.code === '23505' || /duplicate key/i.test(_a.error.message || '')) {
            fail('该用户名已被占用，换一个试试。');
          } else {
            fail('保存失败：' + (_a.error.message || '未知错误'));
          }
          return;
        }
        return client().auth.updateUser({ data: { username: name } }).then(function () {
          profile = profile || {};
          profile.username = name;
          $('st-username').textContent = name;
          closeModal();
          showToast('用户名已更新为 ' + name);
        });
      })
      .catch(function () {
        unBusy = false;
        $('st-un-save').disabled = false;
        $('st-un-save').textContent = '保存';
        fail('网络异常，请稍后再试。');
      });
  }

  /* ---------- 修改简介（v0.7：profiles.bio，需 v5 列） ---------- */
  var bioBusy = false;
  function openBio() {
    var cur = (profile && profile.bio != null) ? profile.bio : '';
    $('st-bio-input').value = cur;
    $('st-bio-msg').hidden = true;
    $('st-bio-save').disabled = false;
    $('st-bio-save').textContent = '保存';
    $('st-bio-modal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $('st-bio-input').focus(); }, 60);
  }
  function closeBio() {
    $('st-bio-modal').hidden = true;
    document.body.style.overflow = '';
    bioBusy = false;
  }
  function saveBio() {
    if (bioBusy) return;
    var text = $('st-bio-input').value.trim();
    var msg = $('st-bio-msg');
    function fail(t) {
      msg.className = 'tf-msg is-err';
      msg.textContent = t;
      msg.hidden = false;
      bioBusy = false;
      $('st-bio-save').disabled = false;
      $('st-bio-save').textContent = '保存';
    }
    bioBusy = true;
    $('st-bio-save').disabled = true;
    $('st-bio-save').textContent = '保存中…';
    msg.hidden = true;

    client().from('profiles').update({ bio: text }).eq('id', user.id)
      .then(function (_a) {
        if (_a.error) {
          if (_a.error.code === 'PGRST204' || _a.error.code === '42703' || /could not find the column|does not exist/i.test(_a.error.message || '')) {
            fail('简介列尚未创建：请先在 Supabase SQL Editor 执行 supabase-v5.sql。');
            return;
          }
          fail('保存失败：' + (_a.error.message || '未知错误'));
          return;
        }
        profile = profile || {};
        profile.bio = text;
        var bioEl = $('st-bio');
        if (bioEl) {
          bioEl.textContent = text || '（未填写）';
          bioEl.title = text;
        }
        closeBio();
        showToast(text ? '简介已更新' : '简介已清空');
      })
      .catch(function () { fail('网络异常，请稍后再试。'); });
  }

  /* ---------- 修改密码（v0.7：auth.updateUser） ---------- */
  var pwBusy = false;
  function openPw() {
    $('st-pw-input').value = '';
    $('st-pw-input2').value = '';
    $('st-pw-msg').hidden = true;
    $('st-pw-save').disabled = false;
    $('st-pw-save').textContent = '确认修改';
    $('st-pw-modal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $('st-pw-input').focus(); }, 60);
  }
  function closePw() {
    $('st-pw-modal').hidden = true;
    document.body.style.overflow = '';
    pwBusy = false;
  }
  function savePassword() {
    if (pwBusy) return;
    var p1 = $('st-pw-input').value;
    var p2 = $('st-pw-input2').value;
    var msg = $('st-pw-msg');
    function fail(t) {
      msg.className = 'tf-msg is-err';
      msg.textContent = t;
      msg.hidden = false;
      pwBusy = false;
      $('st-pw-save').disabled = false;
      $('st-pw-save').textContent = '确认修改';
    }
    if (!p1 || p1.length < 6) { fail('新密码至少 6 位。'); return; }
    if (p1.length > 72) { fail('密码最长 72 位。'); return; }
    if (p1 !== p2) { fail('两次输入的密码不一致。'); return; }

    pwBusy = true;
    $('st-pw-save').disabled = true;
    $('st-pw-save').textContent = '提交中…';
    msg.hidden = true;

    client().auth.updateUser({ password: p1 })
      .then(function (_a) {
        if (_a.error) {
          var m = _a.error.message || '';
          if (_a.error.code === 'weak_password' || /at least 6/i.test(m)) fail('密码强度不够：至少 6 位。');
          else if (/different from the old/i.test(m)) fail('新密码不能和旧密码相同。');
          else if (_a.error.code === 422 || /session/i.test(m)) fail('登录状态过期，请刷新页面后重试。');
          else fail('修改失败：' + m);
          return;
        }
        closePw();
        showToast('密码已修改，下次登录请用新密码');
      })
      .catch(function () { fail('网络异常，请稍后再试。'); });
  }

  /* ---------- 导出账号数据（v0.8：笔记/文件夹/收藏/资料 → JSON 下载） ---------- */
  var exportBusy = false;
  function exportAccountData() {
    if (exportBusy || !user) return;
    exportBusy = true;
    var btn = $('st-export');
    var oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '导出中…';

    var c = client();
    // v6 列（pinned/is_public/deleted_at）未建时自动降级为基础列，保证导出仍可用
    function notesQuery(cols) {
      return c.from('notes').select(cols).order('updated_at', { ascending: false });
    }
    Promise.all([
      notesQuery('id,title,content,is_quick,pinned,is_public,folder_id,created_at,updated_at,deleted_at')
        .then(function (r) {
          if (r.error && (r.error.code === 'PGRST204' || r.error.code === '42703' ||
              /could not find the column|does not exist/i.test(r.error.message || ''))) {
            return notesQuery('id,title,content,is_quick,folder_id,created_at,updated_at');
          }
          return r;
        }),
      c.from('folders').select('id,name,created_at').order('created_at', { ascending: true }),
      c.from('favorites').select('kind,ref,title,created_at').order('created_at', { ascending: false }),
      c.from('profiles').select('username,bio,created_at').eq('id', user.id).maybeSingle()
        .then(function (r) {
          if (r.error && (r.error.code === 'PGRST204' || r.error.code === '42703' ||
              /could not find the column|does not exist/i.test(r.error.message || ''))) {
            return c.from('profiles').select('username,created_at').eq('id', user.id).maybeSingle();
          }
          return r;
        }),
    ]).then(function (res) {
      exportBusy = false;
      btn.disabled = false;
      btn.textContent = oldText;

      var errs = [];
      res.forEach(function (r, i) {
        if (r && r.error) errs.push(['notes', 'folders', 'favorites', 'profiles'][i] + ': ' + (r.error.message || r.error.code));
      });

      var notes = (res[0].data || []).map(function (n) {
        var clean = {
          id: n.id, title: n.title, content: n.content,
          is_quick: !!n.is_quick, pinned: !!n.pinned, is_public: !!n.is_public,
          folder_id: n.folder_id, created_at: n.created_at, updated_at: n.updated_at,
        };
        if (n.deleted_at) clean.deleted_at = n.deleted_at; // 回收站里的也一并导出
        return clean;
      });
      var folders = (res[1].data || []).map(function (f) {
        return { id: f.id, name: f.name, created_at: f.created_at };
      });
      var favorites = (res[2].data || []).map(function (f) {
        return { kind: f.kind, ref: f.ref, title: f.title, created_at: f.created_at };
      });
      var me = res[3].data || {};

      var payload = {
        app: 'Fuo Tools',
        version: '0.8.0',
        exported_at: new Date().toISOString(),
        account: {
          email: user.email || '',
          user_id: user.id || '',
          created_at: user.created_at || '',
          username: me.username || (user.user_metadata && user.user_metadata.username) || '',
          bio: me.bio != null ? me.bio : '',
        },
        notes: notes,
        folders: folders,
        favorites: favorites,
        counts: { notes: notes.length, folders: folders.length, favorites: favorites.length },
        warnings: errs.length ? errs : undefined,
      };

      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var stamp = new Date().toISOString().slice(0, 10);
      var uname = (payload.account.username || 'user').replace(/[^A-Za-z0-9_-]/g, '') || 'user';
      a.href = url;
      a.download = 'fuo-tools-backup-' + uname + '-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);

      if (errs.length) {
        showToast('已导出，但部分数据读取失败：' + errs[0]);
      } else {
        showToast('已导出 ' + notes.length + ' 篇笔记 / ' + favorites.length + ' 条收藏');
      }
    }).catch(function () {
      exportBusy = false;
      btn.disabled = false;
      btn.textContent = oldText;
      showToast('导出失败：网络异常，请稍后再试');
    });
  }

  /* ---------- 清除本地数据 ---------- */
  function clearLocal() {
    try {
      localStorage.removeItem('fuo-settings');
      localStorage.removeItem('fuo-recent-tools');
      localStorage.removeItem('fuo-tool-count');
      localStorage.removeItem('fu-theme');
      localStorage.removeItem('fuo-sidebar-mini');
      showToast('本地数据已清除，正在刷新…');
      setTimeout(function () { window.location.reload(); }, 700);
    } catch (e) {
      showToast('清除失败：浏览器可能处于隐私模式');
    }
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    $('st-edit-username').addEventListener('click', openModal);
    $('st-un-save').addEventListener('click', saveUsername);
    $('st-un-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveUsername(); }
    });
    $('st-modal').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-st-close]')) closeModal();
    });
    $('st-edit-bio').addEventListener('click', openBio);
    $('st-bio-save').addEventListener('click', saveBio);
    $('st-bio-modal').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-bio-close]')) closeBio();
    });

    $('st-changepw').addEventListener('click', openPw);
    $('st-pw-save').addEventListener('click', savePassword);
    $('st-pw-modal').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-pw-close]')) closePw();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('st-modal').hidden) closeModal();
      if (!$('st-bio-modal').hidden) closeBio();
      if (!$('st-pw-modal').hidden) closePw();
    });

    $('st-logout').addEventListener('click', function () {
      var c = client();
      if (!c) { window.location.replace(PATHS.MAIN || '../../'); return; }
      c.auth.signOut().then(function () {
        window.location.replace(PATHS.MAIN || '../../');
      });
    });

    $('st-clear').addEventListener('click', clearLocal);
    $('st-export').addEventListener('click', exportAccountData);
  }

  initSwitches();
  initAccents();
  bind();
  loadAccount();
})();
