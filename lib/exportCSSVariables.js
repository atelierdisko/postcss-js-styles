import path from "path";
import { writeFile } from "./file";

export async function exportStyleVariables(styles, exportTo) {
  const { global: globalStyles } = styles;

  function toCustomMedia(value) {
    return value + ";";
  }

  function toCustomProperties(obj) {
    return Object.entries(obj).map(
      ([key, value]) => "\t" + key + ": " + value + ";"
    );
  }

  function extract(obj) {
    return obj.reduce(
      (outer, { style }) =>
        Object.entries(style).reduce((acc, [key, value]) => {
          const { customMedia, customProperties } = acc;
          if (key.startsWith("@custom-media")) {
            acc.customMedia = [...customMedia, toCustomMedia(key)];
          }
          if (key === ":root") {
            acc.customProperties = [
              ...customProperties,
              ...toCustomProperties(value),
            ];
          }
          return acc;
        }, outer),
      { customMedia: [], customProperties: [] }
    );
  }

  function stringify({ customMedia, customProperties }) {
    return [
      customMedia.join("\n"),
      ":root{\n" + customProperties.join("\n") + "\n}",
    ].join("\n\n");
  }

  const content = stringify(extract(Object.values(globalStyles)));
  const cwd = process.cwd();
  const filePath = path.join(cwd, path.relative(cwd, exportTo));
  await writeFile(filePath, content);
}
