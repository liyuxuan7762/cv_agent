# Epic 03：n8n 固定技能检索链路

## 状态
已完成

## Issue 01：将固定 Spring Boot 技能索引查询接入 n8n Webhook

### 背景

在 `candidate_search_index` 已经能够基于 `matched_skills` 查询候选人后，下一步需要把技能索引查询接入 n8n Webhook。

本 Issue 对应 MVP 计划中的：

- Step 4：把技能索引查询接入 n8n Webhook，不使用 LLM

该阶段的重点不是理解用户问题，而是验证 n8n 能否调用 `candidate_search_index` 完成一次固定技能查询，并返回经过压缩的候选人列表。

---

### 目标

创建一个 n8n 工作流，使其能够：

1. 通过 Webhook 接收用户请求。
2. 在 Code 节点中固定设置查询参数：`must_skills = ['Spring Boot']`。
3. 使用 PostgreSQL 查询 `candidate_search_index`。
4. 返回 Top 10 候选人基础信息和命中技能。
5. 确保返回结果不包含 `full_text`、`experience_if` 或完整简历原文。

---

### 范围

#### 包含

- 创建或复制一个新的 n8n Webhook 工作流。
- 添加 Code 节点，固定生成 `must_skills` 参数。
- 添加 PostgreSQL 节点，查询 `candidate_search_index`。
- 添加 Code 节点，压缩返回字段。
- 使用 Respond to Webhook 返回结果。
- 使用固定测试问题验证链路。

#### 不包含

- 不解析用户输入中的技能。
- 不识别 `Springboot`、`spring boot` 等不同写法。
- 不查询 `skill_dictionary`。
- 不做 `related_terms` 扩展。
- 不做复杂打分。
- 不处理公司标签。
- 不调用 LLM。
- 不返回 `full_text`。
- 不返回 `experience_if`。

---

### 前置条件

- Epic 01 / Issue 02 已完成：n8n 到 PostgreSQL 的最小链路可用。
- Epic 02 / Issue 01 已完成：`skill_dictionary` 已创建。
- Epic 02 / Issue 02 已完成：`candidate_search_index` 已构建，并能通过 SQL 查询 `Spring Boot` 候选人。
- n8n 已配置 PostgreSQL Credential。
- PostgreSQL 用户具备读取 `candidate_search_index` 表的权限。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Code: 固定参数 must_skills = ['Spring Boot']
  ↓
Postgres: 查询 candidate_search_index
  ↓
Code: 压缩返回字段
  ↓
Respond to Webhook
```

---

### 实施步骤

#### 1. 创建 Webhook 节点

建议新建工作流，或复制 Epic 01 / Issue 02 中的基础 Webhook 工作流。

建议配置：

```text
HTTP Method: POST
Path: candidate-search-fixed-skill
Response Mode: Using 'Respond to Webhook' node
```

测试输入：

```json
{
  "question": "找有 Springboot 经验的候选人"
}
```

说明：

- 当前阶段允许用户输入 `Springboot`。
- 但工作流暂时不解析 `question`。
- 查询参数固定为标准技能名 `Spring Boot`。

---

#### 2. 添加 Code 节点生成固定查询参数

在 Webhook 节点后添加 Code 节点。

节点名称建议：

```text
Build Fixed Skill Query Params
```

Code 示例：

```javascript
const question = $json.body?.question || $json.question || '';

return [{
  json: {
    question,
    must_skills: ['Spring Boot'],
    limit: 10
  }
}];
```

输出示例：

```json
{
  "question": "找有 Springboot 经验的候选人",
  "must_skills": ["Spring Boot"],
  "limit": 10
}
```

---

#### 3. 添加 PostgreSQL 查询节点

在 Code 节点后添加 PostgreSQL 节点。

节点名称建议：

```text
Query Candidates By Fixed Skill
```

SQL：

```sql
SELECT
  user_id,
  name,
  gender,
  birthdate,
  aim_salary,
  applied_at,
  latest_company,
  latest_title,
  matched_skills
FROM candidate_search_index
WHERE matched_skills && ARRAY['Spring Boot']::text[]
ORDER BY applied_at DESC
LIMIT 10;
```

注意：

- 本 Issue 可以先使用固定 SQL。
- 不要把用户输入拼接进 SQL。
- 不要查询 `full_text`。
- 不要查询原始表 `candidate_resumes.experience_if`。

---

#### 4. 添加 Code 节点压缩返回字段

在 PostgreSQL 节点后添加 Code 节点。

节点名称建议：

```text
Format Candidate List
```

Code 示例：

```javascript
const candidates = items.map(item => ({
  user_id: item.json.user_id,
  name: item.json.name,
  gender: item.json.gender,
  birthdate: item.json.birthdate,
  aim_salary: item.json.aim_salary,
  applied_at: item.json.applied_at,
  latest_company: item.json.latest_company,
  latest_title: item.json.latest_title,
  matched_skills: item.json.matched_skills
}));

