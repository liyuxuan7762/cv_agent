# Epic 10：名校标签体系

## Issue 02：将名校标签查询接入 n8n Webhook

### 背景

在 Epic 10 / Issue 01 完成后，`candidate_search_index` 已具备 `matched_schools` 和 `school_tags` 字段，并能通过 SQL 查询命中 `985`、`C9`、`双一流` 等标签的候选人。

本 Issue 的目标是将名校标签查询接入 n8n Webhook，使用户能够通过自然语言问题触发名校标签筛选，并返回压缩后的候选人列表。

该阶段的实现模式与 Epic 05 / Issue 02（公司标签接入 n8n）完全对称。

---

### 目标

创建或扩展 n8n 工作流，使其能够：

1. 从用户问题中识别名校相关关键词。
2. 将关键词归一化为标准 `school_tags` 值。
3. 使用参数化 SQL 查询 `candidate_search_index`。
4. 返回命中名校标签的候选人压缩列表。
5. 支持与技能条件组合查询（可选，作为扩展验证）。
6. 全流程不调用 LLM。

---

### 范围

#### 包含

- 在 n8n Code 节点中增加名校标签识别规则。
- 支持识别以下关键词并归一化：
  - `985` / `985高校` / `985院校` → `985`
  - `211` / `211高校` / `211院校` → `211`
  - `双一流` → `双一流`
  - `C9` / `c9` → `C9`
  - `名校` → `985`（兜底映射）
- 使用参数化 SQL 查询 `school_tags`。
- 返回候选人基础信息、`matched_schools`、`school_tags`。
- 对无法识别名校条件的情况返回可解释提示。
- 验证与技能条件的组合查询（可选）。

#### 不包含

- 不处理具体学校名称查询（如"找清华毕业的候选人"），留给后续扩展。
- 不处理"海外名校"标签。
- 不做学校排名动态更新。
- 不调用 LLM。
- 不让 LLM 判断学校是否为名校。
- 不返回 `full_text`、`experience_if` 或完整简历。

---

### 前置条件

- Epic 10 / Issue 01 已完成：
  - `school_dictionary` 已创建。
  - `candidate_search_index` 包含 `matched_schools` 和 `school_tags` 字段。
  - 能通过 SQL 查询到 `school_tags` 包含 `985` 的候选人。
- Epic 05 / Issue 02 已完成：n8n 公司标签查询链路可参考。
- n8n 已配置 PostgreSQL Credential。
- Webhook 到 PostgreSQL 的链路稳定可用。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Code: 从 question 中识别名校标签并归一化
  ↓
Postgres: 按 must_school_tags 查询 candidate_search_index
  ↓
Code: 压缩返回字段
  ↓
Respond to Webhook
```

---

### 名校标签识别规则

#### Code 节点示例

```javascript
const question = $json.body?.question || $json.question || '';
const lower = question.toLowerCase();

const schoolTags = [];

// C9 联盟
if (lower.includes('c9')) {
  schoolTags.push('C9');
}

// 985
if (
  question.includes('985') ||
  question.includes('985高校') ||
  question.includes('985院校')
) {
  schoolTags.push('985');
}

// 211
if (
  question.includes('211') ||
  question.includes('211高校') ||
  question.includes('211院校')
) {
  schoolTags.push('211');
}

// 双一流
if (question.includes('双一流')) {
  schoolTags.push('双一流');
}

// 名校 → 兜底映射为 985
if (question.includes('名校') && schoolTags.length === 0) {
  schoolTags.push('985');
}

const normalizedSchoolTags = [...new Set(schoolTags)];

return [{
  json: {
    question,
    must_school_tags: normalizedSchoolTags,
    limit: 10,
    has_query: normalizedSchoolTags.length > 0
  }
}];
```

#### 归一化映射表

| 用户输入 | 标准 `school_tags` 值 |
|---|---|
| `C9` / `c9` | `C9` |
| `985` / `985高校` / `985院校` | `985` |
| `211` / `211高校` / `211院校` | `211` |
| `双一流` | `双一流` |
| `名校`（无其他标签时） | `985` |

---

### PostgreSQL 查询节点

节点名称建议：

```text
Query Candidates By School Tags
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
  highest_degree,
  latest_company,
  latest_title,
  matched_skills,
  matched_schools,
  school_tags
