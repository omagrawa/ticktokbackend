var buffer = require("node:buffer");

if (typeof global.File === "undefined") {
  global.File = buffer.File;
}