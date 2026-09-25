const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function tokenClass(match) {
  if (match[1]) return match[2] ? "json-key" : "json-string";
  if (match[3]) return "json-literal";
  return "json-number";
}

/** Wraps JSON tokens in spans as text nodes, never parsing markup. */
export function highlightJson(text) {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    if (match.index > cursor) fragment.append(text.slice(cursor, match.index));
    const token = match[1] ?? match[0];
    const span = document.createElement("span");
    span.className = tokenClass(match);
    span.textContent = token;
    fragment.append(span);
    if (match[2]) fragment.append(match[2]);
    cursor = match.index + match[0].length;
  }
  fragment.append(text.slice(cursor));
  return fragment;
}
