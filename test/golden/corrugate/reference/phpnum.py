# PHP 7 numerics (ext/standard/math.c `_php_math_round`, `number_format`), transcribed from the C source for
# the corrugate references. Python floats are IEEE doubles like PHP's.
import math

def _pow10(p):
    return float(10 ** p) if 0 <= p <= 22 else math.pow(10, p)

def _half_up(v):
    return math.floor(v + 0.5) if v >= 0 else math.ceil(v - 0.5)

def php_round(value, places=0):
    if not math.isfinite(value) or value == 0:
        return value
    precision_places = 14 - math.floor(math.log10(abs(value)))
    f1 = _pow10(abs(places))
    if precision_places > places and precision_places - 15 < places:
        f2 = _pow10(abs(precision_places))
        tmp = value * f2 if precision_places >= 0 else value / f2
        tmp = _half_up(tmp)
        use_precision = places - precision_places
        use_precision = max(-(4 * 8), use_precision)  # as PHP
        tmp = tmp / _pow10(abs(use_precision)) if use_precision < 0 else tmp * _pow10(use_precision)
    else:
        tmp = value * f1 if places >= 0 else value / f1
        if abs(tmp) >= 1e15:
            return value
    tmp = _half_up(tmp)
    return tmp / f1 if places > 0 else tmp * f1

def number_format_plain(value, decimals):
    """number_format($v, $d, '.', '') as a float (the round trip legacy feeds back into ceil())."""
    return float(f"{php_round(value, decimals):.{decimals}f}")
