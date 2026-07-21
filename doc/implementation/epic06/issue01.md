# Epic 06：技能条件与公司标签组合检索

## 状态
已完成

## Issue 01：支持 Spring Boot 技能与国内大厂公司标签组合查询

### 背景

当前系统已经分别具备以下能力：

- 通过规则识别技能条件，例如 `Springboot`、`spring boot`、`Spring Boot` 并归一化为 `Spring Boot`。
- 通过技能索引查询候选人。
- 通过公司字典和索引识别 `国内大厂`、`互联网大厂` 标签。
- 通过 n8n Webhook 单独查询公司标签候选人。

下一步需要将技能条件和公司标签条件组合起来，支持第一个真正具备业务价值的组合查询。

本 Issue 对应 MVP 计划中的：

- Step 9：组合技能条件和公司标签条件

示例问题：

```text
找有 Springboot 经验，并且有国内大厂工作经验的候选人
```

该阶段仍不使用 LLM，只通过规则解析、固定 SQL 模板和参数化查询完成组合检索。

---

### 目标

创建或改造 n8n 工作流，使其能够：

1. 从用户问题中识别技能条件。
2. 从用户问题中识别公司标签条件。
3. 将技能条件归一化为 `must_skills`。
4. 将公司标签条件归一化为 `must_company_tags`。
5. 使用固定 SQL 模板查询 `candidate_search_index`。
6. 返回同时命中技能和公司标签的候选人。
7. 返回命中技能、命中公司、命中标签和简单分数。
8. 不返回完整简历原文。
9. 不调用 LLM。

---

### 范围

#### 包含

- 在 n8n Code 节点中组合已有技能解析规则和公司标签解析规则。
- 支持识别 `Springboot`、`springboot`、`spring boot`、`Spring Boot`。
- 支持识别 `Java`、`java后端`、`Java后端`。
- 支持识别 `国内大厂`、`互联网大厂`。
- 输出 `must_skills` 和 `must_company_tags`。
- 使用 SQL 同时过滤 `matched_skills` 和 `company_tags`。
- 返回 `matched_skills`、`matched_companies`、`company_tags` 和 `score`。
- 对缺少必要查询条件的情况返回可解释提示。

#### 不包含

- 不处理 `世界500强`。
- 不处理详情查询。
- 不调用 LLM 生成回答。
- 不使用 LLM Query Parser。
- 不让 LLM 生成 SQL。
- 不处理复杂布尔逻辑，例如“或者”“排除”。
- 不处理复杂偏好条件，例如“最好”“优先”作为 should 条件。
- 不返回 `full_text`。
- 不返回 `experience_if`。
- 不返回完整简历。

---

### 前置条件

- Epic 03 / Issue 02 已完成：n8n 能进行最小技能规则解析。
- Epic 05 / Issue 02 已完成：n8n 能进行公司标签规则解析。
- `candidate_search_index` 中存在以下字段：
  - `matched_skills`
  - `matched_companies`
  - `company_tags`
- `matched_skills` 类型为 `TEXT[]`。
- `company_tags` 类型为 `TEXT[]`。
- 可以通过 SQL 单独查询到 `Spring Boot` 候选人。
- 可以通过 SQL 单独查询到 `国内大厂` 候选人。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Code: 规则解析 question，得到 must_skills / must_company_tags
  ↓
Postgres: 组合查询并打分
  ↓
Code: 生成命中原因并压缩返回字段
  ↓
Respond to Webhook
```

---

### 解析规则

#### 技能规则

沿用前序 Issue 的最小规则：

```javascript
const mustSkills = [];
const lower = question.toLowerCase();

if (
  lower.includes('springboot') ||
  lower.includes('spring boot') ||
  question.includes('Spring Boot')
) {
  mustSkills.push('Spring Boot');
}

if (
  question.includes('Java') ||
  question.includes('java后端') ||
  question.includes('Java后端')
) {
  mustSkills.push('Java');
}
```

#### 公司标签规则

沿用前序 Issue 的最小规则：

```javascript
const companyTags = [];

