// JSON Canonicalization Scheme (JCS), RFC 8785, for values produced by JSON.parse:
// null, booleans, finite numbers, strings, arrays and plain objects.
// Works on Node.js 18+ and has no dependencies.
//
//   3.2.1    no whitespace between tokens
//   3.2.2.1  literals: null, true, false
//   3.2.2.2  strings: ECMAScript JSON string serialization; lone surrogates are errors
//   3.2.2.3  numbers: ECMAScript Number-to-String; NaN and Infinity are errors
//   3.2.3    object members sorted by property name, compared as UTF-16 code units
//   3.2.4    the result is a JavaScript string; encode it as UTF-8 to sign it

// A high surrogate not followed by a low one, or a low surrogate not preceded by a
// high one (String.prototype.isWellFormed is not available before Node.js 20).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function encodeString(s) {
  if (LONE_SURROGATE.test(s)) {
    throw new Error("JCS: string contains a lone surrogate (RFC 8785, section 3.2.2.2)");
  }
  // ECMAScript JSON.stringify emits exactly the escapes RFC 8785 prescribes:
  // \b \t \n \f \r, lowercase \u00hh for other controls, \" and \\, all else as is.
  return JSON.stringify(s);
}

function encodeNumber(n) {
  if (!Number.isFinite(n)) {
    throw new Error(`JCS: ${n} is not a valid JSON number (RFC 8785, section 3.2.2.3)`);
  }
  // Number-to-String of ECMA-262, the serialization RFC 8785 requires (-0 gives "0").
  return JSON.stringify(n);
}

// Comparison by UTF-16 code units; the default Array.prototype.sort order is
// defined the same way, the explicit comparator only documents the intent.
function byCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(o) {
  const proto = Object.getPrototypeOf(o);
  return proto === Object.prototype || proto === null;
}

// Marks text that is copied to the output as is, as opposed to a value to encode.
class Raw {
  constructor(text) {
    this.text = text;
  }
}

/**
 * Canonical JSON text of `value` per RFC 8785.
 * Throws for lone surrogates, non-finite numbers and values JSON cannot represent.
 * Uses an explicit work list instead of recursion, so deep nesting cannot exhaust
 * the call stack.
 */
export function canonicalJson(value) {
  let out = "";
  const work = [value]; // processed from the end: last pushed is next
  while (work.length > 0) {
    const item = work.pop();
    if (item instanceof Raw) {
      out += item.text;
    } else if (item === null) {
      out += "null";
    } else if (item === true || item === false) {
      out += item ? "true" : "false";
    } else if (typeof item === "number") {
      out += encodeNumber(item);
    } else if (typeof item === "string") {
      out += encodeString(item);
    } else if (Array.isArray(item)) {
      // Schedule "[", e0, ",", e1, ..., "]" in reverse so they pop in order.
      work.push(new Raw("]"));
      for (let i = item.length - 1; i >= 0; i--) {
        work.push(item[i]);
        if (i > 0) work.push(new Raw(","));
      }
      out += "[";
    } else if (typeof item === "object" && isPlainObject(item)) {
      const names = Object.keys(item).sort(byCodeUnits);
      work.push(new Raw("}"));
      for (let i = names.length - 1; i >= 0; i--) {
        work.push(item[names[i]]);
        work.push(new Raw(`${encodeString(names[i])}:`));
        if (i > 0) work.push(new Raw(","));
      }
      out += "{";
    } else {
      throw new TypeError(`JCS: ${typeof item} is not a JSON value`);
    }
  }
  return out;
}
