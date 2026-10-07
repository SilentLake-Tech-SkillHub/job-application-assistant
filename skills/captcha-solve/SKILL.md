---
name: captcha-solve
description: Handle ordinary CAPTCHA clicks in an enabled recruiting workflow and hand graphical challenges to the user by default. Agent takeover requires the user-defined three explicit confirmations and must still meet platform authorization and safety requirements; SMS codes use login-phone-otp.
metadata:
  version: "1.0.0"
---

# 人机验证（CAPTCHA）识别与交接

## 调用前检查

读取私有批次记录中的自动化授权（见[自动化授权](../../references/automation-authorization.md)）。`approved_subskills` 不含 `captcha-solve` 时，把人机验证交给用户；已授权登录流程中的普通入口点击和“获取短信验证码”由 `login-phone-otp` 继续处理。

短信验证码与图形人机验证分开处理：短信走 `login-phone-otp`，验证码默认由用户提供或本人输入；本子Skill处理网页的人机验证。开启本子Skill后，Agent 可完成普通验证按钮/复选框点击；需要识别、拖动、点选图案、输入图形字符或旋转图片的挑战，默认由用户完成。

只有用户明确要求 Agent 完整接手验证，并按[三次明确确认](../../references/automation-authorization.md#三次明确确认用户自定的额外流程)完成本次范围、风险与最终授权确认后，才进入下方代做分支。须说明验证失败、触发风控或账号受限的风险，并取得用户愿意自行承担所述风险的明确答复。三次确认与责任声明不能替代执行平台要求的批准、网站授权或安全限制。

## 步骤

1. **发现与分类**：普通点击或请求短信后出现验证时，确认其类型：普通按钮/复选框、滑块拼图、文字/物体点选、图形字符、旋转图片或其他挑战。短信/语音验证码不属于图形挑战，不在此处读取。
2. **默认处理**：完成已授权的普通点击；若出现图形挑战，说明所在页面和用户需要完成的动作，等待用户完成后核验。不把已开启子Skill或“全自动”视为完整接手的三次确认。
3. **已确认的代做分支**：只在用户确认的范围及执行平台允许的能力内，通过受支持的 computer use 识别并操作滑块、点选、字符或旋转控件。若平台要求对具体挑战单独确认，仍须满足；不模拟身份、不绕过访问控制或安全限制。
4. **核验与交接**：验证消失并进入下一步，或明确提示“验证通过”，才算完成。同一挑战最多尝试 2 次；两次未通过、识别置信度低或形态不支持时交给用户。用户完成后核验，再回到调用方继续。
5. **风控信号**：出现“操作频繁”“环境异常”或持续验证时暂停该网站，记录原因并推进其他公司；不换 IP、不伪造指纹、不换通道规避限制。

## 隐私与记录

验证截图仅用于当次授权操作与核验，不放进审核包、Skill 或 GitHub，不擅自分享。私有记录只写类型、确认依据、尝试次数与结果；短信码和其他认证秘密绝不保存。

## 返回

状态（无验证 / 已通过 / 待用户完成 / 频繁受限暂停）、尝试次数及下一步。