if (question.includes('国内大厂') || question.includes('互联网大厂')) {
  companyTags.push('国内大厂', '互联网大厂');
}
```

#### 输出结构

解析 Code 节点建议输出：

```json
{
  "question": "找有 Springboot 经验，并且有国内大厂工作经验的候选人",
  "must_skills": ["Spring Boot"],
  "must_company_tags": ["国内大厂", "互联网大厂"],
  "limit": 10,
  "has_query": true
}
```

---

### 实施步骤

#### 1. 创建或复制 n8n 工作流

建议基于已有技能查询或公司标签查询工作流复制一个新工作流。

建议 Webhook 配置：

```text
HTTP Method: POST
Path: candidate-search-skill-company
Response Mode: Using 'Respond to Webhook' node
```

测试输入：

```json
{
  "question": "找有 Springboot 经验，并且有国内大厂工作经验的候选人"
}
```

---

#### 2. 添加组合解析 Code 节点

节点名称建议：

```text
Parse Skill And Company Rules
```

Code 示例：

```javascript
const question = $json.body?.question || $json.question || '';
const lower = question.toLowerCase();

const mustSkills = [];
const companyTags = [];

if (
  lower.includes('springboot') ||
  lower.includes('spring boot') ||
  question.includes('Spring Boot')
) {
  mustSkills.push('Spring Boot');
}

if (
  question.includes('Java') ||
  question.includes('java后端') ||
  question.includes('Java后端')
) {
  mustSkills.push('Java');
}

if (question.includes('国内大厂') || question.includes('互联网大厂')) {
  companyTags.push('国内大厂', '互联网大厂');
}

const normalizedMustSkills = [...new Set(mustSkills)];
const normalizedCompanyTags = [...new Set(companyTags)];

