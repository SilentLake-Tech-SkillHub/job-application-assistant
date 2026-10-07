---
name: application-login
description: Check and reconcile recruiting-site login state, then route to the user-approved login subskill (phone code, WeChat) or hand login to the user. Use when a recruiting form requires authentication, a session expires, or the logged-in account must be verified before preparing or submitting.
metadata:
  version: "2.1.0"
---

# 投递登录处理

本Skill负责判断“现在是否已登录、登录的是哪个账号”，并按用户在本批次开启的自动化授权选择登录方式。具体的验证码、微信、人机验证动作由独立子Skill处理，它们默认关闭，需用户在 Query 中明确开启（见[自动化授权](../../references/automation-authorization.md)）。

## 入口与会话检查

1. 从父Skill读取当前公司、岗位、准备授权、用户指定的登录方式和自动化授权记录。保留用户已登录的 Chrome 或指定浏览器会话。
2. 核对招聘官网及其实际跳转的认证平台。先检查页面账号标识、个人中心和目标表单；已登录就继续准备，不重新发验证码，也不切换账号。
3. 页面仍在加载时等待账号与表单状态稳定。“网页加载完成”不等于登录完成，空白加载态也不代表用户没有资料。

## 连续推进

登录在授权范围内连续推进：优先复用已登录会话，其他登录方式按用户选择；Agent 不执行微信快捷确认或 OAuth“允许”。普通控件不可达时可切换受支持通道，但不得绕过权限限制或本人操作要求。推进到安全交接点，按对应子Skill提供允许的截图和唯一动作；微信截图交接需先完成三次确认。详见[连续推进](../../references/automation-continuity.md)。

## 选择登录方式

| 登录方式 | 已开启对应子Skill | 未开启 |
|---|---|---|
| 手机号验证码 | 调用 [login-phone-otp](../login-phone-otp/SKILL.md) | 请用户本人登录 |
| 微信 | 调用 [login-wechat](../login-wechat/SKILL.md) | 请用户本人登录 |
| 邮箱验证码 | 用户已授权读取该邮箱时，按下方“邮箱验证码”处理 | 请用户本人登录 |
| 账号密码 | 不代填密码 | 请用户本人登录 |
| 任意方式中出现人机验证 | 调用 [captcha-solve](../captcha-solve/SKILL.md)：普通点击由 Agent 做，图形默认用户完成；三次确认且平台允许才完整接手 | 直接请用户完成验证 |
| 登录条款勾选 | 调用 [terms-consent](../terms-consent/SKILL.md)，按逐项查看或三次确认后的本次全部代勾处理，并保留平台边界 | 请用户勾选 |

用户指定了登录方式时优先使用；网站只支持某一种方式时按网站实际情况选择。

## 邮箱验证码

- 只在用户明确授权读取该邮箱（连接器或已登录邮箱页面）后使用；限定查找本次登录的发件方、主题和时间。
- 区分验证码与验证链接，按网站实际支持的方式完成。过期或错误时按页面提示处理，邮件送达不等于登录成功。
- 执行Agent所在平台不允许代为输入验证码时，请用户输入这一码。

## 验证、隐私与交接

- 密码、验证码、Cookie、会话令牌和身份材料不写入日志、审核包、测试样例、Skill 或 GitHub；截图避开或遮盖这些内容。微信二维码只按 `login-wechat` 的三次确认、已核验私密渠道及平台安全限制交接，不另行保存或转发。保持浏览器登录状态，不导出凭据。
- 平台要求创建账号、绑定手机号/邮箱或合并已有账号时，先说明影响哪个账号，获得用户确认后再操作，避免改动有历史投递的账号。
- 向私有记录返回：公司/目标页、登录方式、状态（已登录 / 待用户登录 / 待验证码 / 待人机验证 / 实际失败）、脱敏证据位置和尚需动作。以当前账号标识及可访问的目标表单确认登录。
- 登录完成后回到父Skill检查账号投递历史、名额、冷冻期、刷新和志愿顺序，再调用内容填写子Skill。登录操作不包含最终投递、撤回或替换历史申请。
