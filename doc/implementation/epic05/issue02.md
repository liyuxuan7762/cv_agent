# Epic 05：公司字典与公司标签基础

## 状态
已完成

## Issue 02：将“国内大厂”公司标签查询接入 n8n Webhook

### 背景

上一阶段已经创建 `company_dictionary`，并在 `candidate_search_index` 中写入了 `matched_companies` 和 `company_tags`。现在需要把公司标签查询接入 n8n，让用户不需要输入具体公司名，只要输入“国内大厂”或“互联网大厂”，系统就能查询相关候选人。

本 Issue 对应 MVP 计划中的：

- Step 8：把“国内大厂”接入 n8n Webhook

该阶段只处理公司标签查询，不与技能条件组合，不调用 LLM，也不返回完整简历。

---

### 目标

创建或改造 n8n 工作流，使其能够：

1. 从用户问题中识别 `国内大厂` 或 `互联网大厂`。
2. 将识别结果转换为 `must_company_tags`。
3. 使用参数化 SQL 查询 `candidate_search_index.company_tags`。
4. 返回命中公司标签的候选人列表。
5. 返回结果中说明命中的公司和标签。
6. 不需要用户输入具体公司名。

---

### 范围

#### 包含

- 在 n8n Code 节点中加入最小公司标签识别规则。
- 识别 `国内大厂`。
- 识别 `互联网大厂`。
- 输出 `must_company_tags`。
- 使用 PostgreSQL 参数化 SQL 查询 `candidate_search_index`。
- 返回候选人基础信息、`matched_companies` 和 `company_tags`。
- 对无法识别公司标签的情况返回可解释提示。

#### 不包含

- 不处理技能条件。
- 不组合 `Spring Boot` 和 `国内大厂`。
- 不处理 `世界500强`。
- 不处理具体公司名查询。
- 不做复杂打分。
- 不调用 LLM。
- 不让 LLM 生成 SQL。
- 不返回 `full_text`。
- 不返回 `experience_if`。
- 不返回完整简历。

---

### 前置条件

- Epic 05 / Issue 01 已完成：`company_dictionary` 已创建。
- `candidate_search_index` 中存在 `matched_companies` 字段。
- `candidate_search_index` 中存在 `company_tags` 字段。
- 可以通过 SQL 查询到 `company_tags` 包含 `国内大厂` 的候选人。
- n8n 已配置 PostgreSQL Credential。
- n8n 到 PostgreSQL 的查询链路可用。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Code: 从 question 中识别公司标签
  ↓
Postgres: 按 company_tags 查询 candidate_search_index
  ↓
Code: 压缩返回字段
  ↓
Respond to Webhook
```

---

### 实施步骤

#### 1. 创建或复制 n8n 工作流

建议基于已有技能查询工作流复制一个新的公司标签查询工作流，避免影响技能检索链路。

建议 Webhook 配置：

```text
HTTP Method: POST
Path: candidate-search-company-tag
Response Mode: Using 'Respond to Webhook' node
```

测试输入：

```json
{
  "question": "找有国内大厂工作经验的候选人"
}
```

---

#### 2. 添加公司标签解析 Code 节点

节点名称建议：

```text
Parse Company Tag Rules
```

Code 示例：

```javascript
const question = $json.body?.question || $json.question || '';
const companyTags = [];

if (question.includes('国内大厂') || question.includes('互联网大厂')) {
  companyTags.push('国内大厂', '互联网大厂');
}

const mustCompanyTags = [...new Set(companyTags)];

return [{
  json: {
    question,
    must_company_tags: mustCompanyTags,
    limit: 10,
    has_query: mustCompanyTags.length > 0
  }
}];
```

输出示例：

```json
{
  "question": "找有国内大厂工作经验的候选人",
  "must_company_tags": ["国内大厂", "互联网大厂"],
  "limit": 10,
  "has_query": true
}
```

说明：

- 用户输入 `国内大厂` 时，同时查询 `国内大厂` 和 `互联网大厂`，提高标签召回一致性。
- 当前阶段只做标签识别，不解析具体公司名。

---

#### 3. 增加无公司标签识别保护

如果 `must_company_tags` 为空，不应查询全部候选人。

推荐返回结构：

```json
{
  "success": false,
  "stage": "step_8_company_tag_search",
  "message": "当前问题中未识别到可检索公司标签，请输入国内大厂或互联网大厂等关键词。",
  "query": {
    "must_company_tags": [],
    "limit": 10
  },
  "candidates": []
}
```

注意：

- 不要把无条件查询作为兜底。
- 不要返回随机候选人。

---

#### 4. 添加 PostgreSQL 查询节点

节点名称建议：

```text
Query Candidates By Company Tags
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
  matched_companies,
  company_tags
