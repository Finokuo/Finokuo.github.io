/* =====================================================
 * Fuo Tools · 办公集共享数据层（office/ 全部工具复用）
 *
 * 设计：本地优先（localStorage 即写即用，离线可用）+ 云同步
 * （office_data 表，upsert 500ms 防抖；表未建时自动降级
 *   为「仅本机」模式并给出提示，不阻塞任何操作）。
 *
 * 用法（页面脚本）：
 *   FUO_OFFICE.load('todo', { items: [] }, function (data, status) { ... });
 *   FUO_OFFICE.save('todo', payload);
 *   FUO_OFFICE.onStatus(function (status) { ... });
 *
 * status：'cloud'（云同步正常）| 'local'（仅本机，表未建/未登录）
 *        | 'saving' | 'error'（上次云端写入失败，本地数据安全）
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var sb = null;
  var user = null;
  var userChecked = false;
  var tableOk = null;     // null=未探测 true/false
  var statusCbs = [];
  var curStatus = 'local';
  var saveTimers = {};    // kind → timer
  var latest = {};        // kind → 最新 payload

  function client() {
    if (sb) return sb;
    if (window.supabase && CFG && CFG.SUPABASE_URL) {
      try { sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); } catch (e) { /* ignore */ }
    }
    return sb;
  }

  function lsKey(kind) { return 'fuo-office-' + kind; }

  function readLocal(kind) {
    try {
      var raw = localStorage.getItem(lsKey(kind));
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') return o;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function writeLocal(kind, payload) {
    try { localStorage.setItem(lsKey(kind), JSON.stringify(payload)); } catch (e) { /* 隐私模式 */ }
  }

  function setStatus(s) {
    curStatus = s;
    statusCbs.forEach(function (cb) {
      try { cb(s); } catch (e) { /* ignore */ }
    });
  }

  function isMissingTable(err) {
    if (!err) return false;
    var m = err.message || '';
    return err.code === '42P01' || err.code === 'PGRST205' ||
      /relation .* does not exist/i.test(m) || /schema cache/i.test(m) ||
      /could not find the table/i.test(m);
  }

  /* ---------- 加载：云端有则用云端；没有则把本地/默认推上云 ---------- */
  function load(kind, fallback, cb) {
    var local = readLocal(kind);
    var payload = local || fallback;
    latest[kind] = payload;
    writeLocal(kind, payload);
    if (cb) cb(payload, curStatus);

    var c = client();
    if (!c) { setStatus('local'); return; }

    function afterAuth() {
      if (!user) { setStatus('local'); return; }
      c.from('office_data')
        .select('payload,updated_at')
        .eq('user_id', user.id)
        .eq('kind', kind)
        .maybeSingle()
        .then(function (_a) {
          if (_a.error) {
            if (isMissingTable(_a.error)) {
              tableOk = false;
              setStatus('local');
              return;
            }
            setStatus('error');
            return; // 读取失败：继续用本地
          }
          tableOk = true;
          if (_a.data && _a.data.payload && typeof _a.data.payload === 'object') {
            var cloud = _a.data.payload;
            // 本地是「刚初始化的默认值」而云端有内容 → 用云端覆盖；
            // 本地已有数据（老用户）→ 保留本地并把本地推上云（以本地为准）
            if (!local || JSON.stringify(local) === JSON.stringify(fallback)) {
              latest[kind] = cloud;
              writeLocal(kind, cloud);
              if (cb) cb(cloud, 'cloud');
            }
            setStatus('cloud');
            if (local && JSON.stringify(local) !== JSON.stringify(fallback) &&
                JSON.stringify(local) !== JSON.stringify(cloud)) {
              save(kind, local); // 本地更全：迁移上云
            }
          } else {
            // 云端无记录：把当前本地数据推上去（首次迁移）
            setStatus('cloud');
            save(kind, latest[kind]);
          }
        });
    }

    if (userChecked) { afterAuth(); return; }
    c.auth.getSession().then(function (_s) {
      userChecked = true;
      user = _s.data && _s.data.session ? _s.data.session.user : null;
      afterAuth();
    });
  }

  /* ---------- 保存：本地立即，云端防抖 upsert ---------- */
  function save(kind, payload) {
    latest[kind] = payload;
    writeLocal(kind, payload);

    var c = client();
    if (!c || !user || tableOk === false) return; // 仅本机模式

    clearTimeout(saveTimers[kind]);
    saveTimers[kind] = setTimeout(function () {
      setStatus('saving');
      var now = new Date().toISOString();
      c.from('office_data')
        .upsert({
          user_id: user.id,
          kind: kind,
          payload: latest[kind],
          updated_at: now,
        }, { onConflict: 'user_id,kind' })
        .then(function (_a) {
          if (_a.error) {
            if (isMissingTable(_a.error)) { tableOk = false; setStatus('local'); return; }
            setStatus('error');
            return;
          }
          tableOk = true;
          setStatus('cloud');
        });
    }, 500);
  }

  /* ---------- 对外 ---------- */
  window.FUO_OFFICE = {
    load: load,
    save: save,
    status: function () { return curStatus; },
    onStatus: function (cb) {
      if (typeof cb === 'function') {
        statusCbs.push(cb);
        cb(curStatus); // 立即回放一次当前状态
      }
    },
  };
})();
