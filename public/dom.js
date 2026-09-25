/**
 * Builds DOM nodes without innerHTML, so text typed into the builder or
 * returned by the model is never interpreted as markup.
 */
export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    if (name === "class") element.className = value;
    else if (name === "style") for (const [property, styleValue] of Object.entries(value)) element.style.setProperty(property, styleValue);
    else if (name === "dataset") Object.assign(element.dataset, value);
    else if (name.startsWith("on")) element.addEventListener(name.slice(2).toLowerCase(), value);
    else if (value === true) element.setAttribute(name, "");
    else element.setAttribute(name, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

export function svg(tag, attributes = {}, ...children) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  for (const child of children.flat()) if (child) element.append(child);
  return element;
}
