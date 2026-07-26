(function (global) {
  "use strict";

  var MATHJAX_PATH = "vendor/mathjax/tex-svg.js";
  var MATHJAX_FONTS_PATH = "vendor/mathjax/fonts";
  var loadPromise = null;
  var revisions = typeof WeakMap === "function" ? new WeakMap() : null;
  var FORMULA_BREAK_MARKER = "\uE000WSB_FORMULA_BREAK\uE001";
  var MIXED_FORMULA_MIN_LENGTH = 56;
  var MIXED_FORMULA_LINE_LENGTH = 30;

  function trim(value) {
    return String(value || "").replace(/^\s+|\s+$/g, "");
  }

  function normalizeFormulaMarkup(value) {
    return String(value || "").replace(/```(?:latex|tex|math)\s*\r?\n?([\s\S]*?)```/gi, function (_, formula) {
      return "\\[" + trim(formula) + "\\]";
    });
  }

  function hasExplicitFormula(value) {
    value = normalizeFormulaMarkup(value);
    return /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/.test(value) ||
      /(^|[^\\$])\$(?!\$)[^$\n]+?\$(?!\$)/.test(value);
  }

  function legacyFormulaForLine(value) {
    var line = trim(value);
    if (!line || hasExplicitFormula(line) || line.length > 320 || line.indexOf("=") < 0) return null;
    var colonIndex = Math.max(line.indexOf("："), line.indexOf(":"));
    var label = colonIndex >= 0 ? trim(line.slice(0, colonIndex + 1)) : "";
    var expression = trim(colonIndex >= 0 ? line.slice(colonIndex + 1) : line);
    if (expression.charAt(0) === "(" && expression.charAt(expression.length - 1) === ")") {
      expression = trim(expression.slice(1, -1));
    }
    if (!/[A-Za-z]/.test(expression) || !/[+\-*/=×÷^²³√]/.test(expression)) return null;
    expression = expression
      .replace(/[（]/g, "(")
      .replace(/[）]/g, ")")
      .replace(/×/g, "\\times ")
      .replace(/÷/g, "\\div ")
      .replace(/≤/g, "\\le ")
      .replace(/≥/g, "\\ge ")
      .replace(/≠/g, "\\ne ")
      .replace(/([A-Za-z])\s+([23])(?=\s*(?:[+\-*/=)]|$))/g, "$1^{$2}")
      .replace(/([A-Za-z])²/g, "$1^{2}")
      .replace(/([A-Za-z])³/g, "$1^{3}")
      .replace(/\b(sin|cos|tan|cot|log|ln)\s+/g, "\\$1 ");
    return { label: label, tex: expression };
  }

  function isCjk(value) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(value);
  }

  function splitTextCommandContent(value) {
    var parts = [];
    var current = "";
    var depth = 0;
    var visibleLength = 0;

    function pushCurrent() {
      var part = trim(current);
      if (part) parts.push(part);
      current = "";
      visibleLength = 0;
    }

    for (var index = 0; index < value.length; index += 1) {
      var character = value.charAt(index);
      if (character === "\\") {
        current += character;
        var next = value.charAt(index + 1);
        if (/[A-Za-z]/.test(next)) {
          while (index + 1 < value.length && /[A-Za-z]/.test(value.charAt(index + 1))) {
            index += 1;
            current += value.charAt(index);
          }
        } else if (next) {
          index += 1;
          current += next;
          visibleLength += 1;
        }
        continue;
      }
      if (character === "{") depth += 1;
      else if (character === "}" && depth > 0) depth -= 1;
      current += character;
      if (depth === 0 && character !== "{" && character !== "}") visibleLength += 1;

      var punctuationBreak = depth === 0 && /[，。；！？,;]/.test(character);
      var lengthBreak = depth === 0 && visibleLength >= MIXED_FORMULA_LINE_LENGTH &&
        (isCjk(character) || /\s/.test(character));
      if (punctuationBreak || lengthBreak) pushCurrent();
    }
    pushCurrent();
    return parts;
  }

  function isTopLevelFormulaPosition(value, position) {
    var braceDepth = 0;
    var parenthesisDepth = 0;
    for (var index = 0; index < position; index += 1) {
      var character = value.charAt(index);
      if (character === "\\") {
        var next = value.charAt(index + 1);
        if (/[A-Za-z]/.test(next)) {
          while (index + 1 < position && /[A-Za-z]/.test(value.charAt(index + 1))) index += 1;
        } else if (next) {
          index += 1;
        }
        continue;
      }
      if (character === "{") braceDepth += 1;
      else if (character === "}" && braceDepth > 0) braceDepth -= 1;
      else if (braceDepth === 0 && /[（(【\[]/.test(character)) parenthesisDepth += 1;
      else if (braceDepth === 0 && /[）)】\]]/.test(character) && parenthesisDepth > 0) parenthesisDepth -= 1;
    }
    return braceDepth === 0 && parenthesisDepth === 0;
  }

  function splitTextCommands(value) {
    var output = "";
    var cursor = 0;
    while (cursor < value.length) {
      var commandIndex = value.indexOf("\\text{", cursor);
      if (commandIndex < 0) {
        output += value.slice(cursor);
        break;
      }
      output += value.slice(cursor, commandIndex);
      var contentStart = commandIndex + 6;
      var depth = 1;
      var closingIndex = contentStart;
      for (; closingIndex < value.length; closingIndex += 1) {
        var character = value.charAt(closingIndex);
        if (character === "\\") {
          closingIndex += 1;
          continue;
        }
        if (character === "{") depth += 1;
        else if (character === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) {
        output += value.slice(commandIndex);
        break;
      }
      var content = value.slice(contentStart, closingIndex);
      var contentParts = splitTextCommandContent(content);
      if (contentParts.length > 1 && isTopLevelFormulaPosition(value, commandIndex)) {
        output += contentParts.map(function (part) {
          return "\\text{" + part + "}";
        }).join(FORMULA_BREAK_MARKER);
      } else {
        output += value.slice(commandIndex, closingIndex + 1);
      }
      cursor = closingIndex + 1;
    }
    return output;
  }

  function splitTopLevelMixedFormula(value) {
    var parts = [];
    var current = "";
    var braceDepth = 0;
    var parenthesisDepth = 0;
    var visibleLength = 0;

    function pushCurrent() {
      var part = trim(current);
      if (part) parts.push(part);
      current = "";
      visibleLength = 0;
    }

    for (var index = 0; index < value.length; index += 1) {
      var character = value.charAt(index);
      if (character === "\\") {
        current += character;
        var next = value.charAt(index + 1);
        if (/[A-Za-z]/.test(next)) {
          while (index + 1 < value.length && /[A-Za-z]/.test(value.charAt(index + 1))) {
            index += 1;
            current += value.charAt(index);
          }
        } else if (next) {
          index += 1;
          current += next;
          visibleLength += 1;
        }
        continue;
      }
      if (character === "{") braceDepth += 1;
      else if (character === "}" && braceDepth > 0) braceDepth -= 1;
      else if (braceDepth === 0 && /[（(【\[]/.test(character)) parenthesisDepth += 1;
      else if (braceDepth === 0 && /[）)】\]]/.test(character) && parenthesisDepth > 0) parenthesisDepth -= 1;
      current += character;
      if (braceDepth === 0 && character !== "{" && character !== "}") visibleLength += 1;

      var canBreak = braceDepth === 0 && parenthesisDepth === 0;
      var punctuationBreak = canBreak && /[，。；！？,;]/.test(character);
      var lengthBreak = canBreak && visibleLength >= MIXED_FORMULA_LINE_LENGTH &&
        (isCjk(character) || /\s/.test(character));
      if (punctuationBreak || lengthBreak) pushCurrent();
    }
    pushCurrent();
    return parts;
  }

  function splitLongMixedFormula(value) {
    var source = trim(value);
    var cjkCharacters = source.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || [];
    if (source.length < MIXED_FORMULA_MIN_LENGTH || cjkCharacters.length < 6) return [source];
    if (/\\begin\s*\{/.test(source)) return [source];

    var marked = splitTextCommands(source);
    var parts = [];
    marked.split(FORMULA_BREAK_MARKER).forEach(function (section) {
      parts = parts.concat(splitTopLevelMixedFormula(section));
    });
    parts = parts.map(trim).filter(Boolean);
    if (parts.length < 2) return [source];
    if (parts.length > 8) {
      parts = parts.slice(0, 7).concat(parts.slice(7).join(" "));
    }
    return parts;
  }

  function extensionUrl(path) {
    if (global.chrome && global.chrome.runtime && typeof global.chrome.runtime.getURL === "function") {
      return global.chrome.runtime.getURL(path);
    }
    return "../" + path;
  }

  function scriptUrl() {
    return extensionUrl(MATHJAX_PATH);
  }

  function configureMathJax() {
    if (global.MathJax && typeof global.MathJax.typesetPromise === "function") return;
    global.MathJax = {
      loader: {
        paths: {
          fonts: extensionUrl(MATHJAX_FONTS_PATH)
        },
        load: ["[tex]/mhchem", "[tex]/physics"]
      },
      startup: { typeset: false },
      tex: {
        inlineMath: [["\\(", "\\)"], ["$", "$"]],
        displayMath: [["\\[", "\\]"], ["$$", "$$"]],
        processEscapes: true,
        packages: { "[+]": ["mhchem", "physics"] }
      },
      svg: {
        fontCache: "local",
        scale: 1,
        displayOverflow: "linebreak",
        linebreaks: {
          inline: true,
          width: "100%",
          lineleading: 0.28
        }
      },
      options: {
        enableMenu: false,
        enableEnrichment: false,
        enableSpeech: false,
        enableBraille: false,
        enableExplorer: false,
        menuOptions: {
          settings: {
            enrich: false,
            collapsible: false,
            speech: false,
            braille: false,
            assistiveMml: false
          }
        }
      }
    };
  }

  function ensureMathJax(documentRef) {
    if (global.MathJax && typeof global.MathJax.typesetPromise === "function") {
      return Promise.resolve();
    }
    if (loadPromise) return loadPromise;
    configureMathJax();
    loadPromise = new Promise(function (resolve, reject) {
      var script = documentRef.createElement("script");
      script.src = scriptUrl();
      script.async = true;
      script.addEventListener("load", function () {
        var startup = global.MathJax && global.MathJax.startup && global.MathJax.startup.promise;
        Promise.resolve(startup).then(function () {
          if (!global.MathJax || typeof global.MathJax.typesetPromise !== "function") {
            reject(new Error("公式组件初始化失败。"));
            return;
          }
          resolve();
        }, reject);
      });
      script.addEventListener("error", function () {
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error("公式组件加载失败。"));
      });
      (documentRef.head || documentRef.documentElement).appendChild(script);
    }).catch(function (error) {
      loadPromise = null;
      throw error;
    });
    return loadPromise;
  }

  function appendInlineMarkdown(documentRef, parent, value) {
    var text = String(value || "");
    var boldPattern = /\*\*([^*\n]+)\*\*/g;
    var cursor = 0;
    var match;
    while ((match = boldPattern.exec(text))) {
      if (match.index > cursor) parent.appendChild(documentRef.createTextNode(text.slice(cursor, match.index)));
      var strong = documentRef.createElement("strong");
      strong.textContent = match[1];
      parent.appendChild(strong);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) parent.appendChild(documentRef.createTextNode(text.slice(cursor)));
  }

  function appendFormulaSource(documentRef, fragment, source) {
    var parts = splitLongMixedFormula(source);
    if (parts.length === 1) {
      var formula = documentRef.createElement("div");
      formula.className = "ai-teaching-formula-source";
      formula.setAttribute("data-formula-source", trim(source));
      formula.textContent = "\\[" + trim(source) + "\\]";
      fragment.appendChild(formula);
      return;
    }

    var group = documentRef.createElement("div");
    group.className = "ai-teaching-formula-source ai-teaching-formula-group";
    group.setAttribute("data-formula-source", trim(source));
    group.setAttribute("data-formula-wrapped", "true");
    parts.forEach(function (part) {
      var row = documentRef.createElement("div");
      row.className = "ai-teaching-formula-row";
      row.setAttribute("data-formula-source", part);
      row.textContent = "\\[" + part + "\\]";
      group.appendChild(row);
    });
    fragment.appendChild(group);
  }

  function appendTextLines(documentRef, fragment, value) {
    String(value || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (line, index, lines) {
      if (!line && (index === 0 || index === lines.length - 1)) return;
      var legacyFormula = legacyFormulaForLine(line);
      if (legacyFormula) {
        if (legacyFormula.label) {
          var label = documentRef.createElement("div");
          label.className = "ai-teaching-line ai-teaching-formula-label";
          appendInlineMarkdown(documentRef, label, legacyFormula.label);
          fragment.appendChild(label);
        }
        appendFormulaSource(documentRef, fragment, legacyFormula.tex);
        return;
      }
      var row = documentRef.createElement("div");
      row.className = line ? "ai-teaching-line" : "ai-teaching-line ai-teaching-line-empty";
      appendInlineMarkdown(documentRef, row, line || "\u00a0");
      fragment.appendChild(row);
    });
  }

  function buildContent(container, value) {
    var documentRef = container.ownerDocument || global.document;
    var fragment = documentRef.createDocumentFragment();
    var text = normalizeFormulaMarkup(value);
    var displayPattern = /(\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$)/g;
    var cursor = 0;
    var match;
    while ((match = displayPattern.exec(text))) {
      appendTextLines(documentRef, fragment, text.slice(cursor, match.index));
      var source = match[0].slice(0, 2) === "\\[" ? match[0].slice(2, -2) : match[0].slice(2, -2);
      appendFormulaSource(documentRef, fragment, source);
      cursor = match.index + match[0].length;
    }
    appendTextLines(documentRef, fragment, text.slice(cursor));
    if (typeof container.replaceChildren === "function") container.replaceChildren(fragment);
    else {
      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(fragment);
    }
  }

  function markFormulaImages(container) {
    if (!container || typeof container.querySelectorAll !== "function") return;
    Array.prototype.forEach.call(container.querySelectorAll("mjx-container"), function (math) {
      var svg = math.querySelector("svg");
      var sourceContainer = typeof math.closest === "function" ? math.closest("[data-formula-source]") : null;
      var source = sourceContainer && sourceContainer.getAttribute("data-formula-source") ||
        math.getAttribute("aria-label") || trim(math.textContent);
      math.classList.add("ai-teaching-formula");
      math.setAttribute("role", "img");
      math.setAttribute("aria-label", source ? "公式：" + source : "数学公式");
      if (svg) {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", source ? "公式：" + source : "数学公式");
        svg.setAttribute("focusable", "false");
      }
    });
  }

  function render(container, value) {
    if (!container) return Promise.resolve({ ok: false, error: "缺少公式显示区域。" });
    var documentRef = container.ownerDocument || global.document;
    if (!documentRef || typeof documentRef.createElement !== "function") {
      container.textContent = String(value || "");
      return Promise.resolve({ ok: true, formulas: false, fallback: true });
    }
    var revision = revisions ? Number(revisions.get(container) || 0) + 1 : Number(container.__wsbMathRevision || 0) + 1;
    if (revisions) revisions.set(container, revision);
    else container.__wsbMathRevision = revision;
    if (global.MathJax && typeof global.MathJax.typesetClear === "function") {
      try {
        global.MathJax.typesetClear([container]);
      } catch (error) {
        // 保留新的安全文本节点，旧公式缓存清理失败不影响显示。
      }
    }
    container.classList.remove("ai-teaching-has-formula", "ai-teaching-formula-fallback");
    var normalizedValue = normalizeFormulaMarkup(value);
    buildContent(container, normalizedValue);
    var needsMathJax = hasExplicitFormula(normalizedValue) || !!normalizedValue.split(/\r?\n/).some(legacyFormulaForLine);
    if (!needsMathJax) return Promise.resolve({ ok: true, formulas: false });
    container.classList.add("ai-teaching-has-formula");
    return ensureMathJax(documentRef).then(function () {
      var mathJax = global.MathJax;
      var currentRevision = revisions ? revisions.get(container) : container.__wsbMathRevision;
      if (currentRevision !== revision) return { ok: false, discarded: true };
      return mathJax.typesetPromise([container]).then(function () {
        var latestRevision = revisions ? revisions.get(container) : container.__wsbMathRevision;
        if (latestRevision !== revision) return { ok: false, discarded: true };
        markFormulaImages(container);
        return { ok: true, formulas: true };
      });
    }).catch(function (error) {
      container.classList.add("ai-teaching-formula-fallback");
      return { ok: false, error: error && error.message || String(error) };
    });
  }

  global.WSBMathRenderer = Object.freeze({
    render: render,
    hasExplicitFormula: hasExplicitFormula,
    normalizeFormulaMarkup: normalizeFormulaMarkup,
    legacyFormulaForLine: legacyFormulaForLine,
    splitLongMixedFormula: splitLongMixedFormula
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
