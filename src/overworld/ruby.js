// A tiny Ruby-subset interpreter for the script snippets inside the story
// events (e.g. `TrainerBattle.start(:YOUNGSTER, "Ben")`, `$bag.has?(:POTION)`,
// `pkmn.iv[:HP] = 20`). It supports literals, symbols, arrays, hashes,
// locals, $globals, Constants::Paths, method calls (with ?/! names), indexing,
// assignment, op-assignment and the usual operators. Evaluation is a generator
// so a call can pause the event (messages, battles, menus) and resume later.
// Ruby symbols become plain JS strings.
'use strict';

G.Ruby = (() => {
  // ---------------------------------------------------------------- lexer
  const PUNCT = ['**=', '||=', '&&=', '<=>', '===', '...', '..', '::', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '=>', '<<', '>>',
    '+', '-', '*', '/', '%', '=', '<', '>', '!', '(', ')', '[', ']', '{', '}', ',', '.', '?', ':', ';', '&', '|'];
  function lex(src) {
    const toks = [];
    let i = 0, depth = 0;
    const push = (t) => toks.push(t);
    while (i < src.length) {
      const c = src[i];
      if (c === '#' ) { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '\n' || c === ';') {
        const last = toks[toks.length - 1];
        const cont = depth > 0 || (last && last.t === 'op' && !['(', '[', '{', ')', ']', '}', '!'].includes(last.v)) || (last && last.t === 'op' && last.v === ',');
        if (!cont && last && last.t !== 'nl') push({ t: 'nl' });
        i++; continue;
      }
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c)) {
        const m = src.slice(i).match(/^\d[\d_]*(\.\d+)?/);
        push({ t: 'num', v: Number(m[0].replace(/_/g, '')) }); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1, s = '', parts = [];
        while (j < src.length && src[j] !== c) {
          if (src[j] === '\\' && j + 1 < src.length) {
            const n = src[j + 1];
            s += c === "'" ? (n === "'" || n === '\\' ? n : '\\' + n) : ({ n: '\n', t: '\t', '"': '"', '\\': '\\' }[n] ?? ('\\' + n));
            j += 2; continue;
          }
          if (c === '"' && src[j] === '#' && src[j + 1] === '{') {
            let k = j + 2, d = 1;
            while (k < src.length && d > 0) { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; }
            parts.push(s); s = '';
            parts.push({ code: src.slice(j + 2, k - 1) });
            j = k; continue;
          }
          s += src[j++];
        }
        if (parts.length) { parts.push(s); push({ t: 'istr', v: parts }); } else push({ t: 'str', v: s });
        i = j + 1; continue;
      }
      if (c === ':' && /[A-Za-z_]/.test(src[i + 1] || '') && !(toks.length && toks[toks.length - 1].t === 'op' && toks[toks.length - 1].v === '?' && false)) {
        // symbol (but not the ':' of "a ? b : c" when followed by space)
        const prev = src[i - 1];
        if (prev !== ':' ) {
          const m = src.slice(i + 1).match(/^[A-Za-z_]\w*[?!]?/);
          push({ t: 'sym', v: m[0] }); i += 1 + m[0].length; continue;
        }
      }
      if (c === '$' || c === '@' || /[A-Za-z_]/.test(c)) {
        const m = src.slice(i).match(/^(\$|@@?)?[A-Za-z_]\w*[?!]?/);
        let v = m[0];
        // `foo?(` is a method name; but `a ?b :c` ternaries are not used in the data.
        push({ t: 'id', v }); i += v.length;
        // hash key shorthand  key: value
        if (src[i] === ':' && src[i + 1] === ' ' && depth > 0 && /^[a-z_]/.test(v)) { toks[toks.length - 1] = { t: 'sym', v }; push({ t: 'op', v: '=>' }); i++; }
        continue;
      }
      const p = PUNCT.find((q) => src.startsWith(q, i));
      if (!p) throw new Error('Ruby lexer: unexpected ' + c + ' in ' + src);
      if ('([{'.includes(p)) depth++;
      if (')]}'.includes(p)) depth--;
      push({ t: 'op', v: p, spaceBefore: /\s/.test(src[i - 1] || '') });
      i += p.length;
    }
    push({ t: 'eof' });
    return toks;
  }

  // --------------------------------------------------------------- parser
  function parse(src) {
    const toks = lex(src);
    let p = 0;
    const peek = (o = 0) => toks[p + o];
    const isOp = (v, o = 0) => peek(o).t === 'op' && peek(o).v === v;
    const next = () => toks[p++];
    const expect = (v) => { if (!isOp(v)) throw new Error(`Ruby parse: expected ${v} near ${JSON.stringify(peek())} in ${src}`); p++; };

    function program() {
      const body = [];
      while (peek().t !== 'eof') {
        if (peek().t === 'nl') { p++; continue; }
        body.push(statement());
      }
      return { k: 'block', body };
    }
    function statement() {
      const e = expr();
      // trailing `if cond` / `unless cond`
      if (peek().t === 'id' && (peek().v === 'if' || peek().v === 'unless')) {
        const neg = next().v === 'unless';
        const cond = expr();
        return { k: 'if', cond: neg ? { k: 'not', e: cond } : cond, then: e };
      }
      return e;
    }
    function expr() { return assignment(); }
    function assignment() {
      const left = ternary();
      if (peek().t === 'op' && ['=', '+=', '-=', '*=', '/=', '||=', '&&='].includes(peek().v)) {
        const op = next().v;
        const right = assignment();
        return { k: 'assign', op, target: left, value: right };
      }
      return left;
    }
    function ternary() {
      const c = binary(0);
      if (isOp('?')) {
        p++;
        const a = ternary();
        expect(':');
        const b = ternary();
        return { k: 'tern', c, a, b };
      }
      return c;
    }
    const PREC = [['||', 'or'], ['&&', 'and'], ['==', '!=', '==='], ['<', '>', '<=', '>='], ['..', '...'], ['<<', '>>'], ['+', '-'], ['*', '/', '%'], ['**']];
    function binary(level) {
      if (level >= PREC.length) return unary();
      let left = binary(level + 1);
      while (true) {
        const t = peek();
        const v = t.t === 'op' ? t.v : (t.t === 'id' && (t.v === 'and' || t.v === 'or') ? t.v : null);
        if (!v || !PREC[level].includes(v)) break;
        p++;
        const right = binary(level + 1);
        left = { k: 'bin', op: v === 'and' ? '&&' : v === 'or' ? '||' : v, a: left, b: right };
      }
      return left;
    }
    function unary() {
      if (isOp('!')) { p++; return { k: 'not', e: unary() }; }
      if (peek().t === 'id' && peek().v === 'not') { p++; return { k: 'not', e: unary() }; }
      if (isOp('-')) { p++; return { k: 'neg', e: unary() }; }
      return postfix(primary());
    }
    function args(close) {
      const list = [];
      while (!isOp(close)) {
        if (peek().t === 'nl') { p++; continue; }
        // hash args without braces: foo(a, :k => v)
        const e = expr();
        if (isOp('=>')) {
          p++;
          const h = { k: 'hash', pairs: [[e, expr()]] };
          while (isOp(',') && !isOp(close, 1)) {
            p++;
            const k2 = expr(); expect('=>'); h.pairs.push([k2, expr()]);
          }
          list.push(h);
        } else list.push(e);
        if (isOp(',')) p++;
        else break;
      }
      while (peek().t === 'nl') p++;
      expect(close);
      return list;
    }
    // Can an identifier be followed by a paren-less argument list?
    function startsArg(t) {
      if (!t) return false;
      if (t.t === 'num' || t.t === 'str' || t.t === 'istr' || t.t === 'sym') return true;
      if (t.t === 'id' && !['if', 'unless', 'and', 'or', 'then', 'do', 'end'].includes(t.v)) return true;
      return false;
    }
    function primary() {
      const t = next();
      switch (t.t) {
        case 'num': return { k: 'lit', v: t.v };
        case 'str': return { k: 'lit', v: t.v };
        case 'istr': return { k: 'istr', parts: t.v.map((x) => (typeof x === 'string' ? x : parse(x.code))) };
        case 'sym': return { k: 'lit', v: t.v };
        case 'id': {
          const v = t.v;
          if (v === 'nil') return { k: 'lit', v: null };
          if (v === 'true') return { k: 'lit', v: true };
          if (v === 'false') return { k: 'lit', v: false };
          if (v === 'self') return { k: 'self' };
          if (isOp('(') && !peek().spaceBefore) { p++; return { k: 'call', recv: null, name: v, args: args(')') }; }
          if (/^[A-Z]/.test(v)) return { k: 'const', name: v };
          if (v[0] === '$' || v[0] === '@') return { k: 'gvar', name: v };
          // paren-less call with arguments, e.g.  pbChangePlayer 1
          if (startsArg(peek()) && /^pb|^set|^get/.test(v)) {
            const list = [expr()];
            while (isOp(',')) { p++; list.push(expr()); }
            return { k: 'call', recv: null, name: v, args: list };
          }
          return { k: 'ident', name: v };
        }
        case 'op':
          if (t.v === '(') { const e = expr(); while (peek().t === 'nl') p++; expect(')'); return e; }
          if (t.v === '[') return { k: 'array', items: args(']') };
          if (t.v === '{') {
            const pairs = [];
            while (!isOp('}')) {
              if (peek().t === 'nl' || isOp(',')) { p++; continue; }
              const key = expr(); expect('=>'); pairs.push([key, expr()]);
            }
            expect('}');
            return { k: 'hash', pairs };
          }
      }
      throw new Error('Ruby parse: unexpected ' + JSON.stringify(t) + ' in ' + src);
    }
    function postfix(e) {
      while (true) {
        if (isOp('.') ) {
          p++;
          const name = next().v;
          if (isOp('(') && !peek().spaceBefore) { p++; e = { k: 'call', recv: e, name, args: args(')') }; }
          else e = { k: 'call', recv: e, name, args: null };
        } else if (isOp('::')) {
          p++;
          const name = next().v;
          if (isOp('(')) { p++; e = { k: 'call', recv: e, name, args: args(')') }; }
          else e = { k: 'scope', recv: e, name };
        } else if (isOp('[') && !peek().spaceBefore) {
          p++;
          e = { k: 'index', recv: e, args: args(']') };
        } else break;
      }
      return e;
    }
    return program();
  }

  // ------------------------------------------------------------ evaluator
  const cache = new Map();
  function compile(src) {
    let ast = cache.get(src);
    if (!ast) { ast = parse(src); cache.set(src, ast); }
    return ast;
  }
  const isGen = (v) => v && typeof v.next === 'function' && typeof v[Symbol.iterator] === 'function';

  // env: { locals, self, resolveGlobal(name), resolveConst(name), callTop(name, args) }
  function* ev(n, env) {
    switch (n.k) {
      case 'block': { let r = null; for (const s of n.body) r = yield* ev(s, env); return r; }
      case 'lit': return n.v;
      case 'istr': { let s = ''; for (const part of n.parts) s += typeof part === 'string' ? part : String(yield* ev(part, env)); return s; }
      case 'array': { const a = []; for (const it of n.items) a.push(yield* ev(it, env)); return a; }
      case 'hash': { const h = new Map(); for (const [k, v] of n.pairs) h.set(yield* ev(k, env), yield* ev(v, env)); return h; }
      case 'self': return env.self;
      case 'gvar': return env.resolveGlobal(n.name);
      case 'const': return env.resolveConst(n.name);
      case 'scope': {
        const base = yield* ev(n.recv, env);
        if (base && n.name in base) return base[n.name];
        return env.resolveConst((n.recv.name || '') + '::' + n.name);
      }
      case 'ident':
        if (Object.prototype.hasOwnProperty.call(env.locals, n.name)) return env.locals[n.name];
        return yield* callTop(n.name, [], env);
      case 'call': {
        const args = [];
        for (const a of n.args || []) args.push(yield* ev(a, env));
        if (!n.recv) return yield* callTop(n.name, args, env);
        const recv = yield* ev(n.recv, env);
        return yield* callMethod(recv, n.name, args, n.args !== null);
      }
      case 'index': {
        const recv = yield* ev(n.recv, env);
        const args = [];
        for (const a of n.args) args.push(yield* ev(a, env));
        return index(recv, args[0]);
      }
      case 'not': return !truthy(yield* ev(n.e, env));
      case 'neg': return -(yield* ev(n.e, env));
      case 'tern': return truthy(yield* ev(n.c, env)) ? yield* ev(n.a, env) : yield* ev(n.b, env);
      case 'if': if (truthy(yield* ev(n.cond, env))) return yield* ev(n.then, env); return null;
      case 'bin': {
        if (n.op === '&&') { const a = yield* ev(n.a, env); return truthy(a) ? yield* ev(n.b, env) : a; }
        if (n.op === '||') { const a = yield* ev(n.a, env); return truthy(a) ? a : yield* ev(n.b, env); }
        const a = yield* ev(n.a, env), b = yield* ev(n.b, env);
        switch (n.op) {
          case '+': return Array.isArray(a) ? a.concat(b) : a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return Number.isInteger(a) && Number.isInteger(b) ? Math.floor(a / b) : a / b;
          case '%': return ((a % b) + b) % b;
          case '**': return Math.pow(a, b);
          case '==': case '===': return eq(a, b);
          case '!=': return !eq(a, b);
          case '<': return a < b;
          case '>': return a > b;
          case '<=': return a <= b;
          case '>=': return a >= b;
          case '<<': if (Array.isArray(a)) { a.push(b); return a; } return a << b;
          case '..': case '...': { const r = []; for (let i = a; n.op === '..' ? i <= b : i < b; i++) r.push(i); return r; }
        }
        throw new Error('Ruby: unsupported operator ' + n.op);
      }
      case 'assign': {
        let value;
        if (n.op === '=') value = yield* ev(n.value, env);
        else {
          const cur = yield* ev(n.target, env);
          if (n.op === '||=') { if (truthy(cur)) return cur; value = yield* ev(n.value, env); }
          else if (n.op === '&&=') { if (!truthy(cur)) return cur; value = yield* ev(n.value, env); }
          else {
            const v = yield* ev(n.value, env);
            value = { '+=': cur + v, '-=': cur - v, '*=': cur * v, '/=': Math.floor(cur / v) }[n.op];
          }
        }
        const t = n.target;
        if (t.k === 'ident') env.locals[t.name] = value;
        else if (t.k === 'gvar') env.assignGlobal(t.name, value);
        else if (t.k === 'call' && t.recv) {
          const recv = yield* ev(t.recv, env);
          if (typeof recv[t.name + '='] === 'function') recv[t.name + '='](value);
          else recv[t.name] = value;
        } else if (t.k === 'index') {
          const recv = yield* ev(t.recv, env);
          const key = yield* ev(t.args[0], env);
          if (recv instanceof Map) recv.set(key, value);
          else if (typeof recv['[]='] === 'function') recv['[]='](key, value);
          else recv[key] = value;
        } else throw new Error('Ruby: cannot assign to ' + t.k);
        return value;
      }
    }
    throw new Error('Ruby: unknown node ' + n.k);
  }
  function truthy(v) { return v !== false && v !== null && v !== undefined; }
  function eq(a, b) { return a === b || (a == null && b == null); }
  function index(recv, key) {
    if (recv instanceof Map) return recv.has(key) ? recv.get(key) : null;
    if (recv && typeof recv['[]'] === 'function') return recv['[]'](key);
    if (recv == null) return null;
    const v = recv[key];
    return v === undefined ? null : v;
  }
  function* callTop(name, args, env) {
    const r = env.callTop(name, args);
    return isGen(r) ? yield* r : r;
  }
  function* callMethod(recv, name, args, hadParens) {
    if (recv == null) throw new Error(`Ruby: undefined method ${name} for nil`);
    // Built-in Ruby methods on plain values
    if (recv instanceof Map) {
      if (name === 'merge!') { for (const [k, v] of args[0]) recv.set(k, v); return recv; }
      if (name === 'keys') return [...recv.keys()];
      if (name === 'values') return [...recv.values()];
      if (name === 'include?' || name === 'has_key?' || name === 'key?') return recv.has(args[0]);
      if (name === 'length' || name === 'size') return recv.size;
    }
    if (Array.isArray(recv) || typeof recv === 'string') {
      switch (name) {
        case 'length': case 'size': return recv.length;
        case 'include?': return recv.includes(args[0]);
        case 'empty?': return recv.length === 0;
        case 'first': return recv[0] ?? null;
        case 'last': return recv[recv.length - 1] ?? null;
        case 'push': recv.push(...args); return recv;
        case 'to_s': return String(recv);
        case 'to_sym': return recv;
        case 'upcase': return recv.toUpperCase();
        case 'downcase': return recv.toLowerCase();
      }
    }
    if (typeof recv === 'number') {
      switch (name) {
        case 'to_i': return Math.trunc(recv);
        case 'to_s': return String(recv);
        case 'to_f': return recv;
        case 'abs': return Math.abs(recv);
        case 'zero?': return recv === 0;
      }
    }
    if (typeof recv === 'boolean' && name === 'to_s') return String(recv);
    if (name === 'is_a?' || name === 'kind_of?') {
      // Symbols and strings are both JS strings here
      const t = String(args[0]);
      if (t === 'Symbol' || t === 'String') return typeof recv === 'string';
      if (t === 'Integer' || t === 'Numeric') return typeof recv === 'number';
      return false;
    }
    const m = recv[name];
    if (typeof m === 'function') {
      const r = m.apply(recv, args);
      return isGen(r) ? yield* r : r;
    }
    if (!hadParens && m !== undefined) return m;
    if (name === 'nil?') return recv == null;
    if (name === 'to_s') return String(recv);
    throw new Error(`Ruby: undefined method '${name}' for ${recv && recv.constructor ? recv.constructor.name : typeof recv}`);
  }

  return {
    parse: compile,
    truthy,
    // Run source; returns a generator (use `yield*`) that yields while waiting.
    *run(src, env) {
      const ast = compile(src);
      return yield* ev(ast, env);
    },
    // Run synchronously (for conditions that can't pause). Throws if the
    // script tries to wait.
    runSync(src, env) {
      const g = this.run(src, env);
      const r = g.next();
      if (!r.done) throw new Error('Script tried to wait in a synchronous context: ' + src);
      return r.value;
    },
  };
})();