FROM candidate_search_index
WHERE company_tags && $1::text[]
ORDER BY applied_at DESC
LIMIT $2;
```

参数示例：

```json
[
  ["国内大厂", "互联网大厂"],
  10
]
```

注意：

- 使用参数化 SQL。
- 不要拼接用户输入。
- 不要查询 `full_text`。
- 不要查询 `candidate_resumes.experience_if`。

---

#### 5. 添加返回格式化 Code 节点

节点名称建议：

```text
Format Company Tag Search Result
```

返回结构建议：

```json
{
  "success": true,
  "stage": "step_8_company_tag_search",
  "query": {
    "question": "找有国内大厂工作经验的候选人",
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
      "matched_companies": ["阿里巴巴"],
      "company_tags": ["国内大厂", "互联网大厂", "电商"]
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
- `matched_companies`
- `company_tags`

不要返回：

- `full_text`
- `experience_if`
- `personal`
- 完整工作经历文本

---

### 验收测试

#### 测试用例 1：国内大厂

请求：

```json
{
  "question": "找有国内大厂工作经验的候选人"
}
```

预期：

- `must_company_tags` 包含 `国内大厂` 和 `互联网大厂`。
- 返回候选人的 `company_tags` 至少命中其中一个标签。
- 返回结果中包含 `matched_companies`。
- 不需要用户输入具体公司名。

---

#### 测试用例 2：互联网大厂

请求：

```json
{
  "question": "找有互联网大厂经验的候选人"
}
```

预期：

- `must_company_tags` 包含 `国内大厂` 和 `互联网大厂`。
- 返回候选人的 `company_tags` 至少命中其中一个标签。
- 返回结果中包含命中的公司和标签。

---

#### 测试用例 3：无法识别公司标签

请求：

```json
{
  "question": "找创业公司背景的候选人"
}
```

预期：

- 当前阶段不识别该条件。
- 不查询全部候选人。
- 返回可解释提示。
- `candidates` 为空数组。

---

### 手工验证 SQL

在 n8n 联调前，可以先执行：

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
  matched_companies,
  company_tags
FROM candidate_search_index
WHERE company_tags && ARRAY['国内大厂', '互联网大厂']::text[]
ORDER BY applied_at DESC
LIMIT 10;
```

预期：

- 能返回候选人。
- `matched_companies` 有值。
- `company_tags` 包含 `国内大厂` 或 `互联网大厂`。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n Webhook 能接收公司标签查询请求。
- Code 节点能识别 `国内大厂`。
- Code 节点能识别 `互联网大厂`。
- Code 节点能输出 `must_company_tags`。
- PostgreSQL 查询使用参数化 SQL。
- Webhook 能返回最多 10 条候选人。
- 返回结果包含 `matched_companies`。
- 返回结果包含 `company_tags`。
- 返回候选人的 `company_tags` 至少命中 `国内大厂` 或 `互联网大厂`。
- 返回结果不包含 `full_text`。
- 返回结果不包含 `experience_if`。
- 返回结果不包含 `personal`。
- 无法识别公司标签时不会返回全量候选人。
- 全流程不调用 LLM。

---

### 调试建议

#### 1. 返回 0 条候选人

检查：

- `candidate_search_index` 是否已经重建。
- `company_tags` 字段是否存在。
- 是否存在命中 `国内大厂` 的候选人。

可执行：

```sql
SELECT COUNT(*)
FROM candidate_search_index
WHERE company_tags && ARRAY['国内大厂']::text[];
```

#### 2. `matched_companies` 为空

检查：

- `build_search_index.js` 是否正确读取 `company_dictionary`。
- 公司名称或别名是否出现在候选人 `full_text` 中。
- `matched_companies` 是否保存了标准公司名。

#### 3. PostgreSQL 参数错误

检查：

- `$1` 是否为数组，例如 `["国内大厂", "互联网大厂"]`。
- SQL 是否使用 `$1::text[]`。
- `company_tags` 字段是否为 `TEXT[]`。
- `$2` 是否为数字。

#### 4. 返回字段包含大文本

检查：

- SQL 是否误选了 `full_text`。
- 是否误查了 `candidate_resumes` 原始表。
- 格式化 Code 节点是否直接返回完整 `item.json`。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. 国内大厂测试结果：
4. 互联网大厂测试结果：
5. 无法识别公司标签测试结果：
6. 返回候选人数：
7. matched_companies 检查结果：
8. company_tags 检查结果：
9. 是否包含 full_text：
10. 是否包含 experience_if：
11. 是否调用 LLM：
12. 遗留问题：
```

---

### 风险与注意事项

- 当前阶段只处理公司标签查询，不要提前组合技能条件。
- 用户输入不能直接拼接进 SQL。
- 公司标签必须来自 `company_dictionary` 和索引结果，不应由 LLM 临时判断。
- 无法识别标签时不要返回全量候选人。
- 返回字段应保持克制，继续避免将完整简历或大段原文传递给后续节点。

---

### 下一步

通过本 Issue 后，再进入下一个 Issue：组合技能条件和公司标签条件，支持 `Spring Boot` + `国内大厂` 的第一个业务价值查询。