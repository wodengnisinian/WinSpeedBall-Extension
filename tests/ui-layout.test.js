const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("主界面保持固定尺寸并使用无横向溢出的紧凑布局", () => {
  const html = read("popup.html");
  assert.match(html, /--popup-width:320px/);
  assert.match(html, /--popup-height:340px/);
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(html, /body\.chrome-hidden \.right-side\{[^}]*transform:translateX\(0\)/);
  assert.match(html, /body\.chrome-hidden \.header,body\.chrome-hidden \.side\{pointer-events:none\}/);
  assert.match(html, /--c-bg:#09111a/);
  assert.match(html, /--c-panel:#101c28/);
  assert.match(html, /--c-card:#142331/);
  assert.match(html, /--c-accent:#78c1ec/);
  assert.match(html, /\.status-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html, /#videoStatus\.status-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:3px\}/);
  assert.match(html, /#videoStatus \.status-item\{height:30px;min-height:30px;padding:3px 4px/);
  assert.match(html, /details\.fold\{[^}]*background:var\(--c-panel\)/);
  assert.match(html, /textarea\{min-height:70px;resize:none\}/);
  assert.match(html, /\.consent-gate\{[^}]*width:var\(--popup-width\);height:var\(--popup-height\)/);
  assert.match(html, /aria-label="功能导航"/);
  assert.match(html, /aria-label="系统导航"/);
});

test("视频页面隐藏滚动条但保留滚动能力", () => {
  const html = read("popup.html");
  const popup = read("popup.js");
  assert.match(html, /body\.video-panel-active \.content\{[^}]*overflow-y:auto[^}]*touch-action:pan-y[^}]*scrollbar-width:none/);
  assert.match(html, /body\.video-panel-active \.content::-webkit-scrollbar\{display:none;width:0;height:0\}/);
  assert.match(popup, /document\.body\.classList\.toggle\("video-panel-active", panelId === "videoPanel"\)/);
});

test("视频脚本按钮会显示真实运行状态面板", () => {
  const html = read("popup.html");
  const popup = read("popup.js");
  assert.match(html, /\.script-feature-detail\{[^}]*margin-top:6px/);
  assert.match(html, /\.script-feature-detail-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(popup, /detail\.className = "script-feature-detail"/);
  assert.match(popup, /if \(scripts\[0\]\) renderDetail\(scripts\[0\], "idle", null\)/);
  assert.match(popup, /总时长由插件视频模块提供；脚本不会每秒扫描网页/);
  assert.match(popup, /renderDetail\(script, "running", null\)/);
  assert.match(popup, /自动下一节已启动。切换课程后会再次读取一次插件状态/);
});

test("自动下一节脚本使用插件状态专用冷色卡片", () => {
  const html = read("popup.html");
  const popup = read("popup.js");
  assert.match(html, /\.duration-next-card\{[^}]*border:1px solid #294b63[^}]*background:linear-gradient/);
  assert.match(popup, /@wsb-card\\s\+duration-next/);
  assert.match(popup, /\["插件总时长"/);
  assert.match(popup, /\["读取方式", "WSB\.video\.getStatus"\]/);
  assert.match(popup, /总时长由插件视频模块提供；脚本不会每秒扫描网页/);
  assert.match(popup, /message\.type !== "WSB_SHARED_VIDEO_STATUS"/);
  assert.match(popup, /updateVideoStatus\(status\)/);
});

test("脚本权限保存后使用当前内容执行", () => {
  const popup = read("popup.js");
  assert.match(popup, /saveScriptRows\(function \(result\) \{/);
  assert.match(popup, /code: String\(input\.dataset\.scriptCode \|\| ""\)/);
  assert.match(popup, /scriptId: currentScript\.id,[\s\S]*?code: currentScript\.code,[\s\S]*?permissions: currentScript\.meta\.permissions/);
  assert.doesNotMatch(popup, /action: "executeUserScript",[\s\S]{0,160}?code: script\.code/);
});

test("AI 次窗口在 280x180 内保留可滚动正文并压缩非正文区域", () => {
  const html = read("ai_reply.html");
  const background = read("background.js");
  assert.match(background, /AI_REPLY_BOUNDS = \{ width: 280, height: 180 \}/);
  assert.match(html, /\.reply-content\{flex:1;min-width:0;min-height:0;overflow:auto/);
  assert.match(html, /:root\{--c-bg:#09111a;--c-panel:#101c28;--c-card:#142331/);
  assert.match(html, /\.reply-card\{[^}]*border:1px solid var\(--c-border\)[^}]*background:var\(--c-panel\)/);
  assert.match(html, /\.reply-head\{[^}]*margin-bottom:5px/);
  assert.match(html, /\.copy-btn\{[^}]*height:28px/);
  assert.match(html, /\.copy-status\{[^}]*text-overflow:ellipsis/);
});

test("脚本工作区允许窄窗口滚动并约束外部脚本媒体宽度", () => {
  const html = read("script_workspace.html");
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(html, /#root\{[^}]*min-width:0;min-height:0[^}]*overflow:auto/);
  assert.match(html, /:root\{--c-bg:#09111a;--c-panel:#101c28;--c-card:#142331/);
  assert.match(html, /#root img,#root video,#root canvas,#root svg\{max-width:100%;height:auto\}/);
  assert.match(html, /\.ws-note\{[^}]*max-width:calc\(100% - 14px\)/);
  assert.match(html, /@media \(max-width:320px\)/);
});

test("主界面只移除静音状态卡片并保留静音操作", () => {
  const html = read("popup.html");
  const popup = read("popup.js");
  assert.doesNotMatch(html, /data-status="muted"/);
  assert.match(html, /id="muteBtn"/);
  assert.match(html, /id="unmuteBtn"/);
  assert.match(html, /id="toggleMuteBtn"/);
  assert.match(popup, /\$\("muteBtn"\)[\s\S]*?SET_MUTED/);
  assert.match(popup, /\$\("toggleMuteBtn"\)[\s\S]*?TOGGLE_MUTED/);
});

test("AI 服务操作按测试、保存、清空密钥排列", () => {
  const html = read("popup.html");
  const testIndex = html.indexOf('id="testAiBtn"');
  const saveIndex = html.indexOf('id="saveSettingsBtn"');
  const clearIndex = html.indexOf('id="clearKeyBtn"');
  assert.ok(testIndex >= 0);
  assert.ok(testIndex < saveIndex);
  assert.ok(saveIndex < clearIndex);
});

test("声明下方提供统一尺寸的双渠道捐赠入口和双语感谢弹窗", () => {
  const html = read("popup.html");
  const popup = read("popup.js");
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
  assert.match(html, /assets\/donation-wechat\.png/);
  assert.match(html, /assets\/donation-alipay\.png/);
  assert.equal((html.match(/class="donation-qr"[^>]*width="168" height="190"/g) || []).length, 2);
  assert.match(html, /感谢您的捐赠，非常感谢您对作者的创作认同，此插件有您这样的人才会越来越好/);
  assert.match(html, /Thank you for your donation\./);
  assert.match(popup, /function bindDonation\(\)/);
  assert.match(popup, /bindDonation\(\);/);
});