FROM candidate_search_index
WHERE school_tags && $1::text[]
ORDER BY applied_at DESC
LIMIT $2;
```

参数示例：

```json
[
  ["985"],
  10
]
```

注意：

- 不要查询 `full_text`。
- 不要查询 `candidate_resumes.experience_if`。
- 不要拼接用户输入到 SQL。

---

### 返回格式化 Code 节点

节点名称建议：

```text
Format School Tag Search Result
```

返回结构建议：

```json
{
  "success": true,
  "stage": "epic10_school_tag_search",
  "query": {
    "question": "找 985 高校毕业的候选人",
    "must_school_tags": ["985"],
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
      "highest_degree": "本科",
      "latest_company": "某科技公司",
      "latest_title": "高级Java开发工程师",
      "matched_skills": ["Java", "Spring Boot"],
      "matched_schools": ["清华大学"],
      "school_tags": ["985", "211", "双一流", "C9"]
    }
  ]
}
```

候选人字段只保留：

- `user_id`
- `name`
- `gender`
- `birthdate`
- `aim_salary`
- `applied_at`
- `highest_degree`
- `latest_company`
- `latest_title`
- `matched_skills`
- `matched_schools`
- `school_tags`

不返回：

- `full_text`
- `experience_if`
- `personal`
- `matched_companies`（名校查询场景暂不需要）

---

### 无条件保护

当 `must_school_tags` 为空时，不查询全部候选人，返回可解释提示：

```json
{
  "success": false,
  "stage": "epic10_school_tag_search",
  "message": "当前问题中未识别到名校标签，请输入 985、211、双一流、C9 或名校等关键词。",
  "query": {
    "must_school_tags": [],
    "limit": 10
  },
  "candidates": []
}
```

---

### 实施步骤

#### 1. 创建 n8n 工作流

建议新建工作流，或基于已有公司标签查询工作流复制。

Webhook 配置建议：

```text
HTTP Method: POST
Path: candidate-search-school-tag
Response Mode: Using 'Respond to Webhook' node
```

---

#### 2. 添加名校标签识别 Code 节点

节点名称建议：

```text
Parse School Tag Rules
```

使用上文的 Code 示例实现。

---

#### 3. 添加无条件保护分支（可选 IF 节点）

判断 `has_query == true`：

- `true`：继续执行 PostgreSQL 查询。
- `false`：直接返回提示，不查询数据库。

---

#### 4. 添加 PostgreSQL 查询节点

使用上文 SQL，参数来自上游 Code 节点的 `must_school_tags` 和 `limit`。

---

#### 5. 添加返回格式化 Code 节点

只保留上文定义的候选人字段，不返回大文本字段。

---

#### 6. 添加 Respond to Webhook 节点

---

### 验收测试

#### 测试用例 1：985 高校查询

请求：

```json
{
  "question": "找 985 高校毕业的候选人"
}
```

预期：

- `must_school_tags` 为 `["985"]`。
- 返回候选人的 `school_tags` 包含 `985`。
- 返回结果包含 `matched_schools`。

---

#### 测试用例 2：C9 查询

请求：

```json
{
  "question": "优先考虑 C9 院校毕业的候选人"
}
```

预期：

- `must_school_tags` 为 `["C9"]`。
- 返回候选人的 `school_tags` 包含 `C9`。
- `matched_schools` 中能看到 C9 高校之一。

---

#### 测试用例 3：双一流查询

请求：

```json
{
  "question": "找双一流高校毕业的 Java 候选人"
}
```

预期：

- `must_school_tags` 包含 `双一流`。
- 返回候选人的 `school_tags` 包含 `双一流`。

---

#### 测试用例 4：名校兜底映射

请求：

```json
{
  "question": "找名校毕业的候选人"
}
```

预期：

- `must_school_tags` 为 `["985"]`（兜底映射）。
- 返回候选人的 `school_tags` 包含 `985`。

---

#### 测试用例 5：无法识别名校条件

请求：

```json
{
  "question": "找有工作经验的候选人"
}
```

预期：

- `must_school_tags` 为空数组。
- 不查询全部候选人。
- 返回可解释提示。
- `candidates` 为空数组。

---

#### 测试用例 6（可选）：名校 + 技能组合查询

请求：

```json
{
  "question": "找 985 高校毕业，并且有 Spring Boot 经验的候选人"
}
```

手工验证 SQL：

```sql
SELECT
  user_id,
  name,
  matched_skills,
  matched_schools,
  school_tags
