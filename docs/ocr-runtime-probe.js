(function () {
  "use strict";

  var result = document.getElementById("result");
  var canvas = document.getElementById("source");
  var context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#171717";
  context.font = "bold 42px Arial";
  context.fillText("Select the correct answer", 50, 70);
  context.fillStyle = "#b8b8b8";
  context.font = "36px Arial";
  ["A. Mercury", "B. Venus", "C. Earth", "D. Mars"].forEach(function (line, index) {
    context.fillText(line, 70, 155 + index * 82);
  });

  window.winSpeedBallOcr.recognize(canvas.toDataURL("image/png")).then(function (recognized) {
    var text = String(recognized || "").trim();
    var hasAllOptions = ["A", "B", "C", "D"].every(function (label) {
      return new RegExp("(^|\\n)\\s*" + label + "\\s*[.]?\\s+", "i").test(text);
    });
    result.textContent = hasAllOptions ? "PASS: " + text : "FAIL: " + text;
  }).catch(function (error) {
    result.textContent = "ERROR: " + (error && error.message || String(error));
  });
})();
