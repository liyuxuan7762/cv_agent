# Epic 03：n8n 固定技能检索链路

## Issue 02：在 n8n Code 节点中加入最小技能归一化规则

### 背景

上一阶段已经完成固定 `Spring Boot` 技能查询链路，验证了 n8n 可以通过 Webhook 调用 `candidate_search_index` 并返回压缩后的候选人列表。

本 Issue 对应 MVP 计划中的：

- Step 5：在 n8n Code 节点中加入最小归一化规则

该阶段开始让 n8n 根据用户问题识别少量技能写法，并统一转换为标准技能名。当前只处理最小范围：

- `Springboot`
- `springboot`
- `spring boot`
- `Spring Boot`
- `Java`
- `java后端`
- `Java后端`

目标是验证“规则解析 → 标准技能名 → 参数化 SQL 查询 → 压缩结果返回”的最小闭环。

---

### 目标

改造 n8n 技能检索工作流，使其能够：

1. 从 Webhook 请求中读取 `question`。
2. 使用 Code 节点识别问题中的最小技能表达。
3. 将不同写法统一归一化为标准技能名。
4. 使用参数化 SQL 查询 `candidate_search_index`。
5. 返回匹配候选人列表。
6. 全流程不依赖 LLM。

---

### 范围

#### 包含

- 在 n8n Code 节点中实现最小规则解析。
- 识别 `Springboot` / `springboot` / `spring boot` / `Spring Boot`。
- 识别 `Java` / `java后端` / `Java后端`。
- 输出 `must_skills`。
- 使用 PostgreSQL 参数化查询。
- 返回压缩候选人列表。
- 对无可识别技能的情况返回可解释结果。

#### 不包含

- 不查询 `skill_dictionary` 动态扩展相关词。
- 不处理 `related_terms`。
- 不处理公司标签。
- 不处理“国内大厂”。
- 不处理“世界500强”。
- 不做复杂打分。
- 不调用 LLM。
- 不让 LLM 生成 SQL。
- 不返回 `full_text`、`experience_if` 或完整简历。

---

### 前置条件

- Epic 03 / Issue 01 已完成：固定 `Spring Boot` 查询链路可用。
- `candidate_search_index` 中存在 `matched_skills` 字段。
- `matched_skills` 字段类型为 `TEXT[]`。
- n8n 已配置 PostgreSQL Credential。
- Webhook 到 PostgreSQL 的链路稳定可用。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Code: 从 question 中识别技能并归一化
  ↓
Postgres: 按 must_skills 查询 candidate_search_index
  ↓
Code: 压缩返回字段
  ↓
Respond to Webhook
```

---

### 实施步骤

#### 1. 复制或改造现有工作流

可以基于 Epic 03 / Issue 01 中的固定技能查询工作流进行改造。

建议新建或复制后的 Webhook Path：

```text
candidate-search-rule-skill
```

建议保留旧工作流，方便回归验证固定查询链路。

---

#### 2. 修改技能解析 Code 节点

将原来的固定参数 Code 节点改为规则解析节点。

节点名称建议：

```text
Parse Skill Rules
```

Code 示例：

```javascript
const question = $json.body?.question || $json.question || '';

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

