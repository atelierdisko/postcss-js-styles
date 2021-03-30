const { join, basename, extname, relative } = require("path");
const { parse } = require("postcss-js");
const globby = require("globby");
const rollup = require("rollup");
const crypto = require("crypto");

const pluginName = "postcss-js-functions";

function requireFromString(src, filename) {
  const mdl = new module.constructor();
  mdl.paths = module.paths;
  mdl._compile(src, filename);
  return mdl.exports?.styles;
}

async function requireModule(inputFile) {
  let fn = () => {};
  let dependencies = [];
  const outputFile =
    "./.cache/" +
    crypto.createHash("md5").update(inputFile).digest("hex").substr(0, 8) +
    ".js";

  const inputOptions = {
    input: inputFile,
  };
  const outputOptions = { file: outputFile, format: "cjs", exports: "auto" };

  async function build() {
    const bundle = await rollup.rollup(inputOptions);
    dependencies = bundle.watchFiles;
    const { output } = await bundle.generate(outputOptions);
    for (const chunkOrAsset of output) {
      if (chunkOrAsset.type !== "asset") {
        fn = requireFromString(chunkOrAsset.code, inputFile);
      }
    }
    await bundle.close();
  }
  await build();
  return { fn, dependencies };
}

async function loadGlobalMixin(helpers, loadFrom) {
  let cwd = process.cwd();
  let files = await globby(loadFrom);
  let modules = {};
  await Promise.all(
    files.map(async (file) => {
      let ext = extname(file).toLowerCase();
      let name = basename(file, extname(file));
      let path = join(cwd, relative(cwd, file));
      if (ext === ".js") {
        const { fn, dependencies } = await requireModule(path);
        modules[name] = { mixin: fn, dependencies, file: path };
      }
    })
  );
  return modules;
}

function addGlobalMixins(helpers, local, modules, globalParent) {
  for (let name in modules) {
    const { file: mdlFile, dependencies } = modules[name];
    const [prevMessage] = helpers.result.messages.slice(-1);
    const { file: prevParent } = prevMessage ?? {};
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
    local[name] = modules[name];
  }
}

function processMixinContent(rule, from) {
  rule.walkAtRules("mixin-content", (content) => {
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
  processMixinContent(root, rule);
  rule.parent.insertBefore(rule, root);
}

function insertMixin(helpers, mixins, rule, opts) {
  let name = rule.params.split(/\s/, 1)[0];
  let rest = rule.params.slice(name.length).trim();

  let params;
  if (rest.trim() === "") {
    params = [];
  } else {
    params = helpers.list.comma(rest);
  }

  let meta = mixins[name];
  let mixin = meta && meta.mixin;

  if (!meta) {
    if (!opts.silent) {
      throw rule.error("Undefined mixin " + name);
    }
  } else if (mixin.name === "define-mixin") {
    let i;
    let values = {};
    for (i = 0; i < meta.args.length; i++) {
      values[meta.args[i][0]] = params[i] || meta.args[i][1];
    }

    let proxy = new helpers.Root();
    for (i = 0; i < mixin.nodes.length; i++) {
      let node = mixin.nodes[i].clone();
      delete node.raws.before;
      proxy.append(node);
    }

    if (meta.content) {
      processMixinContent(proxy, rule);
    }

    rule.parent.insertBefore(rule, proxy);
  } else if (typeof mixin === "object") {
    insertObject(rule, mixin);
  } else if (typeof mixin === "function") {
    let args = [rule].concat(params);
    rule.walkAtRules((atRule) => {
      insertMixin(helpers, mixins, atRule, opts);
    });
    let nodes = mixin(...args);
    if (typeof nodes === "object") {
      insertObject(rule, nodes);
    }
  } else {
    throw new Error("Wrong " + name + " mixin type " + typeof mixin);
  }

  if (rule.parent) rule.remove();
}

module.exports = (opts = {}) => {
  let loadFrom = [];
  if (opts.mixinsDir) {
    if (!Array.isArray(opts.mixinsDir)) {
      opts.mixinsDir = [opts.mixinsDir];
    }
    loadFrom = opts.mixinsDir.map((dir) =>
      join(dir, "*.{js,json}").replace(/\\/g, "/")
    );
  }
  if (opts.mixinsFiles) {
    loadFrom = loadFrom.concat(opts.mixinsFiles);
  }

  return {
    postcssPlugin: pluginName,
    prepare() {
      let mixins = {};
      return {
        Once(root, helpers) {
          if (loadFrom.length > 0) {
            return loadGlobalMixin(helpers, loadFrom).then((modules) => {
              addGlobalMixins(helpers, mixins, modules, opts.parent);
            });
          }
        },
        AtRule: {
          mixin: (node, helpers) => {
            insertMixin(helpers, mixins, node, opts);
          },
        },
      };
    },
  };
};
module.exports.postcss = true;
