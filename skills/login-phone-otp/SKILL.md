---
name: login-phone-otp
description: Fill the approved phone number and request an SMS login code in an enabled recruiting workflow. The user supplies or enters the code by default; reading the matching SMS requires three explicit takeover confirmations, specific SMS-source permission and platform support. Never saves codes.
metadata:
  version: "1.0.0"
---

# 手机验证码登录

## 调用前检查

读取私有批次记录中的自动化授权（见[自动化授权](../../references/automation-authorization.md)）。`approved_subskills` 不含 `login-phone-otp` 时不执行，请用户本人完成手机登录后再继续。

## 步骤

1. **确认账号与号码**：先看页面是否已经登录，已登录就不再发码。手机号取自用户指定的投递简历或私有配置中的完整号码，并核对国家/地区码；页面上的掩码号码不能用来推断完整号码。号码缺失或有冲突时向用户确认这一项。
2. **填号并获取验证码**：选择“手机号/验证码登录”入口，填写号码，阅读登录相关条款（勾选需同时开启 `terms-consent`，否则请用户勾选），点击“获取验证码”。出现滑块或图形验证时转到 `captcha-solve` 的流程。记录发送时间和倒计时，不记录号码和验证码原文。
3. **取码，默认由用户提供**：
   - 默认请用户提供这次短信码，或由用户本人输入；Agent 继续普通页面点击。平台允许时，仅将用户提供的码用于刚发起的对应登录；平台禁止代填时只请用户输入。
   - 用户明确要求完整接手时，先按[三次明确确认](../../references/automation-authorization.md#三次明确确认用户自定的额外流程)确认本次接手范围、可能后果及用户愿意自行承担所述风险。三次确认不能替代平台授权或安全限制。
   - 只有三次确认已完成、`sms_read_allowed` 明确允许读取指定短信来源，且平台允许时，才读取本次对应短信；例如在已获准且已同步的 Mac「信息」中，等待 30 秒到 1 分钟，仅查看发送时间晚于本次请求、明确匹配本网站/品牌的短信。不扩展为短信历史读取或持续访问。
   - 超过约 1 分钟仍没有：先看页面是否提示发送失败或号码错误；可重发时最多再发一次，仍未收到就请用户查看手机。短信与图形 CAPTCHA 分别授权，接手短信不自动授权解决图形挑战。
4. **填写并登录**：填写验证码，点击登录。验证码错误或过期时读取页面提示，按需重新获取；不复用旧码，也不使用其他网站的码。
5. **确认结果**：以页面账号标识、个人中心或目标表单可访问为准，“点击了登录”本身不算成功。

## 隐私

验证码、短信内容、Cookie 只用于这一次登录，绝不保存或复述验证码，不写进日志、审核包、截图、测试样例、Skill 或 GitHub。截图时避开短信窗口和验证码输入框。

## 返回

向父Skill返回：登录方式、状态（已登录 / 待用户输入验证码 / 发送失败 / 被人机验证拦截）、需要用户做的事。登录完成后回到父Skill检查账号历史投递和名额。
