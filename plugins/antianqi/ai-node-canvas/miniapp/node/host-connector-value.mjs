const MAX_JSON_STRING_LAYERS = 4;

/**
 * Decode the raw `HostConnectorCallResult.value` root without changing provider-owned fields.
 *
 * A probe may observe exactly one text-block array as a provider transport shape. Only when that
 * exact shape appears, remove it once and decode JSON-looking strings from its `text`. Every other
 * JSON value passes through unchanged and provider-owned fields are never traversed or rewritten.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function decodeHostConnectorValue(value) {
  if (!isExactSingleTextBlockEnvelope(value)) return value;
  let current = value[0].text;

  for (let layer = 0; typeof current === 'string' && looksLikeEncodedJson(current); layer += 1) {
    if (layer === MAX_JSON_STRING_LAYERS) {
      fail(
        'HOST_CONNECTOR_VALUE_NESTING_EXCEEDED',
        `Host Connector value exceeded ${MAX_JSON_STRING_LAYERS} JSON string layers`,
      );
    }
    try {
      current = JSON.parse(current);
    } catch {
      fail('HOST_CONNECTOR_VALUE_MALFORMED_JSON', 'Host Connector value is not valid JSON');
    }
  }

  return current;
}

function isExactSingleTextBlockEnvelope(value) {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return false;
  const block = value[0];
  return Object.keys(block).length === 2 && block.type === 'text' && typeof block.text === 'string';
}

function looksLikeEncodedJson(value) {
  const first = value.trimStart()[0];
  return first === '"' || first === '{' || first === '[';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