return [{
  json: {
    question,
    must_skills: normalizedMustSkills,
    must_company_tags: normalizedCompanyTags,
    limit: 10,
    has_query: normalizedMustSkills.length > 0 && normalizedCompanyTags.length > 0
  }
}];
```

---

#### 3. 增加条件缺失保护

当前 Issue 的目标是组合查询，因此必须同时具备：

- 至少一个 `must_skills`
- 至少一个 `must_company_tags`

如果任一为空，不应退化为单条件查询，也不应查询全部候选人。

推荐返回结构：

```json
{
  "success": false,
  "stage": "step_9_skill_company_combined_search",
  "message": "当前组合查询需要同时包含可识别技能和公司标签，例如：找有 Spring Boot 经验，并且有国内大厂工作经验的候选人。",
  "query": {
    "must_skills": [],
    "must_company_tags": [],
    "limit": 10
  },
  "candidates": []
}
```

说明：

- 单独技能查询仍由前序技能工作流处理。
- 单独公司标签查询仍由前序公司标签工作流处理。
- 本 Issue 只验证组合查询链路。

---

#### 4. 添加 PostgreSQL 组合查询节点

节点名称建议：

```text
Query Candidates By Skill And Company
```

SQL：

```sql
WITH query_params AS (
  SELECT
    $1::text[] AS must_skills,
    $2::text[] AS must_company_tags
),
scored AS (
  SELECT
    c.user_id,
    c.name,
    c.gender,
    c.birthdate,
    c.aim_salary,
    c.applied_at,
    c.latest_company,
    c.latest_title,
    c.matched_skills,
    c.matched_companies,
    c.company_tags,
    (
      CASE WHEN c.matched_skills && q.must_skills THEN 100 ELSE 0 END +
      CASE WHEN c.company_tags && q.must_company_tags THEN 100 ELSE 0 END
    ) AS score
  FROM candidate_search_index c
  CROSS JOIN query_params q
  WHERE
    c.matched_skills && q.must_skills
    AND c.company_tags && q.must_company_tags
)
SELECT *
FROM scored
ORDER BY score DESC, applied_at DESC
LIMIT $3;
```

参数示例：

```json
[
  ["Spring Boot"],
  ["国内大厂", "互联网大厂"],
  10
]
```

注意：

- 技能和公司标签都是硬性条件。
- 必须使用 `AND`，不能使用 `OR`。
- 不要拼接用户输入。
- 不要查询 `full_text`。
- 不要查询 `candidate_resumes.experience_if`。

---

#### 5. 添加命中原因和返回格式化 Code 节点

节点名称建议：

```text
Format Combined Search Result
```

建议为每个候选人生成 `reason` 字段。

原因生成规则：

- 如果 `matched_skills` 命中 `must_skills`，加入：`命中技能：Spring Boot`
- 如果 `company_tags` 命中 `must_company_tags`，加入：`命中公司标签：国内大厂/互联网大厂`
- 如果 `matched_companies` 非空，加入：`命中公司：阿里巴巴`

返回结构建议：

```json
{
  "success": true,
  "stage": "step_9_skill_company_combined_search",
  "query": {
    "question": "找有 Springboot 经验，并且有国内大厂工作经验的候选人",
    "must_skills": ["Spring Boot"],
    "must_company_tags": ["国内大厂", "互联网大厂"],
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
      "latest_company": "阿里巴巴",
      "latest_title": "高级Java开发工程师",
      "matched_skills": ["Java", "Spring Boot", "微服务"],
      "matched_companies": ["阿里巴巴"],
      "company_tags": ["国内大厂", "互联网大厂", "电商"],
      "score": 200,
      "reason": "命中技能：Spring Boot；命中公司标签：国内大厂/互联网大厂；命中公司：阿里巴巴"
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
- `latest_company`
- `latest_title`
- `matched_skills`
- `matched_companies`
- `company_tags`
- `score`
- `reason`

---

### 验收测试

#### 测试用例 1：Spring Boot + 国内大厂

请求：

```json
{
  "question": "找有 Springboot 经验，并且有国内大厂工作经验的候选人"
}
```

预期：

- `must_skills` 包含 `Spring Boot`。
- `must_company_tags` 包含 `国内大厂` 和 `互联网大厂`。
- 返回候选人必须同时满足：
  - `matched_skills` 命中 `Spring Boot`。
  - `company_tags` 命中 `国内大厂` 或 `互联网大厂`。
- 返回结果包含 `matched_companies`。
- 返回结果包含 `score`。
- 返回结果包含 `reason`。

---

#### 测试用例 2：Java + 国内大厂

请求：

```json
{
  "question": "找 Java 后端，并且有国内大厂经验的候选人"
}
```

预期：

- `must_skills` 包含 `Java`。
- `must_company_tags` 包含 `国内大厂` 和 `互联网大厂`。
- 返回候选人必须同时命中 `Java` 和公司标签。

---

#### 测试用例 3：只有技能，缺少公司标签

请求：

```json
{
  "question": "找有 Springboot 经验的候选人"
}
```

预期：

- 本组合工作流不执行候选人查询。
- 返回可解释提示。
- `candidates` 为空数组。

---

#### 测试用例 4：只有公司标签，缺少技能

请求：

```json
{
  "question": "找有国内大厂经验的候选人"
}
```

预期：

- 本组合工作流不执行候选人查询。
- 返回可解释提示。
- `candidates` 为空数组。

---

#### 测试用例 5：无法识别任何条件

请求：

```json
{
  "question": "找综合素质好的候选人"
}
```

预期：

- 不查询全部候选人。
- 返回可解释提示。
- `candidates` 为空数组。

---

### 手工验证 SQL

可以先使用以下 SQL 验证组合查询：

```sql
WITH query_params AS (
  SELECT
    ARRAY['Spring Boot']::text[] AS must_skills,
    ARRAY['国内大厂', '互联网大厂']::text[] AS must_company_tags
),
scored AS (
  SELECT
    c.user_id,
    c.name,
    c.latest_company,
    c.latest_title,
    c.matched_skills,
    c.matched_companies,
    c.company_tags,
    (
      CASE WHEN c.matched_skills && q.must_skills THEN 100 ELSE 0 END +
      CASE WHEN c.company_tags && q.must_company_tags THEN 100 ELSE 0 END
    ) AS score
  FROM candidate_search_index c
  CROSS JOIN query_params q
  WHERE
    c.matched_skills && q.must_skills
    AND c.company_tags && q.must_company_tags
)
SELECT *
FROM scored
ORDER BY score DESC, applied_at DESC
LIMIT 10;
```

预期：

- 返回候选人同时命中 `Spring Boot` 和 `国内大厂` / `互联网大厂`。
- `score` 应为 `200`。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n Webhook 能接收组合查询请求。
- Code 节点能输出 `must_skills`。
- Code 节点能输出 `must_company_tags`。
- PostgreSQL 查询使用参数化 SQL。
- SQL 使用 `matched_skills && must_skills` 作为技能硬性条件。
- SQL 使用 `company_tags && must_company_tags` 作为公司标签硬性条件。
- SQL 使用 `AND` 组合技能条件和公司标签条件。
- 返回候选人必须同时命中技能和公司标签。
- 返回结果包含 `matched_skills`。
- 返回结果包含 `matched_companies`。
- 返回结果包含 `company_tags`。
- 返回结果包含 `score`。
- 返回结果包含 `reason`。
- 返回数量默认限制为 10。
- 返回结果不包含 `full_text`。
- 返回结果不包含 `experience_if`。
- 返回结果不包含 `personal`。
- 条件缺失时不会返回全量候选人。
- 全流程不调用 LLM。

---

### 调试建议

#### 1. 组合查询返回 0 条

检查：

- 是否存在同时命中 `Spring Boot` 和 `国内大厂` 的候选人。
- 可分别执行单条件查询确认数据存在。

```sql
SELECT COUNT(*)
FROM candidate_search_index
WHERE matched_skills && ARRAY['Spring Boot']::text[];
```

```sql
SELECT COUNT(*)
FROM candidate_search_index
WHERE company_tags && ARRAY['国内大厂', '互联网大厂']::text[];
```

再执行组合查询：

```sql
SELECT COUNT(*)
FROM candidate_search_index
WHERE matched_skills && ARRAY['Spring Boot']::text[]
  AND company_tags && ARRAY['国内大厂', '互联网大厂']::text[];
```

#### 2. 返回了只命中技能或只命中公司的候选人

检查：

- SQL 是否误用了 `OR`。
- WHERE 条件是否同时包含技能和公司标签。
- n8n 参数是否传错。

#### 3. `reason` 与实际字段不一致

检查：

- `reason` 是否基于返回字段生成。
- 不要在 `reason` 中编造未命中的技能或公司。
- 不要根据用户问题直接生成原因，必须根据查询结果字段生成。

#### 4. 返回字段包含大文本

检查：

- SQL 是否误选了 `full_text`。
- 是否误查了 `candidate_resumes` 原始表。
- 格式化节点是否直接返回完整 `item.json`。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. Spring Boot + 国内大厂测试结果：
4. Java + 国内大厂测试结果：
5. 只有技能测试结果：
6. 只有公司标签测试结果：
7. 无法识别条件测试结果：
8. 返回候选人数：
9. 是否全部同时命中技能和公司标签：
10. reason 检查结果：
11. 是否包含 full_text：
12. 是否包含 experience_if：
13. 是否调用 LLM：
14. 遗留问题：
```

---

### 风险与注意事项

- 当前阶段只支持硬性组合条件，不处理“最好有国内大厂经历”这类偏好条件。
- 技能条件和公司标签条件必须使用 `AND`，确保结果符合用户明确要求。
- `reason` 必须来自结构化检索结果，不应编造。
- 不要将用户输入拼接进 SQL。
- 条件缺失时不要降级为全量查询。
- 返回字段继续保持克制，为后续 LLM 总结阶段控制上下文。

---

### 下一步

通过本 Issue 后，再进入下一个 Epic：扩展公司标签，加入 `世界500强`，验证公司标签机制的扩展成本。