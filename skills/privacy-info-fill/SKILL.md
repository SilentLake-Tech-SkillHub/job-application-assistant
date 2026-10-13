---
name: privacy-info-fill
description: Fill personal and contact fields on recruiting forms (phone, email, home or school city, address and similar) from the user's designated résumé or private profile, used only after the user has explicitly enabled this subskill in the batch's automation Query. Missing facts are requested from the user; government ID numbers are always left for the user to enter personally.
metadata:
  version: "1.2.0"
---

# 隐私信息填写

## 调用前检查

读取本批 `Query.md` 的 `## 自动化授权` 节（见[自动化授权](../../references/automation-authorization.md#记录)）。`已开启` 不含 `privacy-info-fill` 时，个人信息栏全部留给用户本人填写，Agent 只继续填其他栏目。

## 字段分类表（与 application-content-fill 的分界）

本表是“个人信息栏”与普通内容的唯一分界。只有标为 **本子Skill** 的字段受开启状态约束；其余字段即使本子Skill未开启，也由内容填写子Skill正常处理。

| 类别 | 例子 | 归属 | 未开启本子Skill时 |
|---|---|---|---|
| 简历基本身份与学历 | 姓名、性别（简历写明时）、学校、专业、学历、毕业时间 | application-content-fill | 照常由 Agent 按简历填写 |
| 联系方式 | 手机号、邮箱、微信号 | **本子Skill** | 留给用户本人填写 |
| 居住与家庭信息 | 家庭住址、现居地、家庭所在城市、户籍/籍贯、紧急联系人 | **本子Skill** | 留给用户本人填写 |
| 敏感身份属性 | 民族、政治面貌、婚育、健康状况 | **本子Skill** | 留给用户本人填写 |
| 求职意向与条件 | 期望薪资、到岗时间、实习时长、是否接受调剂、意向城市 | application-content-fill（按材料与用户答复；缺失按公司汇总询问） | 照常处理；志愿/调剂仍是用户选择项 |
| 证件号码 | 身份证号、护照号、港澳通行证号 | 用户本人 | 始终由用户本人输入 |
| 金融或账户信息 | 银行卡号、支付账户 | 用户本人 | 说明并交用户 |

## 信息来源分级

| 类别 | 例子 | 处理 |
|---|---|---|
| 简历或[个人信息档案](../personal-info-vault/SKILL.md)里已有 | 手机号、邮箱、学校所在城市、GitHub 等 | 按原文填写，逐项读回 |
| 简历里没有，但可由用户提供 | 家庭住址、家庭所在城市、紧急联系人、民族、政治面貌等 | 先查个人信息档案；仍缺失的按公司汇总一次向用户索取，回复后立即用 `scripts/profile_vault.py add` 写入档案，再用 `fill_plan.py vault-sync` 把填写方案里等待中的字段改回待填（档案里没有这一项时脚本不允许改） |
| 证件号码 | 身份证号、护照号、港澳通行证号等 | **始终由用户本人在页面输入**。Agent 不代填、不保存、不复述；页面停在该栏并提示用户 |
| 金融或账户信息 | 银行卡号、支付账户 | 招聘网申通常不需要；出现时说明并交给用户 |

## 规则

- 只用用户提供或简历中写明的事实，不推断（例如不能用学校城市推断家庭城市，不能用掩码号码补全）。
- 先打开下拉/级联查看实际选项再选择，读回所选值；遵循父Skill的控件盘点规则。
- 页面因证件号缺失而无法保存其他栏目时，先把其他内容填好但不刷新页面，然后请用户填写证件号并保存，再继续。
- 读回或截图时如果页面显示了证件号等信息，不把它写进任何文件、审核包、日志或回复；截图需遮挡或避开。
- 用户提供的新信息按[个人信息档案](../personal-info-vault/SKILL.md)写入用户本地档案，不进入公开 Skill、Issue、测试样例或 GitHub。

## 返回

已填字段清单（不含敏感原文）、待用户提供的信息、待用户本人填写的证件栏。
