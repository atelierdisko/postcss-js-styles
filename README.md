# postcss-js-styles

Transform Javascript objects and functions to CSS and make it available to be applied in CSS files.

Files with the extension `.style.js` can use the named export `styles` to generate CSS rules.
CSS Files can use the `@styles` at-rule to apply them.

## Installation

```console
npm install postcss-js-functions
```

## Usage
`./color.style.js`:

```js
const styles = {
  ".blue": {
    color: blue,
  },
  ".red": {
    color: red,
  }
};

export { styles };
```

`./myfile.css`:

```css
@styles "./color.style.js";
```

will give you:

```css
.blue {
  color: blue;
}

.red {
  color: red;
}
```

When `path` is set in the postcss config `.style.js` will be treated as rules that may export CSS custom properties and
custom media queries.

This is especially useful when combined with `postcss-custom-properties` and `postcss-custom-media`.
(and IDE autocompletion)

`postcss.config.js`:

```js
module.exports = {
  plugins: {
    "postcss-js-functions": {
      path: "./styles/definitions",
      exportTo: "./.styles/variables.css",
    }
  }
}
```

`./styles/definitions/varaibles.style.js`:

```js
const styles = {
  ":root": {
    "--color-blue": blue,
  },
};

export { styles };
```

`.styles/variables.css`:

```css
:root {
  --color-blue: blue;
}
```