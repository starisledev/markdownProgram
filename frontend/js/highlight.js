/* ============================================================
   highlight.js — 轻量语法高亮（零依赖）
   用法: HL.highlight(code, 'js') -> HTML 字符串
   ============================================================ */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  var COM_C  = /(?:#[^\n]*)/;                                   // # 注释
  var COM_SL = /(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/;               // // 与 /* */
  var STR_S  = /(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/;       // 单双引号
  var STR_T  = /(?:`(?:\\.|[^`\\])*`)/;                         // 模板字符串
  var STR_PY = /(?:[rbfu]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))/;
  var NUM    = /(?:\b0[xX][0-9a-fA-F_]+\b|\b0[bB][01_]+\b|\b\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?\b)/;
  var FN     = /(?:[A-Za-z_$][\w$]*(?=\s*\())/;
  var PUNCT  = /(?:[{}()\[\];,.:?!=<>+\-*/%&|^~]+)/;

  function kw(list) { return new RegExp('\\b(?:' + list.join('|') + ')\\b'); }
  function builtin(list) { return new RegExp('\\b(?:' + list.join('|') + ')\\b'); }

  var JS_KW = ['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','delete','typeof','instanceof','in','of','this','class','extends','super','import','export','from','default','async','await','yield','try','catch','finally','throw','with','void','get','set','static','null','undefined','true','false','public','private','protected','readonly','interface','type','enum','implements','declare','namespace','abstract','as','satisfies','keyof','infer','is','asserts','global'];
  var JS_BI = ['console','window','document','Math','JSON','Object','Array','String','Number','Boolean','Date','RegExp','Promise','Map','Set','Symbol','Error','parseInt','parseFloat','isNaN','require','module','exports','process','globalThis','localStorage','setTimeout','setInterval','fetch','undefined','NaN','Infinity'];

  var PY_KW = ['def','class','return','if','elif','else','for','while','break','continue','pass','import','from','as','with','try','except','finally','raise','lambda','yield','global','nonlocal','assert','del','in','is','not','and','or','async','await','match','case'];
  var PY_BI = ['True','False','None','self','cls','print','len','range','int','str','float','bool','list','dict','set','tuple','type','super','isinstance','enumerate','zip','open','sum','min','max','abs','sorted','map','filter','any','all','input','format','repr','hasattr','getattr','setattr'];

  var C_KW = ['if','else','for','while','do','switch','case','break','continue','return','goto','struct','union','enum','typedef','static','const','volatile','extern','register','sizeof','inline','restrict','auto','default','char','int','long','short','float','double','void','signed','unsigned','bool','true','false','NULL','nullptr'];
  var CS_KW = ['using','namespace','class','struct','interface','enum','public','private','protected','internal','static','readonly','const','void','int','string','bool','var','new','this','base','return','if','else','for','foreach','while','do','switch','case','break','continue','try','catch','finally','throw','async','await','get','set','null','true','false','virtual','override','abstract','sealed','partial','out','ref','in','is','as','delegate','event','record'];
  var JAVA_KW = ['public','private','protected','class','interface','enum','extends','implements','static','final','void','int','long','double','float','boolean','char','byte','short','new','this','super','return','if','else','for','while','do','switch','case','break','continue','try','catch','finally','throw','throws','import','package','abstract','synchronized','volatile','transient','instanceof','true','false','null','var','record','sealed'];
  var GO_KW = ['package','import','func','return','if','else','for','range','switch','case','default','break','continue','go','defer','chan','select','struct','interface','map','type','const','var','fallthrough','goto','nil','true','false','make','new','len','cap','append','copy','delete','panic','recover','print','println'];
  var RS_KW = ['fn','let','mut','const','static','struct','enum','impl','trait','pub','use','mod','crate','self','Self','super','as','where','match','if','else','for','while','loop','in','break','continue','return','move','ref','dyn','type','unsafe','async','await','true','false','None','Some','Ok','Err','Vec','String','Option','Result','Box'];
  var PHP_KW = ['function','class','interface','trait','namespace','use','public','private','protected','static','const','echo','print','return','if','elseif','else','for','foreach','while','do','switch','case','break','continue','try','catch','finally','throw','new','extends','implements','abstract','final','global','isset','unset','empty','array','true','false','null','as','instanceof','require','include','declare','yield','fn','match'];
  var RB_KW = ['def','class','module','end','if','elsif','else','unless','case','when','while','until','for','do','begin','rescue','ensure','raise','return','yield','self','nil','true','false','and','or','not','then','require','attr_accessor','lambda','proc','super','alias','defined?','new'];
  var SW_KW = ['func','class','struct','enum','protocol','extension','import','let','var','if','else','for','in','while','repeat','switch','case','default','break','continue','return','guard','where','defer','do','try','catch','throw','self','init','deinit','static','public','private','fileprivate','open','internal','override','mutating','async','await','some','any','as','is','nil','true','false','print'];
  var KT_KW = ['fun','val','var','class','interface','object','data','enum','sealed','package','import','if','else','for','while','do','when','return','break','continue','try','catch','finally','throw','is','in','as','this','super','companion','init','constructor','override','suspend','inline','lateinit','const','typealias','true','false','null'];
  var SQL_KW = ['SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','ALTER','DROP','INDEX','VIEW','JOIN','LEFT','RIGHT','INNER','OUTER','FULL','ON','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET','AS','AND','OR','NOT','NULL','IS','IN','LIKE','BETWEEN','EXISTS','UNION','ALL','DISTINCT','CASE','WHEN','THEN','ELSE','END','PRIMARY','KEY','FOREIGN','REFERENCES','DEFAULT','UNIQUE','CHECK','ASC','DESC','COUNT','SUM','AVG','MIN','MAX','WITH','TRUNCATE','BEGIN','COMMIT','ROLLBACK','VARCHAR','INT','INTEGER','TEXT','BOOLEAN','DATE','TIMESTAMP','DECIMAL','BIGINT','SERIAL'];
  var SH_KW = ['if','then','else','elif','fi','for','while','until','do','done','case','esac','function','return','in','select','time','coproc','local','export','readonly','declare','typeset','unset','shift','source','exit','trap','set','echo','cd','pwd','test'];

  var LANGS = {
    /* ---- JS / TS ---- */
    javascript: { alias: ['js','jsx','mjs','cjs','node','javascript'], rules: [
      ['com', COM_SL], ['str', STR_T], ['str', STR_S],
      ['num', NUM], ['key', kw(JS_KW)], ['fn', FN], ['var', builtin(JS_BI)], ['punct', PUNCT]
    ]},
    typescript: { alias: ['ts','tsx','typescript'], rules: [
      ['com', COM_SL], ['str', STR_T], ['str', STR_S],
      ['num', NUM], ['key', kw(JS_KW)], ['fn', FN], ['var', builtin(JS_BI)], ['punct', PUNCT]
    ]},
    json: { alias: ['json','jsonc'], rules: [
      ['str', /"(?:\\.|[^"\\])*"(?=\s*:)/], ['str', STR_S],
      ['num', NUM], ['key', /\b(?:true|false|null)\b/], ['punct', PUNCT]
    ]},
    /* ---- Web ---- */
    html: { alias: ['html','htm','vue','svelte','xml','svg','jsx-html'], rules: [
      ['com', /<!--[\s\S]*?-->/],
      ['str', STR_S],
      ['tag', /<\/?[A-Za-z][\w:-]*/], ['punct', /\/?>/],
      ['attr', /[A-Za-z_:][\w:.-]*(?==)/],
      ['num', NUM], ['punct', /[=]/]
    ]},
    css: { alias: ['css','less','sass','scss'], rules: [
      ['com', /\/\*[\s\S]*?\*\//],
      ['str', STR_S],
      ['attr', /--[\w-]+|@[a-z-]+/],
      ['tag', /[.#][A-Za-z_][\w-]*|&|::?[a-z-]+(?=\s*[{;,])/],
      ['fn', /[a-z-]+(?=\s*\()/],
      ['num', /-?\b\d[\d.]*(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch|pt)?/],
      ['var', /#[0-9a-fA-F]{3,8}\b/],
      ['punct', /[{}();:,]/]
    ]},
    /* ---- 后端 ---- */
    python: { alias: ['python','py','python3'], rules: [
      ['com', COM_C], ['str', STR_PY],
      ['key', kw(PY_KW)], ['fn', FN], ['var', builtin(PY_BI)],
      ['num', NUM], ['punct', PUNCT]
    ]},
    c: { alias: ['c','h','cpp','c++','cc','hpp','csharp','cs','java','kotlin','kt','dart','scala'], rules: [
      ['com', COM_SL], ['str', STR_S],
      ['key', kw(C_KW.concat(JAVA_KW, CS_KW, GO_KW, KT_KW))],
      ['fn', FN], ['num', NUM], ['punct', PUNCT]
    ]},
    go: { alias: ['go','golang'], rules: [
      ['com', COM_SL], ['str', STR_S], ['str', STR_T],
      ['key', kw(GO_KW)], ['fn', FN], ['num', NUM], ['punct', PUNCT]
    ]},
    rust: { alias: ['rust','rs'], rules: [
      ['com', COM_SL], ['str', STR_S],
      ['key', kw(RS_KW)], ['fn', FN], ['num', NUM], ['punct', PUNCT]
    ]},
    php: { alias: ['php'], rules: [
      ['com', COM_SL], ['com', COM_C], ['str', STR_S],
      ['var', /\$[A-Za-z_]\w*/], ['key', kw(PHP_KW)], ['fn', FN],
      ['num', NUM], ['punct', PUNCT]
    ]},
    ruby: { alias: ['ruby','rb'], rules: [
      ['com', COM_C], ['str', STR_S],
      ['var', /[@$:][A-Za-z_]\w*|:\w+/], ['key', kw(RB_KW)], ['fn', FN],
      ['num', NUM], ['punct', PUNCT]
    ]},
    swift: { alias: ['swift'], rules: [
      ['com', COM_SL], ['str', STR_S],
      ['key', kw(SW_KW)], ['fn', FN], ['num', NUM], ['punct', PUNCT]
    ]},
    sql: { alias: ['sql','mysql','pgsql','postgres','sqlite'], rules: [
      ['com', /--[^\n]*|\/\*[\s\S]*?\*\//], ['str', STR_S],
      ['key', new RegExp('\\b(?:' + SQL_KW.join('|') + ')\\b', 'i')],
      ['num', NUM], ['punct', PUNCT]
    ]},
    bash: { alias: ['bash','sh','shell','zsh','console','cmd','powershell','ps1'], rules: [
      ['com', COM_C], ['str', STR_S], ['var', /\$\{?[\w@#*?$!-]+\}?/],
      ['key', kw(SH_KW)], ['fn', FN], ['num', NUM], ['punct', PUNCT]
    ]},
    yaml: { alias: ['yaml','yml','toml','ini','conf','properties'], rules: [
      ['com', COM_C], ['str', STR_S],
      ['attr', /^\s*[\w.$-]+(?=\s*:)/m],
      ['key', /\b(?:true|false|null|yes|no|on|off)\b/],
      ['num', NUM], ['punct', /[:\-|[\]{}]/]
    ]},
    diff: { alias: ['diff','patch'], rules: [
      ['com', /^[-+][^\n]*/m], ['attr', /^@@[^\n]*@@/m], ['str', /^\w[^\n]*/m]
    ]},
    markdown: { alias: ['markdown','md'], rules: [
      ['com', /^#{1,6} .*$/m], ['str', /`[^`]*`/],
      ['attr', /^\s*[-*+] |^\s*\d+\. /m],
      ['key', /\*\*[^*]+\*\*|\*[^*]+\*/], ['punct', /^>.*$/m]
    ]}
  };

  // 建立 lang -> key 索引
  var INDEX = {};
  Object.keys(LANGS).forEach(function (k) {
    INDEX[k] = k;
    (LANGS[k].alias || []).forEach(function (a) { INDEX[a] = k; });
  });

  // 预编译合并正则
  var CACHE = {};
  function compiled(key) {
    if (CACHE[key]) return CACHE[key];
    var rules = LANGS[key].rules;
    var src = rules.map(function (r) { return '(' + r[1].source + ')'; }).join('|');
    var re;
    try { re = new RegExp(src, 'gm'); } catch (e) { re = null; }
    CACHE[key] = { re: re, types: rules.map(function (r) { return r[0]; }) };
    return CACHE[key];
  }

  /**
   * 高亮代码
   * @param {string} code 原始代码
   * @param {string} lang 语言标识
   * @returns {string} 带 <span class="tok-*"> 的 HTML
   */
  function highlight(code, lang) {
    if (code == null) code = '';
    code = String(code).replace(/\t/g, '  ');
    var key = INDEX[String(lang || '').toLowerCase().trim()];
    if (!key) return esc(code);

    var c = compiled(key);
    if (!c.re) return esc(code);

    var out = '';
    var last = 0;
    var m;
    c.re.lastIndex = 0;
    var guard = 0;
    while ((m = c.re.exec(code)) !== null && guard++ < 20000) {
      if (m[0] === '') { c.re.lastIndex++; continue; }
      var type = null;
      for (var i = 1; i < m.length; i++) {
        if (m[i] !== undefined) { type = c.types[i - 1]; break; }
      }
      out += esc(code.slice(last, m.index));
      out += '<span class="tok-' + (type || 'punct') + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    out += esc(code.slice(last));
    return out;
  }

  global.HL = {
    highlight: highlight,
    escape: esc,
    langs: Object.keys(LANGS),
    has: function (l) { return !!INDEX[String(l || '').toLowerCase().trim()]; }
  };
})(window);
