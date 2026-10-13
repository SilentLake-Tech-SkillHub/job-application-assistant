---
name: personal-info-vault
description: Keep every application fact that is not on the résumé (birth date, home city, hometown, emergency contact, student-leader roles, photo path, interview and transfer preferences, etc.) in one private, per-user profile file, read it before filling any form, and write new facts the moment the user states them. Use whenever a recruiting form asks for something the résumé lacks, or the user tells you a personal fact in conversation. The profile file is created per user in their own workspace and must never be published.
metadata:
  version: "1.2.0"
---

# 个人信息档案

网申表单常要求简历以外的信息。每家公司重复询问会浪费用户时间，散落在对话里又容易丢失或误写进公开文件。本子Skill让这些信息只有一个存放处：**用户自己的私有档案文件**。Skill 只提供规则和空白模板，从不包含任何人的数据。

## 档案文件在哪里

- 从工作区路由（如 `ROUTER.md`）或私有配置中读取档案路径。没有登记时，复制 [空白模板](assets/profile-template.md) 到工作区的私有目录（Skill 目录之外），登记路径后再使用。
- 档案文件**绝不放进本Skill或任何Skill目录**，也不放进会被同步、发布的目录。这样更新、同步或推送Skill时，档案不会被带走。
- 每位用户各自创建自己的档案；复制Skill给别人时只复制规则和模板。

## 第一次：从简历生成文本基础档案

每位用户第一次使用（或简历换版后），先运行：

```bash
python <Skill目录>/scripts/profile_vault.py init --resume <投递用简历> --vault <私有目录>/个人信息档案.md
```

脚本把简历转成纯文本 `简历文本.md`（放在档案旁边），在档案里生成「简历基础信息」表并记下简历的 SHA-256，自动填出手机号和邮箱；其余空行由 Agent **读 `简历文本.md` 补齐**，不再反复读 PDF（省 token）。自动填入和补齐的内容都请用户核对一次。扫描件提取不出文字时，导出纯文本后用 `--text <文件>` 传入。

`python scripts/profile_vault.py check --vault <档案> --resume <当前简历>`：简历换过（哈希不一致）时提示重新 init；档案里出现证件号、银行卡号、密码、验证码等永不记录的内容时报错。重新 init 不覆盖用户已写的值。

## 读取

填写任何网申表单前先读档案（「简历基础信息」+「网申补充信息」+ 其他各节）。填写方案用 `值来源: 档案:<字段>` 引用这里的值，执行时取值，不把值抄进方案。表单字段与档案字段按含义对应，不按字面猜：例如「家庭所在地」和「家乡/籍贯」是两个字段，「现居地」又是另一个；档案没有对应值时视为缺失，不从其他字段推断。

## 写入

- 用户在对话中给出新的个人信息、经历或网申偏好时，**当场写入档案**，注明日期、用户原话摘要和适用范围（全部公司 / 指定公司或批次）。
- 缺失项按公司汇总一次性询问；拿到答复后**当场用脚本写入档案**，再填表，以后同类**事实字段**直接复用，不再重复问：

  ```bash
  python scripts/profile_vault.py add --vault <档案> --field 紧急联系人电话 --value <答复> --source "用户 10-14 答复" [--scope 全部]
  python scripts/fill_plan.py vault-sync <岗位目录>/填写方案.json --vault <档案>
  ```

  `add` 已有字段时更新取值并在「变更记录」留一行，新字段写进「网申补充信息」；拒绝永不记录的字段，输出不回显取值。`vault-sync` 把填写方案里标为「需用户」、而档案现在已有值的字段改回「待填」，仍缺的列成一次提问清单；档案里没有这一项时，`fill_plan.py mark` 也不允许把该字段改回待填或已读回。
- **选择类偏好不直接复用**：志愿顺序、意向部门、是否接受调剂、意向城市等是用户对具体目标的选择。档案里记录的这类偏好只能作为下一次的**建议默认值**展示给用户，仍须在父Skill提交前目标确认中逐项确认，不得据此直接勾选。
- 用户修改已有值时，更新取值并在「变更记录」留一行，不保留已被否定的旧值作为当前值。
- 只记用户明确给出的事实；不记推测、不记网站自动解析出的内容。

## 永不记录

证件号码（身份证、护照等）、密码、短信/邮箱验证码、Cookie、银行卡号。需要这些时由用户本人在页面输入。

## 发布前隐私检查

更新本Skill并同步到项目副本或公开仓库前：

1. 确认待发布目录中没有档案文件（模板除外），也没有从档案复制出的任何取值。
2. 对待发布文件做隐私扫描（姓名、电话、邮箱、证件号形态、本地路径等），命中即中止并移除，绝不手工绕过。
3. 公开仓库的 `.gitignore` 保留兜底规则，阻止 `personal-info*`、`*.private.md`、`private/` 等档案类文件被提交。

## 与其他子Skill的关系

[privacy-info-fill](../privacy-info-fill/SKILL.md) 填个人信息栏时以本档案为数据源；[application-content-fill](../application-content-fill/SKILL.md) 遇到简历未写的经历时先查本档案。授权、提交门禁仍按父Skill执行，档案里的偏好不等于投递授权。

## 返回

向父Skill返回：本次读取的字段、仍缺失的字段、新写入的字段（只给字段名，不复述敏感原文）。
