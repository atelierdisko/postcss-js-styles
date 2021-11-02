const path = require("path");
const { writeFile } = require("./file");

const jsDocPropertiesKey = "doc";

export function composeJsDoc(name, obj) {
  function template(kind, type, name, doc) {
    return `* @${kind} {${type}} ${name}${doc ? " " + doc : ""}\n`;
  }

  function stringify(key, value) {
    if (!key.startsWith(".")) {
      return "";
    }
    let doc;
    if (jsDocPropertiesKey in value) {
      doc = value.doc;
    }
    return template("property", "String", key.substr(1), doc);
  }

  if (typeof obj !== "object") {
    return "";
  }

  const props = Object.entries(obj).reduce(
    (acc, [key, value]) => acc + stringify(key, value),
    ""
  );

  return `/**\n${[
    template("typedef", "Object", name),
    props,
    template("property", "function", "get"),
  ].join("")}*/`;
}

export function clearJsDocProperties(style) {
  for (const [ruleKey, rule] of Object.entries(style)) {
    for (let key in rule) {
      if (key === jsDocPropertiesKey) {
        delete style[ruleKey][key];
      }
    }
  }
}

export async function processTypes(loadFromDir, modules = { global: {} }) {
  const cwd = process.cwd();
  const typedefPath = path.join(
    cwd,
    path.relative(cwd, loadFromDir),
    "types",
    "typedefs.js"
  );
  const typedef = Object.values(modules.global)
    .map(({ doc }) => doc)
    .join("\n\n");
  await writeFile(typedefPath, typedef);
}