FROM candidate_search_index
WHERE school_tags && ARRAY['985']::text[]
  AND matched_skills && ARRAY['Spring Boot']::text[]
ORDER BY applied_at DESC
LIMIT 10;
```

预期：返回同时命中 `985` 和 `Spring Boot` 的候选人。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n Webhook 能接收名校标签查询请求。
- Code 节点能识别并归一化 `985`、`211`、`双一流`、`C9`、`名校`。
- PostgreSQL 查询使用参数化 SQL。
- SQL 使用 `school_tags && $1::text[]` 作为过滤条件。
- Webhook 能返回命中名校标签的候选人。
- 返回结果包含 `matched_schools` 和 `school_tags`。
- 返回结果包含 `highest_degree`。
- 返回结果不包含 `full_text`。
- 返回结果不包含 `experience_if`。
- 返回结果不包含 `personal`。
- 无法识别名校条件时不返回全量候选人。
- 全流程不调用 LLM。

---

### 手工验证 SQL 汇总

```sql
-- 985 召回
SELECT user_id, name, matched_schools, school_tags
FROM candidate_search_index
WHERE school_tags && ARRAY['985']::text[]
LIMIT 10;

-- C9 召回
SELECT user_id, name, matched_schools, school_tags
FROM candidate_search_index
WHERE school_tags && ARRAY['C9']::text[]
LIMIT 10;

-- 双一流召回
SELECT user_id, name, matched_schools, school_tags
FROM candidate_search_index
WHERE school_tags && ARRAY['双一流']::text[]
LIMIT 10;

-- 名校 + Spring Boot 组合
SELECT user_id, name, matched_skills, matched_schools, school_tags
FROM candidate_search_index
WHERE school_tags && ARRAY['985']::text[]
  AND matched_skills && ARRAY['Spring Boot']::text[]
ORDER BY applied_at DESC
LIMIT 10;
```

---

### 测试记录模板

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. 985 高校查询测试结果：
4. C9 查询测试结果：
5. 双一流查询测试结果：
6. 名校兜底映射测试结果：
7. 无法识别条件测试结果：
8. 返回候选人数：
9. matched_schools 抽样结果：
10. school_tags 抽样结果：
11. 是否包含 full_text：
12. 是否包含 experience_if：
13. 是否调用 LLM：
14. 遗留问题：
```

---

### 风险与注意事项

- `名校` 兜底映射为 `985` 是当前阶段的简化处理，如用于真实业务应与 HR 确认映射规则。
- 学校别名短词（如"交大"）可能在多所学校间产生歧义，当前阶段 `full_text` 匹配时需注意。
- `school_tags` 应来自字典，不应由用户输入或 LLM 直接生成。
- 返回字段继续保持克制，不返回完整简历或大段原文。
- 如后续引入 LLM Query Parser（Epic 09），应在归一化规则中同步支持名校标签。

---

### 下一步

通过本 Issue 后，Epic 10 名校标签体系完成。

后续可考虑：

- 在 Epic 09 LLM Query Parser 的归一化规则中补充名校标签支持。
- 扩展学校字典，增加更多 211 高校或海外名校。
- 支持"具体学校名称"查询，例如"找清华大学毕业的候选人"。