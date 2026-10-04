---
name: captcha-handoff
description: Detect and explain a CAPTCHA or human-verification challenge on a recruiting site, then hand it to the user to complete and resume afterwards. Used only after the user has explicitly enabled this subskill in the batch's automation Query. Does not solve or bypass CAPTCHAs automatically.
metadata:
  version: "1.0.0"
---

# 人机验证（CAPTCHA）识别与交接

## 为什么不自动通过

滑块、点选、图形字符、旋转图片等人机验证是网站用来确认“操作者是真人”的机制。由 Agent 识别图片并模拟拖动或点击来通过它，实质上是绕过网站的反机器人保护，可能违反网站条款并导致账号被风控。因此本Skill只负责**发现、说明、交接、恢复**，验证本身由用户完成。即使用户开启全自动模式，这一点也不变。

## 调用前检查

读取私有批次记录中的自动化授权（见[自动化授权](../../references/automation-authorization.md)）。`approved_subskills` 不含 `captcha-handoff` 时，遇到验证直接停下并告诉用户“这里有人机验证需要你完成”，不做额外分析。

## 步骤

1. **发现**：点击“获取验证码”、登录或提交后出现弹窗、页面停滞，或提示“请完成安全验证”时，截图确认。
2. **识别并说明**：判断类型（滑块拼图、文字点选、图形字符、旋转、短信/语音二次验证、无感验证失败等），告诉用户位置和要做的操作，例如“页面中间有一个滑块拼图，请把滑块拖到缺口处”。
3. **交接**：请用户本人完成。保持页面不刷新、不重复点击发送按钮，以免触发更严格的风控。
4. **恢复**：用户说完成后，重新截图检查验证是否消失、验证码是否已发送或页面是否进入下一步；然后回到调用方子Skill继续（如 `login-phone-otp` 等待短信）。
5. **反复出现**：同一网站连续多次弹出验证或提示“操作频繁”时，暂停该网站，记录原因，先处理其他公司，稍后再试。

## 隐私

验证截图仅用于当下判断，不放进审核包、Skill 或 GitHub。

## 返回

状态（无验证 / 待用户完成 / 已完成 / 频繁受限暂停）及下一步。
