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

      c.from('profiles').select('username,status').eq('id', user.id).maybeSingle()
        .then(function (_b) {
          var p = _b.data;
          if (p && p.status === 'banned') {
            c.auth.signOut().then(function () {
              window.location.replace((PATHS.MAIN || '../../') + '?banned=1');
            });
            return;
          }
          if (!p) return;
          profile = p;
          $('st-username').textContent = p.username;
        });
    });
    c.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') window.location.replace(PATHS.MAIN || '../../');
    });
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
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('st-modal').hidden) closeModal();
    });

    $('st-logout').addEventListener('click', function () {
      var c = client();
      if (!c) { window.location.replace(PATHS.MAIN || '../../'); return; }
      c.auth.signOut().then(function () {
        window.location.replace(PATHS.MAIN || '../../');
      });
    });

    $('st-clear').addEventListener('click', clearLocal);
  }

  initSwitches();
  bind();
  loadAccount();
})();
