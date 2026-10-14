import { MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * Amount expressions of posting-rule templates (ADR-0007): decimal arithmetic over event payload paths.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/') factor)*
 *   factor := number | path | fn '(' expr (',' expr)* ')' | '(' expr ')' | '-' factor
 *   fn     := round | min | max | abs
 *
 * A path (`amounts.net`, `item.net`) reads the scope; a missing or `null` value counts as 0 (optional
 * amounts such as withholding), anything that is not a decimal is an error. `round` rounds half-up to
 * 2 decimals (accounting-design §1.5); every line amount is rounded that way anyway.
 */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type Token =
  | { kind: 'num'; value: string }
  | { kind: 'path'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '(' | ')' | ',' };

const FUNCTIONS = new Set(['round', 'min', 'max', 'abs']);
const DECIMAL = /^-?\d+(\.\d+)?$/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === ' ') {
      i++;
    } else if ('+-*/(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch as '+' });
      i++;
    } else if (/\d/.test(ch)) {
      const match = /^\d+(\.\d+)?/.exec(source.slice(i))!;
      tokens.push({ kind: 'num', value: match[0] });
      i += match[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*/.exec(source.slice(i))!;
      tokens.push({ kind: 'path', value: match[0] });
      i += match[0].length;
    } else {
      throw new ExpressionError(`unexpected "${ch}" in "${source}"`);
    }
  }
  return tokens;
}

export type Scope = Record<string, unknown>;

/** Reads a dotted path; numeric segments index arrays. */
export function readPath(scope: Scope, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) return /^\d+$/.test(key) ? value[Number(key)] : undefined;
    return typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  }, scope);
}

function toDecimal(value: unknown, path: string): MoneyValue {
  if (value === null || value === undefined) return new MoneyDecimal(0);
  if (typeof value === 'number' && Number.isFinite(value)) return new MoneyDecimal(value);
  if (typeof value === 'string' && DECIMAL.test(value)) return new MoneyDecimal(value);
  throw new ExpressionError(`"${path}" is not a decimal (${JSON.stringify(value)})`);
}

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly resolve: (path: string) => unknown,
    private readonly source: string,
  ) {}

  parse(): MoneyValue {
    const value = this.expr();
    if (this.pos !== this.tokens.length) throw new ExpressionError(`trailing input in "${this.source}"`);
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eat(value: string): boolean {
    const t = this.peek();
    if (t?.kind === 'op' && t.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expr(): MoneyValue {
    let left = this.term();
    for (;;) {
      if (this.eat('+')) left = left.add(this.term());
      else if (this.eat('-')) left = left.sub(this.term());
      else return left;
    }
  }

  private term(): MoneyValue {
    let left = this.factor();
    for (;;) {
      if (this.eat('*')) left = left.mul(this.factor());
      else if (this.eat('/')) {
        const right = this.factor();
        if (right.isZero()) throw new ExpressionError(`division by zero in "${this.source}"`);
        left = left.div(right);
      } else return left;
    }
  }

  private factor(): MoneyValue {
    const t = this.peek();
    if (!t) throw new ExpressionError(`unexpected end of "${this.source}"`);
    if (this.eat('-')) return this.factor().neg();
    if (this.eat('(')) {
      const value = this.expr();
      if (!this.eat(')')) throw new ExpressionError(`missing ")" in "${this.source}"`);
      return value;
    }
    this.pos++;
    if (t.kind === 'num') return new MoneyDecimal(t.value);
    if (t.kind === 'path') {
      if (FUNCTIONS.has(t.value) && this.eat('(')) {
        const args = [this.expr()];
        while (this.eat(',')) args.push(this.expr());
        if (!this.eat(')')) throw new ExpressionError(`missing ")" after ${t.value}( in "${this.source}"`);
        return apply(t.value, args, this.source);
      }
      return toDecimal(this.resolve(t.value), t.value);
    }
    throw new ExpressionError(`unexpected "${t.value}" in "${this.source}"`);
  }
}

function apply(fn: string, args: MoneyValue[], source: string): MoneyValue {
  switch (fn) {
    case 'round':
      if (args.length !== 1) throw new ExpressionError(`round takes 1 argument in "${source}"`);
      return args[0]!.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
    case 'abs':
      if (args.length !== 1) throw new ExpressionError(`abs takes 1 argument in "${source}"`);
      return args[0]!.abs();
    case 'min':
      return MoneyDecimal.min(...args);
    default:
      return MoneyDecimal.max(...args);
  }
}

/** Evaluates `source` against `scope`. */
export function evaluate(source: string, scope: Scope): MoneyValue {
  return new Parser(tokenize(source), (path) => readPath(scope, path), source).parse();
}

/** Throws `ExpressionError` when `source` does not parse (paths are not resolved). */
export function assertExpression(source: string): void {
  new Parser(tokenize(source), () => '1', source).parse();
}

/** The payload paths an expression reads (function names excluded); throws `ExpressionError` on bad input. */
export function expressionPaths(source: string): string[] {
  const tokens = tokenize(source);
  return tokens
    .filter((t, i) => t.kind === 'path' && !(FUNCTIONS.has(t.value) && tokens[i + 1]?.value === '('))
    .map((t) => t.value);
}
