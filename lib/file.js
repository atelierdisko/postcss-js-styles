const path = require("path");
const fs = require("fs");

export const writeFile = (to, text) =>
  new Promise((resolve, reject) => {
    const dirName = path.dirname(to);
    fs.mkdir(dirName, { recursive: true }, (error) => {
      if (error) {
        reject(error);
      } else {
        fs.writeFile(to, text, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }
    });
  });
