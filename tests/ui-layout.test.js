const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("主界面保持固定尺寸并使用无横向溢出的紧凑布局", () => {
  const html = read("popup/index.html");
  assert.match(html, /--popup-width:320px/);
  assert.match(html, /--popup-height:340px/);
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(html, /body\.chrome-hidden \.right-side\{[^}]*transform:translateX\(0\)/);
  assert.match(html, /body\.chrome-hidden \.header,body\.chrome-hidden \.side\{pointer-events:none\}/);
  assert.match(html, /--c-bg:var\(--c-white\)/);
  assert.match(html, /--c-panel:var\(--c-white\)/);
  assert.match(html, /--c-card:var\(--c-white\)/);
  assert.match(html, /--c-accent:var\(--c-light-blue\)/);
  assert.match(html, /\.status-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html, /#videoStatus\.status-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:3px\}/);
  assert.match(html, /#videoStatus \.status-item\{height:30px;min-height:30px;padding:3px 4px/);
  assert.match(html, /details\.fold\{[^}]*background:var\(--c-panel\)/);
  assert.match(html, /textarea\{min-height:70px;resize:none\}/);
  assert.match(html, /\.consent-gate\{[^}]*width:var\(--popup-width\);height:var\(--popup-height\)/);
  assert.match(html, /aria-label="功能导航"/);
  assert.match(html, /aria-label="系统导航"/);
  assert.match(html, /\.side-btn\[data-panel="ocrPanel"\],\.side-btn\[data-panel="aiPanel"\]\{padding-left:2px;padding-right:2px;font-size:10px;text-overflow:clip\}/);
  assert.match(html, /id="ocrNavBtn" data-panel="ocrPanel">问题获取<\/button>/);
  assert.match(html, /data-panel="aiPanel">AI答题<\/button>/);
  assert.doesNotMatch(html, /data-panel="aiTeachingPanel"/);
});

test("视频页面隐藏滚动条但保留滚动能力", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  assert.match(html, /body\.video-panel-active \.content\{[^}]*overflow-y:auto[^}]*touch-action:pan-y[^}]*scrollbar-width:none/);
  assert.match(html, /body\.video-panel-active \.content::-webkit-scrollbar\{display:none;width:0;height:0\}/);
  assert.match(popup, /document\.body\.classList\.toggle\("video-panel-active", panelId === "videoPanel"\)/);
});

test("问题获取使用文字问题和语音问题两个标签", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  assert.match(html, /<details class="fold ocr-workflow-fold" open><summary>OCR 识别<\/summary>/);
  assert.match(html, /class="view-tabs ocr-view-tabs" role="tablist" aria-label="OCR 功能"/);
  assert.match(html, /data-ocr-view="capture">文字问题<\/button>\s*<button[^>]*data-ocr-view="voice">语音问题<\/button>/);
  assert.doesNotMatch(html, /data-ocr-view="result"|id="ocrResultTab"|id="ocrResultView"/);
  assert.match(html, /\.view-tabs\{display:grid;height:27px;min-height:27px;grid-template-columns:1fr 1fr;gap:4px\}/);
  assert.match(html, /#ocrPanel \.ocr-view-tabs\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html, /\.view-tab\.active\{background:var\(--c-accent-bg\);border-color:var\(--c-light-blue\)/);
  assert.match(html, /id="ocrCaptureView"[^>]*>[\s\S]*?id="regionCaptureBtn"[\s\S]*?id="capturePreview"[\s\S]*?id="ocrText"[\s\S]*?id="copyOcrBtn"[\s\S]*?id="retryOcrBtn"[\s\S]*?id="sendOcrToAiBtn"[\s\S]*?id="ocrStatus"/);
  assert.match(html, /id="voiceCaptureView"[^>]*>[\s\S]*?id="startTabAudioBtn"[\s\S]*?id="stopTabAudioBtn"[\s\S]*?id="voiceText"/);
  assert.match(html, /#ocrPanel #capturePreview\{margin-top:6px\}/);
  assert.doesNotMatch(html, /data-ocr-view="capture">框选识别<\/button>|data-ocr-view="voice">网页语音<\/button>/);
  assert.match(popup, /function selectOcrView\(view, remember\)/);
  assert.match(popup, /QUESTION_VIEW_STORAGE_KEY = "popupLastQuestionView"/);
  assert.match(popup, /selectOcrView\(button\.dataset\.ocrView, true\)/);
  assert.match(popup, /if \(!questionViewSelectedThisOpen\) selectOcrView\(state\.questionView, false\)/);
  assert.match(popup, /data\[QUESTION_VIEW_STORAGE_KEY\] = view;\s*savePopupState\(data\)/);
  assert.match(popup, /\n  loadVoiceState\(\);\n/);
  assert.doesNotMatch(popup.match(/function currentPopupState\(\)[\s\S]*?\n  }/)[0], /popupLastQuestionView|QUESTION_VIEW_STORAGE_KEY/);
  assert.doesNotMatch(popup, /ocrFinished|ocrResultView/);
  assert.match(popup, /\["capture", "voice"\]\.indexOf\(view\)/);
  assert.match(popup, /action: "startTabAudioCapture"/);
  assert.match(popup, /action: "stopTabAudioCapture"/);
});

