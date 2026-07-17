(function (global) {
  "use strict";

  var punctuation = "，。！？；：、,.!?;:'\"“”‘’（）()[]【】《》<>—…%+-*/=";
  var hanOrEnglishOrDigit = /[A-Za-z0-9\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
  var toSimplified = global.OpenCC && typeof global.OpenCC.Converter === "function"
    ? global.OpenCC.Converter({ from: "twp", to: "cn" })
    : function (value) { return value; };

  function normalize(input, options) {
    options = options || {};
    var normalized = String(input || "").normalize("NFKC");
    var simplified = toSimplified(normalized);
    var output = Array.from(simplified).map(function (character) {
      if (hanOrEnglishOrDigit.test(character)) return character;
      if (/\s/.test(character) || punctuation.indexOf(character) >= 0) return character;
      return " ";
    }).join("");
    output = output.replace(/\r\n?/g, "\n");
    if (options.singleLine === true) output = output.replace(/\s+/g, " ");
    else output = output
      .replace(/[^\S\n]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n");
    var punctuationSpacing = options.singleLine === true
      ? /\s+([，。！？；：、,.!?;:])/g
      : /[^\S\n]+([，。！？；：、,.!?;:])/g;
    return output
      .replace(punctuationSpacing, "$1")
      .trim();
  }

  function filter(input) {
    return normalize(input, { singleLine: true });
  }

  global.WinSpeedBallTextNormalizer = Object.freeze({ normalize: normalize });
  global.WinSpeedBallVoiceTextFilter = Object.freeze({ filter: filter });
})(self);