return [{
  json: {
    question,
    must_skills: [...new Set(mustSkills)],
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

```json
{
  "question": "找 Java 后端候选人",
  "must_skills": ["Java"],
  "limit": 10
}
```

---

#### 3. 增加无技能识别保护

如果 `must_skills` 为空，不建议继续查询全部候选人。

推荐处理方式：

- 在 Code 节点输出 `has_query = false`。
- 或通过 IF 节点分支直接返回提示。

推荐返回结构：

```json
{
  "success": false,
  "stage": "step_5_rule_based_skill_search",
  "message": "当前问题中未识别到可检索技能，请输入 Spring Boot 或 Java 等技能关键词。",
  "query": {
    "must_skills": [],
    "limit": 10
  },
  "candidates": []
}
```

如果希望在同一个 Code 节点中输出标记，可使用：

```javascript
return [{
  json: {
    question,
    must_skills: [...new Set(mustSkills)],
    limit: 10,
    has_query: mustSkills.length > 0
  }
}];
```

---

#### 4. 修改 PostgreSQL 节点为参数化查询

PostgreSQL 查询应从上游 Code 节点读取参数：

- `$1`：`must_skills`
- `$2`：`limit`

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
WHERE matched_skills && $1::text[]
ORDER BY applied_at DESC
LIMIT $2;
```

参数示例：

```json
[
  ["Spring Boot"],
  10
]
```

注意：

- 不要将 `question` 拼接到 SQL 中。
- 不要将技能数组手工拼接成 SQL 字符串。
- 保持 `matched_skills && $1::text[]` 这种参数化形式。

---

#### 5. 修改返回格式化 Code 节点

节点名称建议：

```text
Format Rule Skill Search Result
```

返回结构建议：

```json
{
  "success": true,
  "stage": "step_5_rule_based_skill_search",
  "query": {
    "question": "找有 Springboot 经验的候选人",
    "must_skills": ["Spring Boot"],
    "limit": 10
  },
  "count": 10,
  "candidates": []
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

不要返回：

- `full_text`
- `experience_if`
- `personal`
- 完整工作经历文本

---

### 验收测试

#### 测试用例 1：Springboot 写法

请求：

```json
{
  "question": "找有 Springboot 经验的候选人"
}
```

预期：

- `must_skills` 为 `["Spring Boot"]`。
- 返回候选人的 `matched_skills` 包含 `Spring Boot`。

---

#### 测试用例 2：spring boot 写法

请求：

```json
{
  "question": "找有 spring boot 经验的候选人"
}
```

预期：

- `must_skills` 为 `["Spring Boot"]`。
- 返回结果类型与测试用例 1 一致。

---

#### 测试用例 3：标准 Spring Boot 写法

请求：

```json
{
  "question": "找有 Spring Boot 经验的候选人"
}
```

预期：

- `must_skills` 为 `["Spring Boot"]`。
- 返回结果类型与测试用例 1 一致。

---

#### 测试用例 4：Java 后端

请求：

```json
{
  "question": "找 Java 后端候选人"
}
```

预期：

- `must_skills` 为 `["Java"]`。
- 返回候选人的 `matched_skills` 包含 `Java`。

---

#### 测试用例 5：无法识别技能

请求：

```json
{
  "question": "找沟通能力强的候选人"
}
```

预期：

- 不查询全部候选人，或查询分支被阻断。
- 返回可解释提示。
- `candidates` 为空数组。
- 不返回随机候选人。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n Webhook 能接收包含 `question` 的请求。
- Code 节点能识别 `Springboot`、`springboot`、`spring boot`、`Spring Boot`。
- 上述 Spring Boot 写法都统一输出 `Spring Boot`。
- Code 节点能识别 `Java`、`java后端`、`Java后端`。
- Java 查询能返回 `matched_skills` 包含 `Java` 的候选人。
- PostgreSQL 查询使用参数化 SQL。
- 返回结果不包含 `full_text`。
- 返回结果不包含 `experience_if`。
- 返回结果不包含 `personal`。
- 无法识别技能时不会返回全量候选人。
- 全流程不调用 LLM。

---

### 调试建议

#### 1. `Springboot` 无法识别

检查：

- 是否对 `question` 执行了 `toLowerCase()`。
- 判断条件是否包含 `lower.includes('springboot')`。
- Webhook 请求体是否位于 `$json.body.question` 或 `$json.question`。

#### 2. `Java 后端` 无法识别

检查：

- 判断条件是否包含 `question.includes('Java')`。
- 如果输入为小写 `java`，当前示例只在 `java后端` 中处理小写，可以按需补充 `lower.includes('java')`。
- 注意不要过度扩展，当前 Issue 只要求最小可用。

#### 3. PostgreSQL 参数类型错误

检查：

- 参数 `$1` 是否为数组，例如 `["Spring Boot"]`。
- SQL 是否使用 `$1::text[]`。
- `matched_skills` 是否为 `TEXT[]`。

#### 4. 无技能时返回了候选人

检查：

- 是否对 `must_skills.length === 0` 增加了分支保护。
- 是否误把空数组传入查询并改成了无条件查询。
- 不应使用 `WHERE true` 作为兜底条件。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. Springboot 测试结果：
4. spring boot 测试结果：
5. Spring Boot 测试结果：
6. Java 后端测试结果：
7. 无法识别技能测试结果：
8. 是否使用参数化 SQL：
9. 是否包含 full_text：
10. 是否包含 experience_if：
11. 是否调用 LLM：
12. 遗留问题：
```

---

### 风险与注意事项

- 当前规则解析只覆盖极少数技能表达，不代表完整自然语言理解能力。
- 不要为了覆盖更多问题在本阶段无限增加规则，避免 MVP 失焦。
- 用户输入不能直接拼接进 SQL。
- 无法识别技能时不要返回全量候选人，否则可能造成误导和数据暴露。
- 返回字段继续保持克制，为后续 LLM 总结阶段控制上下文打基础。

---

### 下一步

通过本 Issue 后，再进入下一个 Issue：加入技能相关词扩展和简单打分，使明确命中 `Spring Boot` 的候选人中，懂 `Java`、`Spring Cloud`、`微服务` 的排序更靠前。