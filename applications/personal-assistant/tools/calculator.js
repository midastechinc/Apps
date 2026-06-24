'use strict';
const vm = require('vm');

function calculate({ expression }) {
  if (!expression) return { error: 'expression is required' };
  const expr = String(expression).trim().slice(0, 500);
  // ^ is a common power-of alias
  const safeExpr = expr.replace(/\^/g, '**');

  const sandbox = {
    Math,
    sqrt: Math.sqrt,
    pow: Math.pow,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    log: Math.log,
    log2: Math.log2,
    log10: Math.log10,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    PI: Math.PI,
    E: Math.E,
    Infinity,
  };

  try {
    const raw = vm.runInNewContext(safeExpr, sandbox, { timeout: 500 });
    if (typeof raw !== 'number' || !isFinite(raw)) {
      return { error: 'Expression produced an invalid result' };
    }
    const result = Math.round(raw * 1e10) / 1e10;
    return { expression: expr, result };
  } catch (err) {
    return { error: `Calculation error: ${err.message}` };
  }
}

module.exports = { calculate };