test("视频脚本按钮会显示真实运行状态面板", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  assert.match(html, /\.script-feature-detail\{[^}]*margin-top:6px/);
  assert.match(html, /\.script-feature-detail-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(popup, /detail\.className = "script-feature-detail"/);
  assert.match(popup, /if \(scripts\[0\]\) renderDetail\(scripts\[0\], "idle", null\)/);
  assert.match(popup, /总时长由插件视频模块提供；脚本不会每秒扫描网页/);
  assert.match(popup, /renderDetail\(script, "running", null\)/);
  assert.match(popup, /自动下一节已启动。切换课程后会再次读取一次插件状态/);
});

test("自动下一节脚本使用统一白底状态卡片", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  assert.match(html, /\.duration-next-card\{border-color:var\(--c-border\);background:var\(--c-white\)\}/);
  assert.match(popup, /@wsb-card\\s\+duration-next/);
  assert.match(popup, /\["插件总时长"/);
  assert.match(popup, /\["读取方式", "WSB\.video\.status"\]/);
  assert.match(popup, /总时长由插件视频模块提供；脚本不会每秒扫描网页/);
  assert.match(popup, /message\.type !== "WSB_SHARED_VIDEO_STATUS"/);
  assert.match(popup, /updateVideoStatus\(status\)/);
});

