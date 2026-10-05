---
name: login-wechat
description: WeChat login for recruiting sites, used only after the user has explicitly enabled this subskill in the batch's automation Query. Chooses the WeChat entry, clicks the local quick-confirm when the computer's WeChat is already signed in, and otherwise asks the user to scan the QR code or sign in to desktop WeChat.
metadata:
  version: "1.1.0"
---

# 微信登录

## 调用前检查

读取私有批次记录中的自动化授权（见[自动化授权](../../references/automation-authorization.md)）。`approved_subskills` 不含 `login-wechat` 时不执行，请用户本人完成微信登录。

## 步骤

1. **先看是否已登录**：页面账号标识、个人中心或目标表单可访问时直接继续，不重新授权。
2. **选择微信入口**：点击“微信登录”。阅读弹出的授权页实际内容：是哪个应用、申请哪些权限（头像昵称、手机号等）。
3. **本机微信已登录**：Chrome 或微信能识别本机已登录的微信时，页面通常显示“使用本机微信快捷登录 / 确认登录”按钮，或桌面微信弹出确认窗口。核对申请方就是当前招聘网站后，由Agent点击确认。桌面微信弹出的「申请使用你的昵称、头像 → 允许」窗口在浏览器之外：依次用 computer use、系统脚本（osascript/System Events）点击「允许」，两者都不可用时才交接，并附截图说明（见[连续推进](../../references/automation-continuity.md)）。授权内容超出登录所需（例如要求关注公众号以外的额外权限、绑定其他账号）时，先说明并请用户确认。
4. **本机微信未登录或只有二维码**：告诉用户“请用手机微信扫描页面二维码”或“请先登录电脑上的微信，再告诉我”。扫码、手机端确认和生物识别只能由用户本人完成。用户完成后Agent继续等待页面跳转。
5. **确认结果**：二维码出现、微信窗口打开或授权页关闭都不代表已经登录。以跳转后的页面账号、个人中心或目标表单为准。
6. **账号绑定**：平台要求新建账号、绑定手机号/邮箱或合并已有账号时，先说明会影响哪个账号（尤其是有历史投递的账号），获得用户确认后再操作。

## 隐私

二维码、授权码、Cookie 和会话信息不写入日志、审核包、截图、Skill 或 GitHub。

## 返回

向父Skill返回：状态（已登录 / 待用户扫码 / 待用户登录桌面微信 / 授权失败）及下一步。
