---
name: terms-consent
description: Read and tick ordinary agreement checkboxes during recruiting login and application filling — user agreements, privacy authorizations, résumé-truthfulness declarations and application notices — used only after the user has explicitly enabled this subskill in the batch's automation Query. Never clicks final submission or "confirm submission" controls.
metadata:
  version: "1.0.0"
---

# 条款确认与勾选

## 调用前检查

读取私有批次记录中的自动化授权（见[自动化授权](../../references/automation-authorization.md)）。`approved_subskills` 不含 `terms-consent` 时，所有勾选框留给用户本人勾选。

## 可以勾选的条款

- 登录/注册时的用户协议、隐私政策。
- 网申页的个人信息处理授权、简历真实性承诺（“本人承诺所提供的简历真实、准确……”）。
- 招聘须知、申请工作须知、信息声明等阅读确认。

勾选前打开或阅读条款正文，确认没有异常内容，例如：同意转授信息给无关第三方、自动订阅付费服务、放弃法定权利、竞业或保证金。出现这类内容时先向用户说明，由用户决定。

真实性承诺只有在表单内容来自用户确认过的材料时才勾选；还有待核实的事实时，先解决再勾选。

## 不属于本Skill的操作

- “投递简历”“确认投递”“我已知晓（投递后不可修改）”这类会触发**最终提交**的按钮和弹窗勾选，属于父Skill的 Submit 阶段，需要用户对具体岗位和审核版本的投递批准。
- 撤回申请、终止应聘、替换志愿、删除记录。
- 授权绑定其他账号、开通付费服务。

## 记录

在私有审核包记录：页面、条款名称、勾选时间、依据（用户批准的自动化授权）。勾选后读回勾选状态，页面重渲染后再检查一次。

## 返回

已勾选条款列表、未勾选及原因、需要用户决定的条款。
