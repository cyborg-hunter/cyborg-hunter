// A hand-walked JSON Schema evaluator, sized to the one schema in this package.
//
// WHY NOT AJV. The package has zero runtime dependencies and this file is what
// lets its own test suite stay that way. It is not a general validator and must
// not be used as one — it interprets exactly the keywords
// `schema/session-recording-v2.schema.json` uses, and it treats an unrecognised
// keyword as a hard error rather than ignoring it, because a silently skipped
// keyword is a schema rule that quietly stops being checked.
//
// THE SUBSET INTERPRETED, in full:
//   applicators   $ref (local "#/$defs/…" pointers only), allOf, anyOf, not,
//                 if/then/else
//   objects       type, required, properties, additionalProperties (schema
//                 form, applied to keys `properties` did not name),
//                 propertyNames (pattern only)
//   arrays        items
//   values        type (string or array of strings), const, enum, pattern
//   annotations   $schema, $id, $comment, title, description, default,
//                 examples — read and ignored, as annotations
//
// NOT interpreted, and therefore not usable in the schema: oneOf, dependent*,
// prefixItems, contains, unevaluated*, numeric bounds, string lengths, format,
// remote $refs, recursive $dynamicRef. Adding a keyword to the schema without
// adding it here fails loudly on the next run.
//
// `type: "integer"` follows JSON Schema: an integral number, so 3.0 is an
// integer. `type: "number"` excludes NaN and Infinity, which JSON cannot encode
// anyway.

const ANNOTATIONS = new Set([
  '$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'deprecated',
]);

const KEYWORDS = new Set([
  '$ref', 'allOf', 'anyOf', 'not', 'if', 'then', 'else',
  'type', 'required', 'properties', 'additionalProperties', 'propertyNames',
  'items', 'const', 'enum', 'pattern',
]);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'object') return 'object';
  return 'unsupported';
}

function matchesType(value, want) {
  const t = typeOf(value);
  if (want === 'integer') return t === 'number' && Number.isInteger(value);
  if (want === 'number') return t === 'number' && Number.isFinite(value);
  return t === want;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (a !== null && typeof a === 'object') {
    const ka = Object.keys(a); const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`json-schema-subset: only local #/ refs are supported, got "${ref}"`);
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    node = node?.[key];
    if (node === undefined) throw new Error(`json-schema-subset: unresolved ref "${ref}"`);
  }
  return node;
}

/**
 * @returns {string[]} the failures found, empty when the instance validates.
 *   Paths are JSON-Pointer-ish (`/segments/0/events/3/type`) so a disagreement
 *   with the validator can be read side by side with its message.
 */
function walk(schema, value, root, path, out) {
  if (schema === true) return out;
  if (schema === false) { out.push(`${path}: schema is false`); return out; }

  for (const k of Object.keys(schema)) {
    if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k) && k !== '$defs') {
      throw new Error(`json-schema-subset: keyword "${k}" at ${path} is not in the interpreted subset`);
    }
  }

  if ('$ref' in schema) walk(resolveRef(root, schema.$ref), value, root, path, out);

  if ('type' in schema) {
    const want = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!want.some((w) => matchesType(value, w))) {
      out.push(`${path}: expected type ${want.join('|')}, got ${typeOf(value)}`);
      // A type mismatch makes every keyword below it meaningless noise.
      return out;
    }
  }

  if ('const' in schema && !deepEqual(value, schema.const)) {
    out.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }
  if ('enum' in schema && !schema.enum.some((c) => deepEqual(value, c))) {
    out.push(`${path}: not one of ${JSON.stringify(schema.enum)}`);
  }
  if ('pattern' in schema && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    out.push(`${path}: does not match /${schema.pattern}/`);
  }

  // Own keys only, below. With `in`, a schema requiring "constructor" would be
  // satisfied by `{}`, and an `additionalProperties` walk would skip a key
  // named `toString` — prototype names leaking into what claims to be a strict
  // reading of the subset. Neither name occurs in this schema; the file still
  // has to be right about it.
  if (typeOf(value) === 'object') {
    if ('required' in schema) {
      for (const k of schema.required) {
        if (!Object.hasOwn(value, k)) out.push(`${path}: missing required "${k}"`);
      }
    }
    if ('propertyNames' in schema) {
      for (const k of Object.keys(value)) walk(schema.propertyNames, k, root, `${path}/${k}[name]`, out);
    }
    const named = schema.properties ?? {};
    for (const [k, sub] of Object.entries(named)) {
      if (Object.hasOwn(value, k)) walk(sub, value[k], root, `${path}/${k}`, out);
    }
    if ('additionalProperties' in schema) {
      for (const k of Object.keys(value)) {
        if (!Object.hasOwn(named, k)) walk(schema.additionalProperties, value[k], root, `${path}/${k}`, out);
      }
    }
  }

  if (typeOf(value) === 'array' && 'items' in schema) {
    value.forEach((v, i) => walk(schema.items, v, root, `${path}/${i}`, out));
  }

  if ('allOf' in schema) schema.allOf.forEach((s, i) => walk(s, value, root, `${path}#allOf[${i}]`, out));

  if ('anyOf' in schema) {
    const branches = schema.anyOf.map((s) => walk(s, value, root, path, []));
    if (!branches.some((b) => b.length === 0)) {
      out.push(`${path}: matched none of ${schema.anyOf.length} anyOf branches ` +
        `(${branches.map((b, i) => `[${i}] ${b[0]}`).join('; ')})`);
    }
  }

  if ('not' in schema && walk(schema.not, value, root, path, []).length === 0) {
    out.push(`${path}: matched a schema it must not`);
  }

  if ('if' in schema) {
    const taken = walk(schema.if, value, root, path, []).length === 0 ? schema.then : schema.else;
    if (taken !== undefined) walk(taken, value, root, `${path}#${taken === schema.then ? 'then' : 'else'}`, out);
  }

  return out;
}

/**
 * Validate `value` against `schema`.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateAgainstSchema(schema, value) {
  const errors = walk(schema, value, schema, '', []);
  return { ok: errors.length === 0, errors };
}
