const path = require("path");
let fsPromises = require("fs/promises");
const { parse } = require("postcss-js");
const globby = require("globby");
const esbulid = require("esbuild");
const resolveFrom = require("resolve-from");
const {
  composeJsDoc,
  clearJsDocProperties,
  processTypes,
} = require("./lib/jsDoc");
const { exportStyleVariables } = require("./lib/exportCSSVariables");

const pluginName = "postcss-js-functions";
const exportsName = "styles";
const atRule = "styles";
const filePattern = "*.{style.js,style.json}";

// Create module from String and require the export
// by the name of `exportsName` i.e. "styles"
function requireFromString(src, filename) {
  const mdl = new module.constructor();
  mdl.paths = module.paths;
  mdl._compile(src, filename);
  return mdl.exports?.[exportsName];
}

async function requireModule(name, inputFile) {
  const cwd = process.cwd();
  const fileContent = await fsPromises.readFile(inputFile, "utf8");
  let result = esbulid.buildSync({
    stdin: {
      contents: fileContent,
      loader: "js",
      resolveDir: path.dirname(inputFile),
    },
    format: "cjs",
    target: ["node12"],
    bundle: true,
    write: false,
    metafile: true,
    absWorkingDir: cwd,
    outdir: ".cache",
  });

  const [out] = result.outputFiles;
  const code = out.text;

  const style = requireFromString(code, inputFile) ?? {};

  const doc = composeJsDoc(name, style);

  clearJsDocProperties(style);

  const dependencies = Object.keys(result.metafile.inputs)
    .filter((dep) => !dep.startsWith("<"))
    .map((dep) => path.join(cwd, dep));

  return { style, dependencies, doc };
}

async function loadStylesFromModule(modules, pattern, moduleType) {
  const cwd = process.cwd();
  let files = await globby(pattern);
  await Promise.all(
    files.map(async (file) => {
      let ext = path.extname(file).toLowerCase();
      let name = path.basename(file).replace(/\..*?$/, "");
      let filePath = path.join(cwd, path.relative(cwd, file));
      if (ext === ".js") {
        const { style, dependencies, doc } = await requireModule(
          name,
          filePath
        );
        if (moduleType === "global") {
          modules.global[name] = { style, dependencies, file: filePath, doc };
        } else {
          modules.local[filePath] = {
            style,
            dependencies,
            file: filePath,
            doc,
          };
        }
      }
    })
  );
}

async function loadLocalStyles(modules) {
  const cwd = process.cwd();
  let pattern = path.join(cwd, "**", filePattern);
  await loadStylesFromModule(modules, pattern, "local");
}

async function loadGlobalStyles(modules, loadFrom) {
  for (let loadFromDir of loadFrom) {
    let pattern = path.join(loadFromDir, filePattern).replace(/\\/g, "/");
    await loadStylesFromModule(modules, pattern, "global");
    await processTypes(loadFromDir, modules);
  }
}

async function loadStyles(helpers, loadFrom) {
  const modules = { global: {}, local: {} };

  await loadGlobalStyles(modules, loadFrom);
  await loadLocalStyles(modules);

  return modules;
}

function addStyles(helpers, styles, modules, globalParent) {
  // Assign modules to styles object by type ("global" | "local")
  function addStylesByType(key) {
    const currentModules = modules[key];
    for (let name in currentModules) {
      const { file: mdlFile, dependencies } = currentModules[name];
      const [prevMessage] = helpers.result.messages.slice(-1);
      const { file: prevParent } = prevMessage ?? {};
      // Add file and its dependencies to postcss dependency graph
      helpers.result.messages.push({
        type: "dependency",
        plugin: pluginName,
        file: mdlFile,
        parent: prevParent ?? globalParent ?? "",
      });
      dependencies.forEach((depFile) => {
        if (!helpers.result.messages?.some(({ file }) => file === depFile)) {
          helpers.result.messages.push({
            type: "dependency",
            plugin: pluginName,
            file: depFile,
            parent: mdlFile,
          });
        }
      });
      styles[key][name] = currentModules[name];
    }
  }

  addStylesByType("local");
  addStylesByType("global");
}

function processStylesContent(rule, from) {
  rule.walkAtRules("styles-content", (content) => {
    if (from.nodes && from.nodes.length > 0) {
      content.replaceWith(from.clone().nodes);
    } else {
      content.remove();
    }
  });
}

function insertObject(rule, obj) {
  let root = parse(obj);
  root.each((node) => {
    node.source = rule.source;
  });
  processStylesContent(root, rule);
  rule.parent.insertBefore(rule, root);
}

function trimAny(str, chars) {
  let start = 0,
    end = str.length;
  while (start < end && chars.indexOf(str[start]) >= 0) {
    ++start;
  }
  while (end > start && chars.indexOf(str[end - 1]) >= 0) {
    --end;
  }
  return start > 0 || end < str.length ? str.substring(start, end) : str;
}

function insertStyles(helpers, styles, rule, opts) {
  let name = trimAny(rule.params.split(/\s/, 1)[0], "\"'");
  let rest = rule.params.slice(name.length).trim();

  let params;
  if (rest.trim() === "") {
    params = [];
  } else {
    params = helpers.list.comma(rest);
  }

  // Try to assign from global styles
  let meta = styles.global[name];

  if (!meta) {
    // Try to assign from local styles by path
    const localName = resolveFrom(path.dirname(rule.source.input.file), name);
    meta = styles.local[localName];
  }

  let style = meta && meta.style;

  if (!meta) {
    if (!opts.silent) {
      throw rule.error(`Undefined style ${name}`);
    }
  } else if (typeof style === "object") {
    insertObject(rule, style);
  } else if (typeof style === "function") {
    let args = [rule].concat(params);
    rule.walkAtRules((atRule) => {
      insertStyles(helpers, styles, atRule, opts);
    });
    let nodes = style(...args);
    if (typeof nodes === "object") {
      insertObject(rule, nodes);
    }
  } else {
    throw new Error(`Wrong ${name} style type ${typeof style}`);
  }
  if (rule.parent) rule.remove();
}

module.exports = (opts = { path: null, exportTo: null }) => {
  let loadFrom = [];
  const path = Array.isArray(opts.path) ? opts.path : [opts.path];
  if (opts.path) {
    loadFrom = path;
  }

  return {
    postcssPlugin: pluginName,
    prepare() {
      let styles = { global: {}, local: {} };
      return {
        Once(root, helpers) {
          if (loadFrom.length > 0) {
            return loadStyles(helpers, loadFrom).then((modules) => {
              addStyles(helpers, styles, modules, opts.parent);
            });
          }
        },
        OnceExit() {
          if (opts.exportTo) {
            exportStyleVariables(styles, opts.exportTo).then(() => {});
          }
        },
        AtRule: {
          [atRule]: (node, helpers) => {
            insertStyles(helpers, styles, node, opts);
          },
        },
      };
    },
  };
};
module.exports.postcss = true;
