/* =====================================================
 * Fuo Tools · 用户反馈模块（v0.10.0）
 *
 * 用法：
 *   1) 页面引入本文件（依赖 window.FUO_CONFIG + supabase SDK）
 *   2) 任意位置调用 window.FUO_FEEDBACK.open() 打开反馈弹窗
 *      —— sidebar.js 会自动在侧栏注入「反馈」按钮；
 *      —— 主页页脚提供文字入口
 *
 * 数据流：feedback 表（supabase-v7.sql）
 *   游客与登录用户均可 INSERT；仅 System 可 SELECT / DELETE（RLS）
 * ===================================================== */
(function () {
  'use strict';

  if (window.FUO_FEEDBACK) return; /* 防重复注入 */

  var CFG = window.FUO_CONFIG;
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;
  var RATE_KEY = 'fuo-fb-last';
  var RATE_MS = 60 * 1000; /* 60 秒内只允许提交一次（前端软限制） */

  /* ---------- 样式（自包含，不依赖页面 css 版本号） ---------- */
  var STYLE_ID = 'fuo-feedback-style';
  if (!document.getElementById(STYLE_ID)) {
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '/* 侧栏反馈按钮（与 side-logout 同构，青色 hover） */',
      '.sb-feedback{flex:none;width:30px;height:30px;border:none;border-radius:8px;',
      '  background:transparent;color:var(--faint,#8b93a1);display:grid;place-items:center;',
      '  cursor:pointer;transition:background .15s,color .15s;}',
      '.sb-feedback:hover{background:var(--accent-glow,rgba(45,212,191,.12));color:var(--accent,#2dd4bf);}',
      '.sb-feedback svg{width:16px;height:16px;}',
      '.shell.is-mini .sb-feedback{display:none;}',
      '',
      '/* 弹窗 */',
      '.fb-overlay{position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.55);',
      '  display:flex;align-items:center;justify-content:center;padding:20px;',
      '  animation:fb-fade .18s ease;}',
      '@keyframes fb-fade{from{opacity:0}}',
      '.fb-card{width:min(460px,100%);background:var(--card,#0e1114);',
      '  border:1px solid var(--line,rgba(255,255,255,.1));border-radius:14px;',
      '  box-shadow:0 24px 70px rgba(0,0,0,.5);padding:20px 22px;',
      '  animation:fb-up .2s cubic-bezier(.2,.9,.3,1.08);}',
      '@keyframes fb-up{from{opacity:0;transform:translateY(12px)}}',
      '.fb-title{font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;}',
      '.fb-title svg{width:17px;height:17px;color:var(--accent,#2dd4bf);}',
      '.fb-sub{font-size:12px;color:var(--faint,#8b93a1);margin-top:4px;line-height:1.6;}',
      '.fb-area{width:100%;margin-top:14px;background:var(--panel,#0b0d10);',
      '  border:1px solid var(--line,rgba(255,255,255,.1));border-radius:10px;',
      '  color:var(--text,#e8eaed);font:inherit;font-size:13.5px;line-height:1.6;',
      '  padding:10px 12px;min-height:110px;resize:vertical;}',
      '.fb-area:focus{outline:none;border-color:var(--accent,#2dd4bf);}',
      '.fb-contact{width:100%;margin-top:10px;background:var(--panel,#0b0d10);',
      '  border:1px solid var(--line,rgba(255,255,255,.1));border-radius:10px;',
      '  color:var(--text,#e8eaed);font:inherit;font-size:13px;padding:8px 12px;}',
      '.fb-contact:focus{outline:none;border-color:var(--accent,#2dd4bf);}',
      '.fb-foot{display:flex;align-items:center;gap:10px;margin-top:14px;}',
      '.fb-count{font-family:var(--mono,monospace);font-size:11px;color:var(--faint,#8b93a1);margin-right:auto;}',
      '.fb-cancel{border:1px solid var(--line,rgba(255,255,255,.14));background:transparent;',
      '  color:var(--dim,#9aa3ad);border-radius:9px;padding:8px 16px;font:inherit;font-size:13px;',
      '  cursor:pointer;transition:color .15s,border-color .15s;}',
      '.fb-cancel:hover{color:var(--text,#e8eaed);border-color:var(--faint,#8b93a1);}',
      '.fb-submit{background:var(--accent,#2dd4bf);color:#04211c;border:none;border-radius:9px;',
      '  padding:8px 20px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;',
      '  transition:filter .15s;}',
      '.fb-submit:hover{filter:brightness(1.12);}',
      '.fb-submit:disabled{opacity:.45;cursor:wait;}',
      '.fb-err{margin-top:10px;font-size:12px;color:var(--danger,#f47174);line-height:1.6;}',
      '',
      '/* 悬浮 toast */',
      '.fb-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:950;',
      '  background:var(--card,#0e1114);border:1px solid var(--accent,#2dd4bf);',
      '  border-radius:10px;padding:10px 20px;font-size:13px;color:var(--text,#e8eaed);',
      '  box-shadow:0 10px 34px rgba(0,0,0,.5);animation:fb-up .22s ease;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- 小工具 ---------- */
  function toast(text) {
    var t = document.createElement('div');
    t.className = 'fb-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 2400);
  }

  function client() {
    if (!window.supabase || !CFG || !CFG.SUPABASE_URL) return null;
    try { return window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); }
    catch (e) { return null; }
  }

  function mapError(err) {
    if (!err) return '未知错误';
    var code = err.code || '';
    var msg = err.message || String(err);
    if (code === 'PGRST205' || code === '42P01' || /does not exist/i.test(msg)) {
      return '反馈通道尚未就绪：需先执行 supabase-v7.sql 创建 feedback 表';
    }
    if (code === '42501') return '权限不足，暂时无法提交';
    if (code === '23514') return '内容长度需要在 1-500 字之间';
    if (/Failed to fetch|NetworkError/i.test(msg)) return '网络异常，请稍后再试';
    return msg;
  }

  /* ---------- 主流程 ---------- */
  var submitting = false;

  function open() {
    if (document.querySelector('.fb-overlay')) return; /* 已打开 */
    submitting = false;

    var overlay = document.createElement('div');
    overlay.className = 'fb-overlay';

    var card = document.createElement('div');
    card.className = 'fb-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', '用户反馈');

    var title = document.createElement('div');
    title.className = 'fb-title';
    title.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.36-4.1-1L3 21l1.5-5.4A8.5 8.5 0 1 1 21 12Z" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> 反馈';
    var sub = document.createElement('div');
    sub.className = 'fb-sub';
    sub.textContent = '遇到问题、有想法或发现 bug？告诉我们（≤500 字）。登录用户会附上用户名，方便回访。';

    var area = document.createElement('textarea');
    area.className = 'fb-area';
    area.maxLength = 500;
    area.placeholder = '描述你遇到的问题或建议…';
    area.setAttribute('aria-label', '反馈内容');

    var contact = document.createElement('input');
    contact.type = 'text';
    contact.className = 'fb-contact';
    contact.maxLength = 60;
    contact.placeholder = '联系方式（选填，QQ / 邮箱）';
    contact.setAttribute('aria-label', '联系方式，选填');

    var foot = document.createElement('div');
    foot.className = 'fb-foot';
    var count = document.createElement('span');
    count.className = 'fb-count';
    count.textContent = '0 / 500';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'fb-cancel';
    cancel.textContent = '取消';
    var submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'fb-submit';
    submit.textContent = '提交反馈';

    var errBox = document.createElement('div');
    errBox.className = 'fb-err';
    errBox.hidden = true;

    foot.appendChild(count);
    foot.appendChild(cancel);
    foot.appendChild(submit);

    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(area);
    card.appendChild(contact);
    card.appendChild(errBox);
    card.appendChild(foot);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    setTimeout(function () { area.focus(); }, 60);

    area.addEventListener('input', function () {
      count.textContent = area.value.length + ' / 500';
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
    cancel.addEventListener('click', close);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    submit.addEventListener('click', function () {
      if (submitting) return;
      var content = area.value.trim();
      errBox.hidden = true;
      if (!content) {
        errBox.textContent = '请先填写反馈内容';
        errBox.hidden = false;
        area.focus();
        return;
      }
      if (content.length > 500) {
        errBox.textContent = '内容超过 500 字，请精简后再提交';
        errBox.hidden = false;
        return;
      }

      /* 前端软频控：60 秒一次 */
      var last = 0;
      try { last = parseInt(localStorage.getItem(RATE_KEY) || '0', 10) || 0; } catch (e) { /* ignore */ }
      if (Date.now() - last < RATE_MS) {
        var wait = Math.ceil((RATE_MS - (Date.now() - last)) / 1000);
        errBox.textContent = '提交太频繁，请 ' + wait + ' 秒后再试';
        errBox.hidden = false;
        return;
      }

      /* 预览模式：假提交 */
      if (PREVIEW) {
        try { localStorage.setItem(RATE_KEY, String(Date.now())); } catch (e) { /* ignore */ }
        close();
        toast('已收到反馈（预览模式，未真正上传）');
        return;
      }

      var c = client();
      if (!c) {
        errBox.textContent = 'SDK 未就绪，请刷新页面后再试';
        errBox.hidden = false;
        return;
      }

      submitting = true;
      submit.disabled = true;
      submit.textContent = '提交中…';

      c.auth.getSession().then(function (_a) {
        var session = _a.data && _a.data.session;
        var row = {
          content: content,
          contact: contact.value.trim() || null,
          page: location.pathname,
          user_agent: (navigator.userAgent || '').slice(0, 200)
        };
        if (session) {
          row.user_id = session.user.id;
          row.username = (session.user.user_metadata && session.user.user_metadata.username) || null;
        }
        /* 登录用户：优先取 profiles 的权威用户名（改名后也准确） */
        var p = session
          ? c.from('profiles').select('username').eq('id', session.user.id).maybeSingle()
          : null;
        return Promise.resolve(p).then(function (_b) {
          if (_b && _b.data && _b.data.username) row.username = _b.data.username;
          return c.from('feedback').insert(row);
        });
      }).then(function (_r) {
        if (_r && _r.error) throw _r.error;
        try { localStorage.setItem(RATE_KEY, String(Date.now())); } catch (e) { /* ignore */ }
        close();
        toast('已收到，感谢你的反馈！');
      }).catch(function (e) {
        submitting = false;
        submit.disabled = false;
        submit.textContent = '提交反馈';
        errBox.textContent = '提交失败：' + mapError(e);
        errBox.hidden = false;
      });
    });
  }

  window.FUO_FEEDBACK = { open: open };
})();
