# 双通道公司批次

新批次从 `company_batch_create({rolesFile|companyPlan,authorizationRef})` 开始。此接口在 MCP 内消费已确认 JSON、取出未提交公司及岗位并冻结次序，不转换 Excel。再调用 `company_batch_take({batchId,batchHash})` 原子领取、切分任务。默认 `companiesPerChannel=10`，Chrome 与 IAB 各至多十家公司；不是每家公司十个岗位或每个窗口十页。实际页面上限另行管理。

同公司全部岗位属于一个公司任务；目录中已核实的 `loginScope`（否则为公司 origin）固定在同一通道。平台共享登录必须有资产依据，不能仅因为同为飞书域名就合并账号。保持公司与岗位的用户次序，不把分配通道的枚举次序改写为志愿顺序。公司间独立推进；同账号登录只做一次，再复核各岗位页身份。

返回任务必须由相应宿主执行器真正执行：Chrome 使用管理中的独立浏览器 broker；IAB 使用宿主内置浏览器接口。两个登录态不交换 Cookie。MCP 不伪装拥有 IAB，也不把 `browserExecuted:false` 改成完成。没有对应宿主执行能力时记录具体阻塞，不自动改为 Chrome。

`company_batch_record` 绑定公司、通道与租约令牌，可记录 running、waiting_for_user、blocked；ready_for_user_review 必须绑定实际 MCP 填写运行，覆盖公司全部岗位的当前页面核验。blocked 必须给出原因。租约过期转受阻，不自动重试验证码或原页面。`company_batch_status` 返回各公司状态且隐藏租约令牌。最终提交始终不在本轮准备接口中。

采集支持 `capture_controls({companyId,pageUrl,compact:true})`。完整控件快照保存在私有 runs；返回 captureId、结构数量及与前一快照的差异。重复条目合并结构比较，位置变化不强制重新建库；类型、必填、选项和渲染器的变化仍列为差异。结构匹配率不等于填写成功率，不替代条件分支和独立读回。
