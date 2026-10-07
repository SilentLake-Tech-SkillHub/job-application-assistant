---
name: login-wechat
description: Prepare recruiting-site WeChat login and, after three explicit user confirmations, send an allowed minimal screenshot to the verified private user channel for the user to scan or operate. Never performs automatic quick authorization or clicks OAuth Allow.
metadata:
  version: "1.1.0"
---

# 微信登录交接

## 调用前检查

读取私有批次记录中的自动化授权（见[自动化授权](../../references/automation-authorization.md)）。`approved_subskills` 不含 `login-wechat` 时不执行，请用户本人完成微信登录。

本子Skill只准备登录入口并交接给用户。删除 Agent 自动微信快捷确认流程：不点击网页或桌面微信的“确认登录”“允许”等 OAuth 授权按钮，不通过 computer use、系统脚本或其他通道代授持续权限。

## 步骤

1. **先看是否已登录**：页面账号标识、个人中心或目标表单可访问时直接继续，不重新授权。
2. **选择微信入口**：在已批准的登录范围内打开“微信登录”，读取实际申请方及权限，到二维码或本人确认页为止。入口点击若本身就会授权，则停在点击前交给用户。
3. **三次确认截图交接**：发送前按[三次明确确认](../../references/automation-authorization.md#三次明确确认用户自定的额外流程)取得用户对本次网站、截图内容、已核验的本人私密渠道及用途的确认；说明认证截图误发或泄露的风险。确认不是三个合并按钮或一个笼统“全自动”。
4. **由用户扫码/操作**：仅在执行平台允许传送该认证截图时，发送完成登录所需的最少画面到已核验的用户私密会话，遮盖无关个人资料和认证秘密，请用户扫码或在原授权窗口本人操作。若平台禁止转发二维码或其他认证材料，则不发送该材料，改为请用户在原页面完成。扫码、登录确认、OAuth“允许”和生物识别始终由用户本人完成。
5. **确认结果**：二维码出现、微信窗口打开或授权页关闭都不代表已经登录。用户操作后，以跳转后的页面账号、个人中心或目标表单为准。
6. **账号与权限变化**：新建、绑定、合并账号或创建/扩大持续权限时，说明具体账号、权限及后果，按执行平台要求取得该次确认；必须本人操作的步骤继续交给用户。三次截图确认不授权 Agent 点击 OAuth“允许”，也不扩大账号或持续权限范围。

## 隐私

获准的交接截图仅发送给用户确认过且已核验的本人私密渠道，不转发第三方，不纳入日志、审核包、测试样例、Skill 或 GitHub。授权码、Cookie、会话令牌等认证秘密不采集或保存；平台安全限制优先于截图交接授权。

## 返回

向父Skill返回：状态（已登录 / 待截图交接确认 / 待用户扫码或本人授权 / 授权失败）及下一步。
