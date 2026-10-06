---
name: personal-info-vault
description: Keep every application fact that is not on the résumé (birth date, home city, hometown, emergency contact, student-leader roles, photo path, interview and transfer preferences, etc.) in one private, per-user profile file, read it before filling any form, and write new facts the moment the user states them. Use whenever a recruiting form asks for something the résumé lacks, or the user tells you a personal fact in conversation. The profile file is created per user in their own workspace and must never be published.
metadata:
  version: "1.0.0"
---

# 个人信息档案

网申表单常要求简历以外的信息。每家公司重复询问会浪费用户时间，散落在对话里又容易丢失或误写进公开文件。本子Skill让这些信息只有一个存放处：**用户自己的私有档案文件**。Skill 只提供规则和空白模板，从不包含任何人的数据。

## 档案文件在哪里

- 从工作区路由（如 `ROUTER.md`）或私有配置中读取档案路径。没有登记时，复制 [空白模板](assets/profile-template.md) 到工作区的私有目录（Skill 目录之外），登记路径后再使用。
- 档案文件**绝不放进本Skill或任何Skill目录**，也不放进会被同步、发布的目录。这样更新、同步或推送Skill时，档案不会被带走。
- 每位用户各自创建自己的档案；复制Skill给别人时只复制规则和模板。

## 读取

填写任何网申表单前先读档案。表单字段与档案字段按含义对应，不按字面猜：例如「家庭所在地」和「家乡/籍贯」是两个字段，「现居地」又是另一个；档案没有对应值时视为缺失，不从其他字段推断。

## 写入

- 用户在对话中给出新的个人信息、经历或网申偏好时，**当场写入档案**，注明日期、用户原话摘要和适用范围（全部公司 / 指定公司或批次）。
- 缺失项按公司汇总一次性询问；拿到答复后写入档案，再填表，以后同类字段直接复用，不再重复问。
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