test("脚本权限保存后使用当前内容执行", () => {
  const popup = read("popup/index.js");
  assert.match(popup, /saveScriptRows\(function \(result\) \{/);
  assert.match(popup, /code: String\(input\.dataset\.scriptCode \|\| ""\)/);
  assert.match(popup, /scriptId: currentScript\.id,[\s\S]*?code: currentScript\.code,[\s\S]*?permissions: currentScript\.meta\.permissions/);
  assert.doesNotMatch(popup, /action: "executeUserScript",[\s\S]{0,160}?code: script\.code/);
});

test("AI 次窗口在 320x240 内提供清晰正文、更新时间和完整操作区", () => {
  const html = read("popup/ai-reply.html");
  const background = read("background/service-worker.js");
  assert.match(background, /AI_REPLY_BOUNDS = \{ width: 320, height: 240 \}/);
  assert.match(html, /\.reply-content\{flex:1;min-width:0;min-height:0;overflow:auto/);
  assert.match(html, /:root\{--c-black:#171717;--c-white:#fff;--c-gray:#707070;--c-light-blue:#9bdcff/);
  assert.match(html, /\.reply-card\{[^}]*border:1px solid var\(--c-border\)[^}]*background:var\(--c-panel\)/);
  assert.match(html, /\.reply-head\{[^}]*margin-bottom:8px/);
  assert.match(html, /\.reply-content\{[^}]*font-size:13px;line-height:1\.7/);
  assert.match(html, /\.copy-btn\{[^}]*height:30px/);
  assert.match(html, /\.copy-status\{[^}]*white-space:normal/);
  assert.match(html, /class="reply-meta" id="replyMeta"/);
});

test("AI 提问页面提供四个独立 Provider 标签", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  const controller = read("popup/ai-controller.js");
  assert.match(html, /id="aiProviderTabs"[^>]*role="tablist"[^>]*aria-label="AI 服务"/);
  assert.match(html, /#aiPanel \.ai-provider-tabs\{height:24px;min-height:24px;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:3px/);
  assert.match(html, /#aiPanel \.ai-provider-tab\{width:100%;height:24px;min-height:24px;padding:2px;font-size:9px\}/);
  assert.match(popup, /id: "deepseek", label: "DeepSeek"/);
  assert.match(popup, /id: "openai", label: "OpenAI"/);
  assert.match(popup, /id: "claude", label: "Claude"/);
  assert.match(popup, /id: "local", label: "Local model"/);
  assert.match(popup, /function renderAiProviderTabs\(\)/);
  assert.match(popup, /shortLabels = \{ deepseek: "DS", openai: "OAI", claude: "CLD", local: "LM" \}/);
  assert.match(popup, /button\.dataset\.aiProvider = option\.id/);
  assert.match(popup, /button\.setAttribute\("aria-label", option\.label\)/);
  assert.match(html, /id="aiUnconfiguredDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="aiUnconfiguredMessage">该AI功能尚未配置，请先前往设置配置</);
  assert.match(html, /id="goToAiSettingsBtn"[^>]*>前往设置</);
  assert.match(popup, /if \(!option\.configured\) \{\s*showAiUnconfiguredDialog\(option\.id\);\s*return;/);
  assert.match(popup, /showPanel\("settingsPanel", true\);\s*showProvider\(providerId\);/);
  assert.match(popup, /aiProviderWorkspaces/);
  assert.match(controller, /var payload = \{ provider: providerId, prompt: prompt \}/);
  assert.match(controller, /aiQuestionHistoryByProvider/);
});

test("AI答题新工作区默认直接答题且保留已有工作区模式", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  const content = read("content/index.js");
  assert.match(html, /<option value="custom" selected>&#30452;&#25509;&#31572;&#26696;<\/option>/);
  assert.match(popup, /function emptyAiWorkspace\(\)\s*\{\s*return \{ mode: "custom"/);
  assert.match(popup, /indexOf\(value\.mode\) >= 0 \? value\.mode : "custom"/);
  assert.match(popup, /aiController\.combineFrameText\(res\.frameResults \|\| \[\], 38000\)/);
  assert.match(popup, /\$\("aiMode"\)\.value === "custom"[\s\S]*?text\("\\u53ea\\u8f93\\u51fa\\u6700\\u7b80\\u6700\\u7ec8\\u7b54\\u6848/);
  assert.match(popup, /if \(pageText\) askAi\(pageText\);\s*else if \(\$\("aiMode"\)\.value === "custom" && \$\("aiQuestion"\)\.value\.trim\(\)\) askAi\(\$\("aiQuestion"\)\.value\);/);
  assert.doesNotMatch(popup, /text\("\\u8bf7\\u603b\\u7ed3\\u5f53\\u524d\\u9875\\u9762\\u5185\\u5bb9/);
  assert.match(content, /if \(text\.length > 40000\) text = text\.slice\(0, 40000\)/);
  assert.match(content, /truncated: sourceLength > text\.length/);
});

test("AI 教学使用独立的分步解题流程且不复用答题历史", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  const teaching = read("popup/ai-teaching-controller.js");
  const background = read("background/service-worker.js");
  assert.match(html, /id="aiTeachingProvider"/);
  assert.doesNotMatch(html, /id="aiTeachingMethod"/);
  assert.doesNotMatch(html, /id="aiTeachingGuidedMethodBtn"/);
  assert.doesNotMatch(html, /id="aiTeachingWallMethodBtn"/);
  assert.match(html, /class="ai-teaching-method-summary"><strong>公式解析式教学<\/strong>/);
  assert.match(html, /本步公式→符号与条件→题目对应→顺带举例→单步提问→迁移检验/);
  assert.match(html, /id="aiTeachingMethodHint"/);
  assert.match(html, /<div class="header-title-group"><h1>[^<]+<\/h1><button class="header-mode-btn" id="openAiTeachingBtn"[^>]*>AI教学<\/button><\/div>/);
  assert.match(html, /id="aiTeachingWorkspace"/);
  assert.match(html, /id="closeAiTeachingBtn"[^>]*>返回正常界面<\/button>/);
  assert.match(html, /id="aiTeachingProblem"[^>]*maxlength="30000"/);
  assert.match(html, /id="startAiTeachingBtn"[^>]*>开始教学<\/button>/);
  assert.match(html, /id="aiTeachingScrollProgress"[^>]*aria-live="polite">阅读 0%<\/strong>/);
  assert.match(html, /id="aiTeachingScrollTopBtn"[^>]*>顶部<\/button>/);
  assert.match(html, /id="aiTeachingScrollUpBtn"[^>]*>上一屏<\/button>/);
  assert.match(html, /id="aiTeachingScrollDownBtn"[^>]*>下一屏<\/button>/);
  assert.match(html, /id="aiTeachingScrollBottomBtn"[^>]*>底部<\/button>/);
  assert.match(html, /id="aiTeachingGuidance"[^>]*tabindex="0"[^>]*aria-live="polite"/);
  assert.match(html, /id="aiTeachingAttemptTitle">我的回答与思路<\/div>/);
  assert.match(html, /id="aiTeachingAttempt"[^>]*maxlength="12000"/);
  assert.match(html, /id="continueAiTeachingBtn"[^>]*>提交回答<\/button>/);
  assert.match(html, /id="explainAiTeachingBtn"[^>]*>公式与例题<\/button>/);
  assert.match(html, /<script src="\.\.\/shared\/math-renderer\.js"><\/script>/);
  assert.match(html, /<script src="ai-teaching-controller\.js"><\/script>/);
  assert.match(popup, /aiTeachingController\.bind\(\)/);
  assert.match(popup, /aiTeachingController\.clear\(\)/);
  assert.match(popup, /function setAiTeachingMode\(enabled, remember\)/);
  assert.match(popup, /hideScriptChromeNow\(\);\s*document\.documentElement\.classList\.toggle\("ai-teaching-mode", enabled\);\s*document\.body\.classList\.toggle\("ai-teaching-mode", enabled\)/);
  assert.match(popup, /if \(isPinnedWindow && wasEnabled !== enabled\) \{/);
  assert.match(popup, /document\.body\.classList\.toggle\("ai-teaching-mode", enabled\)/);
  assert.match(html, /html\{width:320px;height:340px;overflow:hidden/);
  assert.match(html, /html\.ai-teaching-mode:not\(\[data-window-mode="pinned"\]\)\{width:720px;height:600px\}/);
  assert.match(html, /html\[data-window-mode="pinned"\]\{width:100%;height:100%\}/);
  assert.match(html, /body\.ai-teaching-mode>\.header,body\.ai-teaching-mode>\.layout\{display:none!important\}/);
  assert.match(html, /body\.ai-teaching-mode>\.ai-teaching-workspace\{display:grid/);
  assert.match(html, /body\.ai-teaching-mode:not\(\.pinned-window\)\{--popup-width:720px;--popup-height:600px\}/);
  assert.match(html, /\.ai-teaching-page\{display:grid;[^}]*grid-template-columns:minmax\(250px,.9fr\) minmax\(360px,1.35fr\)/);
  assert.match(html, /#aiTeachingPanel #aiTeachingGuidance\{height:260px;[^}]*overflow-y:auto[^}]*scroll-behavior:smooth[^}]*overscroll-behavior:contain/);
  assert.match(html, /\.math-render-surface mjx-container\[jax="SVG"\]\[display="true"\][^{]*\{[^}]*max-width:100%/);
  assert.match(html, /@keyframes aiTeachingStepArrive/);
  assert.match(teaching, /guidanceScrollTop/);
  assert.match(teaching, /PageUp: "up",\s*PageDown: "down"/);
  assert.match(teaching, /setGuidanceScrollTop\(0, true, false\);\s*animateGuidanceUpdate\(\)/);
  assert.match(background, /setPinnedWindowTeachingMode: function \(request, sender\) \{\s*return windowService\.setTeachingMode\(request\.enabled, sender && sender\.tab && sender\.tab\.windowId\);\s*\}/);
  assert.match(teaching, /action: "askAiTeaching"/);
  assert.match(teaching, /公式解析式教学/);
  assert.match(teaching, /指出公式或规律→解释符号与条件→对应原题条件→顺带举例→回到原题提问/);
  assert.match(teaching, /每次回复只能提出一个核心问题/);
  assert.match(teaching, /本步公式.*符号与条件.*题目对应.*顺带举例.*回到原题/s);
  assert.match(teaching, /没有适用公式时写“本步规律”，严禁编造公式/);
  assert.match(teaching, /不能复制原题，不能代入原题数据/);
  assert.match(teaching, /正确且依据充分、方向正确但依据不足、关键误解、没有思路/);
  assert.match(teaching, /回答正确但依据不足时[\s\S]*公式选择、适用条件、量的对应、单位还是计算依据[\s\S]*对比例子/);
  assert.match(teaching, /第 N 步｜迁移检验/);
  assert.match(teaching, /answerCompleted && previousPhase === "transfer"/);
  assert.match(teaching, /previousPhase === "transfer" \|\| replyTransferCheck\(answer\)/);
  assert.match(teaching, /第 1 级“公式提示”/);
  assert.match(teaching, /第 2 级“代入示范”/);
  assert.match(teaching, /第 3 级“完整例题”/);
  assert.match(teaching, /session\.supportLevel = Math\.min\(3, session\.supportLevel \+ 1\)/);
  assert.match(teaching, /previousPhase !== "transfer" && nextPhase === "transfer"/);
  assert.doesNotMatch(teaching, /session\.method === "wall"/);
  assert.doesNotMatch(teaching, /aiQuestionHistoryByProvider/);
  assert.match(popup, /if \(!document\.body\.classList\.contains\("chrome-hidden"\) \|\| document\.body\.classList\.contains\("ai-teaching-mode"\)\) return/);
  assert.match(popup, /if \(document\.body\.classList\.contains\("ai-teaching-mode"\)\) \{\s*hideScriptChromeNow\(\);\s*return;\s*\}/);
  assert.match(background, /askAiTeaching:[\s\S]*?callAi\(message\.payload, respond\)/);
});

test("插件界面统一使用白底、黑色正文、灰色提示和淡蓝交互主题", () => {
  const html = read("popup/index.html");
  const reply = read("popup/ai-reply.html");
  const workspace = read("workspace/index.html");
  const theme = html.slice(html.indexOf("/* 黑、白、灰、淡蓝统一主题 */"), html.indexOf("/* 日志面板使用明确行高"));
  for (const source of [theme, reply, workspace]) {
    assert.match(source, /--c-black:#171717/);
    assert.match(source, /--c-white:#fff/);
    assert.match(source, /--c-gray:#707070/);
    assert.match(source, /--c-light-blue:#9bdcff/);
    assert.match(source, /--c-bg:var\(--c-white\)/);
  }
  assert.match(theme, /\.section-title,.mini-label,.status-label,.account-card-label,.script-meta,.hint\{color:var\(--c-muted\)\}/);
  assert.match(theme, /\.btn\.danger\{background:var\(--c-danger\);border-color:var\(--c-danger-border\);color:var\(--c-black\)\}/);
  assert.match(theme, /\.side-btn\.active\{background:var\(--c-accent-bg\)/);
  assert.match(theme, /\.privacy-row:hover,[^}]*\.log-entry:hover\{border-color:var\(--c-light-blue\);background:var\(--c-card\)\}/);
  assert.match(theme, /\.script-feature-action:hover\{border-color:var\(--c-light-blue\);background:var\(--c-card\)\}/);
  assert.doesNotMatch(theme, /\.privacy-row:hover,[^}]*\{[^}]*background:var\(--c-card-hover\)/);
  assert.match(theme, /\.script-feature-detail-state\.success\{color:var\(--c-black\)\}/);
  assert.match(theme, /\.script-feature-detail-state\.error\{color:var\(--c-black\)\}/);
  assert.match(workspace, /\.ws-error\{[^}]*color:var\(--c-black\);background:var\(--c-panel\);border:1px solid var\(--c-gray\)/);
  assert.match(workspace, /\.ws-menu-btn:hover\{background:var\(--c-card\);border-color:var\(--c-light-blue\)\}/);
  assert.match(reply, /<meta name="color-scheme" content="light">/);
  assert.match(workspace, /<meta name="color-scheme" content="light">/);
});

test("AI教学、AI答题和独立回复窗口统一使用响应式 SVG 公式界面", () => {
  const popupHtml = read("popup/index.html");
  const popupSource = read("popup/index.js");
  const replyHtml = read("popup/ai-reply.html");
  const replySource = read("popup/ai-reply.js");
  const formulaStyles = read("shared/math-renderer.css");
  assert.match(popupHtml, /<link rel="stylesheet" href="\.\.\/shared\/math-renderer\.css">/);
  assert.match(popupHtml, /<div(?=[^>]*id="aiTeachingGuidance")(?=[^>]*class="[^"]*math-render-surface)[^>]*>/);
  assert.match(popupHtml, /<div(?=[^>]*id="aiAnswerFormulaPreview")(?=[^>]*class="[^"]*math-render-surface)[^>]*>/);
  assert.match(popupHtml, /\.math-render-surface mjx-container\[jax="SVG"\]\[display="true"\]>svg\{display:block;max-width:100%;height:auto/);
  assert.match(popupSource, /renderAiAnswerValue\(workspace\.answer\)/);
  assert.match(replyHtml, /<link rel="stylesheet" href="\.\.\/shared\/math-renderer\.css">/);
  assert.match(replyHtml, /<div(?=[^>]*id="replyContent")(?=[^>]*class="[^"]*math-render-surface)[^>]*>/);
  assert.match(replyHtml, /\.reply-content mjx-container\[jax="SVG"\]\[display="true"\]>svg\{display:block;max-width:100%;height:auto/);
  assert.match(replySource, /renderReplyContent\(latestText \|\| "没有可显示的 AI 回复。"\)/);
  assert.match(formulaStyles, /mjx-container\[jax="SVG"\]\s*\{[^}]*color:\s*#000\s*!important[^}]*font-size:\s*1\.28em\s*!important[^}]*font-weight:\s*800/s);
  assert.match(formulaStyles, /svg path,[\s\S]*svg use\s*\{[^}]*stroke:\s*currentColor[^}]*stroke-width:\s*10[^}]*paint-order:\s*stroke fill/s);
  assert.match(formulaStyles, /\.ai-teaching-formula-group\s*\{[^}]*display:\s*grid[^}]*gap:\s*6px[^}]*text-align:\s*left/s);
  assert.match(formulaStyles, /\.ai-teaching-formula-row\s*\{[^}]*min-width:\s*0/s);
  assert.match(formulaStyles, /\.ai-teaching-formula-fallback \.ai-teaching-formula-source\s*\{[^}]*font-size:\s*1\.28em[^}]*font-weight:\s*800/s);
});

test("脚本工作区允许窄窗口滚动并约束外部脚本媒体宽度", () => {
  const html = read("workspace/index.html");
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(html, /#root\{[^}]*min-width:0;min-height:0[^}]*overflow:auto/);
  assert.match(html, /:root\{--c-black:#171717;--c-white:#fff;--c-gray:#707070;--c-light-blue:#9bdcff/);
  assert.match(html, /#root img,#root video,#root canvas,#root svg\{max-width:100%;height:auto\}/);
  assert.match(html, /\.ws-note\{[^}]*max-width:calc\(100% - 14px\)/);
  assert.match(html, /@media \(max-width:320px\)/);
});

test("主界面只移除静音状态卡片并保留静音操作", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  assert.doesNotMatch(html, /data-status="muted"/);
  assert.match(html, /id="muteBtn"/);
  assert.match(html, /id="unmuteBtn"/);
  assert.match(html, /id="toggleMuteBtn"/);
  assert.match(popup, /\$\("muteBtn"\)[\s\S]*?SET_MUTED/);
  assert.match(popup, /\$\("toggleMuteBtn"\)[\s\S]*?TOGGLE_MUTED/);
});

test("AI 服务操作按测试、保存、清空密钥排列", () => {
  const html = read("popup/index.html");
  const testIndex = html.indexOf('id="testAiBtn"');
  const saveIndex = html.indexOf('id="saveSettingsBtn"');
  const clearIndex = html.indexOf('id="clearKeyBtn"');
  assert.ok(testIndex >= 0);
  assert.ok(testIndex < saveIndex);
  assert.ok(saveIndex < clearIndex);
});

test("声明下方提供统一尺寸的双渠道捐赠入口和双语感谢弹窗", () => {
  const html = read("popup/index.html");
  const popup = read("popup/index.js");
  assert.match(html, /data-panel="declarationPanel">声明<\/button>\s*<button class="side-btn" id="donationNavBtn" data-panel="donationPanel">捐赠<\/button>/);
  assert.match(html, /data-panel="donationPanel">捐赠<\/button>\s*<button class="side-btn" id="authorNavBtn" data-panel="authorPanel">作者<\/button>/);
  assert.match(html, /<section class="panel" id="authorPanel">/);
  assert.match(html, /<div class="account-card-value">肆年<\/div>/);
  assert.match(html, /zbdwxb57531@qq\.com/);
  assert.match(html, /如果您愿意参与这个项目的制作，作者诚恳地向您发出邀约/);
  assert.match(html, /<h3>项目由来<\/h3>/);
  assert.match(html, /Windows 原生项目/);
  assert.match(html, /浮窗 \+ 灵动岛/);
  assert.match(html, /插件命名为 <strong>WinSpeedBall<\/strong> 的原因/);
  assert.match(html, /项目公开接口、脚本编写要求及相关说明均存放在项目仓库中/);
  assert.match(html, /#donationNavBtn\{margin-top:auto\}/);
  assert.match(html, /\.\.\/assets\/donation\/wechat\.png/);
  assert.match(html, /\.\.\/assets\/donation\/alipay\.png/);
  assert.equal((html.match(/class="donation-qr"[^>]*width="168" height="190"/g) || []).length, 2);
  assert.match(html, /感谢您的捐赠，非常感谢您对作者的创作认同，此插件有您这样的人才会越来越好/);
  assert.match(html, /Thank you for your donation\./);
  assert.match(popup, /function bindDonation\(\)/);
  assert.match(popup, /bindDonation\(\);/);
});

test("所有长内容界面隐藏滚动条并保留原生滚动、键盘翻页和回顶机制", () => {
  const popupHtml = read("popup/index.html");
  const popupSource = read("popup/index.js");
  const replyHtml = read("popup/ai-reply.html");
  const replySource = read("popup/ai-reply.js");
  const workspaceHtml = read("workspace/index.html");
  const workspaceSource = read("workspace/index.js");
  const shared = read("shared/scroll-surface.js");

  assert.match(popupHtml, /id="mainScrollProgress"[^>]*role="progressbar"/);
  assert.match(popupHtml, /id="mainContent"[^>]*tabindex="0"/);
  assert.match(popupHtml, /id="mainScrollTopBtn"[^>]*aria-controls="mainContent"/);
  assert.match(popupHtml, /<div class="header-actions"><span class="header-account"[^>]*>[^<]+<\/span><button class="surface-scroll-top" id="mainScrollTopBtn"[^>]*>回到顶部<\/button><button class="pin-btn"/);
  assert.match(popupHtml, /#mainScrollTopBtn\{position:static;z-index:auto;[^}]*box-shadow:none;white-space:nowrap\}/);
  assert.equal((popupHtml.match(/id="mainScrollTopBtn"/g) || []).length, 1);
  assert.match(popupHtml, /id="aiTeachingContent"[^>]*tabindex="0"/);
  assert.match(popupHtml, /id="aiTeachingPageScrollTopBtn"[^>]*aria-controls="aiTeachingContent"/);
  assert.match(popupHtml, /id="declarationGateScroll"[^>]*tabindex="0"/);
  assert.match(popupHtml, /shared\/scroll-surface\.js/);
  assert.match(popupHtml, /\*\{scrollbar-width:none;-ms-overflow-style:none\}\*::\-webkit-scrollbar\{display:none!important;width:0!important;height:0!important\}/);
  assert.match(popupHtml, /\.content,.side,.message,.consent-scroll,.ai-teaching-content,#aiTeachingGuidance,[^}]*\{scrollbar-width:none;-ms-overflow-style:none;scrollbar-gutter:auto\}/);
  assert.match(popupSource, /scrollSurfaceApi\.create\(\{/);
  assert.match(popupSource, /panelScrollPositions\.logRuntime/);
  assert.match(popupSource, /panelScrollPositions\.logUpdates/);

  assert.match(replyHtml, /id="replyScrollProgress"[^>]*role="progressbar"/);
  assert.match(replyHtml, /id="replyScrollTopBtn"[^>]*aria-controls="replyContent"/);
  assert.match(replyHtml, /\.reply-content\{scroll-behavior:smooth;scrollbar-width:none;-ms-overflow-style:none;scrollbar-gutter:auto\}/);
  assert.match(replyHtml, /\*::\-webkit-scrollbar\{display:none!important;width:0!important;height:0!important\}/);
  assert.match(replySource, /onUpdate: updateReplyMeta/);

  assert.match(workspaceHtml, /id="workspaceScrollProgress"[^>]*role="progressbar"/);
  assert.match(workspaceHtml, /id="workspaceScrollTopBtn"[^>]*aria-controls="root"/);
  assert.match(workspaceHtml, /id="root"[^>]*tabindex="0"/);
  assert.match(workspaceHtml, /#root\{[^}]*overflow:auto[^}]*scrollbar-gutter:auto;scrollbar-width:none;-ms-overflow-style:none/);
  assert.match(workspaceHtml, /\*::\-webkit-scrollbar\{display:none!important;width:0!important;height:0!important\}/);
  assert.match(workspaceSource, /function ensureWorkspaceScrollChrome\(\)/);
  assert.match(workspaceSource, /observeMutations: true/);

  assert.match(shared, /element\.scrollTo\(\{ top: target, behavior: behavior\(smooth\) \}\)/);
  assert.match(shared, /Home: "top"/);
  assert.match(shared, /PageDown: "down"/);
  assert.match(shared, /prefers-reduced-motion: reduce/);
});
