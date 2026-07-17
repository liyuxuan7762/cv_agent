# Epic 01：基础数据与端到端链路准备

## 状态
已完成

## Issue 02：打通 n8n Webhook 到 PostgreSQL 的最小查询链路

### 背景

在确认 `candidate_resumes` 原始简历数据可用后，下一步需要验证 n8n 是否能够通过 Webhook 接收请求，并成功连接 PostgreSQL 查询数据。

本 Issue 对应 MVP 计划中的：

- Step 1：先做最简单的 n8n Webhook 查询原始表

该阶段仍然不做智能检索，不创建索引，不使用 LLM，只验证从外部请求到 n8n，再到 PostgreSQL，再返回 Webhook 响应的最小端到端链路。

---

### 目标

创建一个最小 n8n 工作流，使其能够：

1. 通过 Webhook 接收测试请求。
2. 使用 PostgreSQL 节点查询 `candidate_resumes` 原始表前 5 条基础信息。
3. 通过 Respond to Webhook 返回查询结果。
4. 确认 n8n 与数据库之间的连接、权限、网络和凭据配置正常。

---

### 范围

#### 包含

- 创建 n8n Webhook 节点。
- 配置 PostgreSQL 数据库连接凭据。
- 在 PostgreSQL 节点执行固定 SQL 查询。
- 使用 Respond to Webhook 返回查询结果。
- 只返回候选人基础字段。
- 使用固定测试输入验证链路。

#### 不包含

- 不解析用户问题。
- 不查询 `experience_if`。
- 不返回完整简历。
- 不创建或查询 `candidate_search_index`。
- 不创建技能字典或公司字典。
- 不做技能归一化。
- 不做候选人打分或排序逻辑之外的复杂处理。
- 不调用 LLM。

---

### 前置条件

- Issue 01 已完成并验收通过。
- `candidate_resumes` 表中已有 500 条测试数据。
- n8n 服务可访问。
- n8n 能配置 PostgreSQL Credential。
- PostgreSQL 用户具备读取 `candidate_resumes` 表的权限。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Postgres: SELECT 原始表前 5 条
  ↓
Respond to Webhook
```

---

### 实施步骤

#### 1. 创建 Webhook 节点

在 n8n 中创建一个新工作流，添加 `Webhook` 节点。

建议配置：

```text
HTTP Method: POST
Path: candidate-basic-search
Response Mode: Using 'Respond to Webhook' node
```

Webhook 测试输入：

```json
{
  "question": "最近投递的候选人"
}
```

说明：

- 当前阶段可以接收 `question` 字段，但不解析该字段。
- 该字段只用于验证请求体能正常进入 n8n。

---

#### 2. 创建 PostgreSQL 查询节点

在 Webhook 节点之后添加 PostgreSQL 节点。

节点职责：

- 连接 PostgreSQL。
- 查询 `candidate_resumes` 原始表。
- 返回最近投递的 5 条候选人基础信息。

测试 SQL：

```sql
SELECT
  user_id,
  name,
  gender,
  birthdate,
  aim_salary,
  applied_at
FROM candidate_resumes
ORDER BY applied_at DESC
LIMIT 5;
```

注意：

- 不要查询 `experience_if`。
- 不要查询 `personal`。
- 不要返回完整简历文本。
- 不要在该 SQL 中加入动态拼接条件。

---

#### 3. 创建 Respond to Webhook 节点

在 PostgreSQL 节点之后添加 `Respond to Webhook` 节点。

建议返回结构：

```json
{
  "success": true,
  "stage": "step_1_basic_webhook_postgres_query",
  "question": "最近投递的候选人",
  "count": 5,
  "candidates": [
    {
      "user_id": "U000001",
      "name": "示例姓名",
      "gender": "男",
      "birthdate": "1995-01-01",
      "aim_salary": "30000元/月",
      "applied_at": "2026-07-10T10:00:00.000Z"
    }
  ]
}
```

说明：

- 实际返回值以数据库查询结果为准。
- `question` 可从 Webhook 输入中透传，便于调试。
- `count` 可由返回数组长度计算，也可以先由 n8n 默认输出结果判断。

---

### 验收测试

#### 测试请求

向 n8n Webhook 发送 POST 请求：

```json
{
  "question": "最近投递的候选人"
}
```

#### 预期结果

Webhook 返回 5 条候选人基础信息，字段包括：

- `user_id`
- `name`
- `gender`
- `birthdate`
- `aim_salary`
- `applied_at`

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n Webhook 能成功接收 POST 请求。
- n8n PostgreSQL 节点能成功连接数据库。
- PostgreSQL 节点能执行固定 SQL。
- Webhook 能返回 5 条候选人基础信息。
- 返回结果不包含 `experience_if`。
- 返回结果不包含 `personal`。
- 返回结果不包含完整简历文本。
- 工作流不调用 LLM。
- 工作流不依赖 `candidate_search_index`。
- 即使用户输入 `question`，当前阶段也不解析自然语言。

---

### 调试建议

#### 1. Webhook 没有响应

检查：

- n8n 工作流是否处于测试监听状态或已激活。
- Webhook URL 是否正确。
- HTTP Method 是否为 POST。
- Response Mode 是否设置为通过 `Respond to Webhook` 节点返回。

#### 2. PostgreSQL 连接失败

检查：

- 数据库 Host、Port、Database、User、Password 是否正确。
- n8n 运行环境是否能访问 PostgreSQL。
- PostgreSQL 是否允许该用户远程连接。
- 数据库用户是否具备 `SELECT` 权限。

#### 3. SQL 执行失败

检查：

- `candidate_resumes` 表是否存在。
- 字段名是否与 SQL 一致。
- `applied_at` 字段是否存在并可排序。
- Issue 01 是否已经完成数据生成。

#### 4. 返回字段过多

检查：

- PostgreSQL 节点 SQL 是否只选择了指定字段。
- Respond to Webhook 节点是否直接返回了完整上游数据。
- 是否误选了 `experience_if` 或 `personal` 字段。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. PostgreSQL Credential：
4. 测试请求：
5. 返回候选人数：
6. 返回字段检查：
7. 是否包含 experience_if：
8. 是否包含 personal：
9. 遗留问题：
```

---

### 风险与注意事项

- 当前阶段目标是验证链路，不要提前加入技能识别、公司识别或 LLM。
- Webhook 返回字段必须保持克制，避免形成“先查出完整简历再交给 AI”的坏模式。
- PostgreSQL 查询应使用固定 SQL，不应由用户输入直接拼接。
- 如果该阶段连接不稳定，后续所有 n8n 检索流程都会受到影响，应优先解决。
- 建议在测试环境完成验证后，再考虑是否迁移到正式 n8n 工作流。

---

### 下一步

通过本 Issue 后，再进入下一个 Issue：创建最小技能字典，先解决 `Spring Boot` / `Springboot` 归一化问题。