return [{
  json: {
    success: true,
    stage: 'step_4_fixed_spring_boot_skill_search',
    query: {
      must_skills: ['Spring Boot'],
      limit: 10
    },
    count: candidates.length,
    candidates
  }
}];
```

说明：

- 该节点只保留列表展示所需字段。
- 不要把 PostgreSQL 节点中的全部原始输出直接返回。
- 即使后续索引表包含 `full_text`，也不应返回。

---

#### 5. 添加 Respond to Webhook 节点

在格式化 Code 节点后添加 `Respond to Webhook` 节点。

响应体直接使用上游 Code 节点输出。

预期响应结构：

```json
{
  "success": true,
  "stage": "step_4_fixed_spring_boot_skill_search",
  "query": {
    "must_skills": ["Spring Boot"],
    "limit": 10
  },
  "count": 10,
  "candidates": [
    {
      "user_id": "U000123",
      "name": "张伟",
      "gender": "男",
      "birthdate": "1995-04-12",
      "aim_salary": "30000元/月",
      "applied_at": "2026-07-10T10:00:00.000Z",
      "latest_company": "某科技公司",
      "latest_title": "Java开发工程师",
      "matched_skills": ["Java", "Spring Boot", "微服务"]
    }
  ]
}
```

---

### 验收测试

#### 测试请求

向 n8n Webhook 发送 POST 请求：

```json
{
  "question": "找有 Springboot 经验的候选人"
}
```

#### 预期结果

- Webhook 返回最多 10 条候选人。
- 每条候选人包含基础信息、最近公司、最近职位和 `matched_skills`。
- 候选人的 `matched_skills` 应包含 `Spring Boot`。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n Webhook 能成功接收请求。
- Code 节点能固定生成 `must_skills = ['Spring Boot']`。
- PostgreSQL 节点能查询 `candidate_search_index`。
- Webhook 能返回 Top 10 候选人。
- 返回候选人的 `matched_skills` 包含 `Spring Boot`。
- 返回字段不包含 `full_text`。
- 返回字段不包含 `experience_if`。
- 返回字段不包含 `personal`。
- 不调用 LLM。
- 不解析用户输入。
- 不依赖动态 SQL 拼接。

---

### 调试建议

#### 1. 返回 0 条候选人

检查：

- `candidate_search_index` 是否已构建。
- 是否存在 `matched_skills` 包含 `Spring Boot` 的记录。
- 可先手工执行：

```sql
SELECT COUNT(*)
FROM candidate_search_index
WHERE matched_skills && ARRAY['Spring Boot']::text[];
```

#### 2. PostgreSQL 节点报类型错误

检查：

- `matched_skills` 字段是否为 `TEXT[]`。
- SQL 中是否使用 `ARRAY['Spring Boot']::text[]`。

#### 3. 返回字段包含敏感大文本

检查：

- PostgreSQL SQL 是否误选了 `full_text`。
- 是否误查了 `candidate_resumes` 原始表。
- 格式化 Code 节点是否直接返回了完整 `item.json`。

#### 4. Webhook 输入中的 `Springboot` 没有被解析

这是当前阶段的预期行为。

本阶段固定查询 `Spring Boot`，自然语言解析将在后续 Issue 中实现。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. 测试请求：
4. 返回候选人数：
5. 是否全部命中 Spring Boot：
6. 是否包含 full_text：
7. 是否包含 experience_if：
8. 是否调用 LLM：
9. 遗留问题：
```

---

### 风险与注意事项

- 当前阶段不要因为用户输入了 `Springboot` 就提前实现解析逻辑。
- 固定参数查询的价值在于验证 n8n 与索引表之间的端到端链路。
- 返回字段必须严格控制，避免把完整索引文本或完整简历暴露给后续节点。
- 如果该阶段不稳定，不应继续推进自然语言解析或 LLM。
- SQL 应保持固定，不要由用户输入拼接生成。

---

### 下一步

通过本 Issue 后，再进入下一个 Issue：在 n8n Code 节点中加入最小归一化规则，识别 `Springboot`、`spring boot`、`Spring Boot` 并统一查询 `Spring Boot`。