---
name: captcha-solve
description: Detect a CAPTCHA or human-verification challenge on a recruiting site, classify it, and — after the user has explicitly enabled this subskill in the batch's automation Query — complete it through computer use (screenshot analysis, slider drag, click selection, character input). Hands it to the user after repeated failures or for unsupported challenge types.
metadata:
  version: "1.0.0"
---

# 人机验证（CAPTCHA）识别与通过

## 调用前检查

读取私有批次记录中的自动化授权（见[自动化授权](../../references/automation-authorization.md)）。`approved_subskills` 不含 `captcha-solve` 时，遇到验证直接停下，告诉用户“这里有人机验证需要你完成”，不做识别或操作。

开启即表示用户知晓并接受：自动通过人机验证属于自动化操作，存在触发网站风控、验证失败或账号受限的可能；本子Skill只用于用户本人委托的投递账号，失败即交接，不反复重试。

## 步骤

1. **发现**：点击“获取验证码”、登录或提交后出现弹窗、页面停滞，或提示“请完成安全验证”时，先截图确认。
2. **识别分类**：判断类型并记录：滑块拼图（拖到缺口）、文字点选（按提示依次点击图中文字/物体）、图形字符（输入变形文本）、旋转图片、点击复选（如“我不是机器人”）、无感验证失败后的二次挑战。短信/语音验证不属于本Skill，走 `login-phone-otp` 或用户本人。
3. **通过（computer use）**：
   - 截图 → 识别缺口位置/目标文字/字符序列/旋转角度 → 用 computer use 以真实鼠标轨迹执行：滑块按“移动到滑块→按住→沿轨迹拖至缺口→释放”，拖动加入正常人手的速度变化与轻微过冲；点选逐个点击目标中心；图形字符用键盘输入识别结果；旋转逐步转正。
   - 每次尝试后重新截图核验：验证消失、进入下一步或提示“验证通过”才算完成；“点完没有报错”不算。
4. **失败与交接**：同一挑战最多尝试 2 次；两次未通过、识别置信度低（字符模糊、缺口不明显）或形态不支持时，向用户说明类型与位置，请用户本人完成。用户完成后重新截图核验，再回到调用方子Skill继续（如 `login-phone-otp` 等待短信）。
5. **风控信号**：同一网站连续多次弹验证、提示“操作频繁”或“环境异常”时，暂停该网站，记录原因，先处理其他公司，稍后再试；不换 IP、不伪造指纹去规避。

## 隐私与记录

验证截图仅用于当次识别与核验，不放进审核包、Skill 或 GitHub。私有记录只写类型、尝试次数与结果。

## 返回

状态（无验证 / 已通过 / 待用户完成 / 频繁受限暂停）、尝试次数及下一步。
