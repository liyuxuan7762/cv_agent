# Epic 04：技能相关词扩展与简单打分

## Issue 01：加入技能相关词扩展和简单打分排序

### 背景

当前 n8n 工作流已经能够通过规则识别用户问题中的最小技能表达，并将 `Springboot`、`spring boot`、`Spring Boot` 统一查询为标准技能 `Spring Boot`。

本 Issue 对应 MVP 计划中的：

- Step 6：加入技能相关词扩展和简单打分

该阶段的目标是在“必须命中明确技能”的基础上，引入相关技能作为排序加分项。例如用户要求 `Spring Boot`，候选人必须命中 `Spring Boot`；如果同时命中 `Java`、`Spring Cloud`、`微服务`，则排序更靠前。

---

### 目标

改造 n8n 技能检索工作流，使其支持：

1. 用户明确要求的技能进入 `must_skills`。
2. 从 `skill_dictionary.related_terms` 读取相关技能，生成 `should_skills`。
3. 查询结果必须命中 `must_skills`。
4. 命中 `should_skills` 的候选人获得额外加分。
5. 返回结果中包含 `score`，便于调试排序逻辑。
6. 全流程仍然不使用 LLM。

---

### 范围

#### 包含

- 在 n8n 中保留现有规则解析能力。
- 使用 PostgreSQL 查询 `skill_dictionary` 获取相关词。
- 合并并去重生成 `should_skills`。
- 使用固定 SQL 模板实现简单打分。
- 返回候选人基础信息、命中技能和 `score`。
- 验证命中更多相关技能的候选人排序更靠前。

#### 不包含

- 不处理公司标签。
- 不处理“国内大厂”。
- 不处理“世界500强”。
- 不引入复杂权重模型。
- 不做语义向量检索。
- 不调用 LLM。
- 不让 LLM 生成 SQL。
- 不返回 `full_text`、`experience_if` 或完整简历。

---

### 前置条件

- Epic 02 / Issue 01 已完成：`skill_dictionary` 已创建。
- Epic 02 / Issue 02 已完成：`candidate_search_index` 已构建。
- Epic 03 / Issue 02 已完成：n8n 已能解析最小技能规则并参数化查询。
- `skill_dictionary` 中 `Spring Boot` 的 `related_terms` 至少包含：
  - `Java`
  - `Spring Cloud`
  - `微服务`
- `candidate_search_index.matched_skills` 类型为 `TEXT[]`。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Code: 从 question 中识别技能并归一化，生成 must_skills
  ↓
Postgres: 查询 skill_dictionary 获取 related_terms
  ↓
Code: 生成 should_skills
  ↓
Postgres: 按 must_skills 查询 candidate_search_index 并按 should_skills 打分
  ↓
Code: 压缩返回字段
  ↓
Respond to Webhook
```

---

### 核心规则

#### must_skills

用户明确要求的技能进入 `must_skills`。

示例：

```json
{
  "question": "找有 Springboot 经验的候选人，最好懂微服务",
  "must_skills": ["Spring Boot"]
}
```

#### should_skills

从字典中的 `related_terms` 生成。

示例：

```json
{
  "must_skills": ["Spring Boot"],
  "should_skills": ["Java", "Spring Cloud", "微服务"]
}
```

#### 打分规则

第一版采用简单可解释规则：

- 候选人命中 `must_skills` 才进入结果集。
- 基础分为 `100`。
- 每命中一个 `should_skills`，增加 `10` 分。

示例：

| matched_skills | score |
|---|---:|
| `["Spring Boot"]` | 100 |
| `["Spring Boot", "Java"]` | 110 |
| `["Spring Boot", "Java", "微服务"]` | 120 |
| `["Spring Boot", "Java", "Spring Cloud", "微服务"]` | 130 |

---

### 实施步骤

#### 1. 保留现有技能规则解析节点

继续使用 Epic 03 / Issue 02 中的规则解析逻辑，输出：

```json
{
  "question": "找有 Springboot 经验的候选人，最好懂微服务",
  "must_skills": ["Spring Boot"],
  "limit": 10,
  "has_query": true
}
```

注意：

- 如果 `must_skills` 为空，仍然应中断查询并返回提示。
- 不应查询全部候选人。

---

#### 2. 查询技能字典获取相关词

新增 PostgreSQL 节点。

节点名称建议：

```text
Query Skill Related Terms
```

SQL：

```sql
SELECT skill_name, aliases, related_terms
FROM skill_dictionary
WHERE skill_name = ANY($1::text[])
   OR aliases && $1::text[];
```

参数：

```json
[
  ["Spring Boot"]
]
```

预期返回：

```json
[
  {
    "skill_name": "Spring Boot",
    "aliases": ["SpringBoot", "springboot", "spring boot"],
    "related_terms": ["Java", "Spring Cloud", "微服务"]
  }
]
```

---

#### 3. 生成 `should_skills`

在字典查询节点后增加 Code 节点。

节点名称建议：

```text
Build Should Skills
```

逻辑要求：

1. 收集所有 `related_terms`。
2. 去重。
3. 移除已经存在于 `must_skills` 中的技能。
4. 保留 `question`、`must_skills` 和 `limit`。

输出示例：

```json
{
  "question": "找有 Springboot 经验的候选人，最好懂微服务",
  "must_skills": ["Spring Boot"],
  "should_skills": ["Java", "Spring Cloud", "微服务"],
  "limit": 10
}
```

注意：

- 如果 `related_terms` 为空，`should_skills` 应为空数组。
- 即使 `should_skills` 为空，也可以继续按 `must_skills` 查询，所有候选人基础分为 `100`。

---

#### 4. 使用打分 SQL 查询候选人

新增或替换候选人查询 PostgreSQL 节点。

节点名称建议：

```text
Query Scored Candidates By Skills
```

SQL：

```sql
WITH query_params AS (
  SELECT
    $1::text[] AS must_skills,
    $2::text[] AS should_skills
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
    (
      100 +
      (
        SELECT COUNT(*) * 10
        FROM unnest(c.matched_skills) s
        WHERE s = ANY(q.should_skills)
      )
    ) AS score
  FROM candidate_search_index c
  CROSS JOIN query_params q
  WHERE c.matched_skills && q.must_skills
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
  ["Java", "Spring Cloud", "微服务"],
  10
]
```

注意：

- `must_skills` 是硬性过滤条件。
- `should_skills` 只用于加分。
- 不要把用户输入拼接进 SQL。
- 不要查询 `full_text`。

---

#### 5. 压缩返回字段并保留分数

格式化 Code 节点应返回：

```json
{
  "success": true,
  "stage": "step_6_skill_related_terms_scoring",
  "query": {
    "question": "找有 Springboot 经验的候选人，最好懂微服务",
    "must_skills": ["Spring Boot"],
    "should_skills": ["Java", "Spring Cloud", "微服务"],
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
      "latest_title": "高级Java开发工程师",
      "matched_skills": ["Java", "Spring Boot", "微服务"],
      "score": 120
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
- `score`

---

### 验收测试

#### 测试用例 1：Spring Boot 相关词加分

请求：

```json
{
  "question": "找有 Springboot 经验的候选人，最好懂微服务"
}
```

预期：

- `must_skills` 包含 `Spring Boot`。
- `should_skills` 包含 `Java`、`Spring Cloud`、`微服务`。
- 返回结果必须命中 `Spring Boot`。
- 同时命中更多 `should_skills` 的候选人排序更靠前。
- 返回结果包含 `score`。

---

#### 测试用例 2：Spring Boot 基础查询仍可用

请求：

```json
{
  "question": "找有 spring boot 经验的候选人"
}
```

预期：

- `must_skills` 包含 `Spring Boot`。
- `should_skills` 来自字典相关词。
- 返回候选人均命中 `Spring Boot`。
- 返回结果包含 `score`。

---

#### 测试用例 3：Java 查询可用

请求：

```json
{
  "question": "找 Java 后端候选人"
}
```

预期：

- `must_skills` 包含 `Java`。
- `should_skills` 来自 `Java` 的 `related_terms`。
- 返回候选人均命中 `Java`。
- 返回结果包含 `score`。

---

#### 测试用例 4：无法识别技能

请求：

```json
{
  "question": "找沟通能力强的候选人"
}
```

预期：

- 不查询全部候选人。
- 返回可解释提示。
- `candidates` 为空数组。

---

### 手工验证 SQL

可以使用以下 SQL 验证排序逻辑：

```sql
WITH query_params AS (
  SELECT
    ARRAY['Spring Boot']::text[] AS must_skills,
    ARRAY['Java', 'Spring Cloud', '微服务']::text[] AS should_skills
),
scored AS (
  SELECT
    c.user_id,
    c.name,
    c.latest_company,
    c.latest_title,
    c.matched_skills,
    (
      100 +
      (
        SELECT COUNT(*) * 10
        FROM unnest(c.matched_skills) s
        WHERE s = ANY(q.should_skills)
      )
    ) AS score
  FROM candidate_search_index c
  CROSS JOIN query_params q
  WHERE c.matched_skills && q.must_skills
)
SELECT *
FROM scored
ORDER BY score DESC, user_id
LIMIT 10;
```

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n 能根据规则解析生成 `must_skills`。
- n8n 能查询 `skill_dictionary.related_terms`。
- n8n 能生成去重后的 `should_skills`。
- 候选人查询必须以 `must_skills` 作为硬性条件。
- 命中 `should_skills` 的候选人分数更高。
- 返回结果按照 `score DESC, applied_at DESC` 排序。
- 返回结果包含 `score`。
- 返回结果不包含 `full_text`。
- 返回结果不包含 `experience_if`。
- 返回结果不包含 `personal`。
- 无法识别技能时不会返回全量候选人。
- 全流程不调用 LLM。

---

### 调试建议

#### 1. `should_skills` 为空

检查：

- `skill_dictionary` 中对应 `skill_name` 是否存在。
- `related_terms` 是否为空数组。
- 查询参数 `$1` 是否为 `text[]`。
- PostgreSQL SQL 是否包含 `skill_name = ANY($1::text[])`。

#### 2. 所有候选人分数都是 100

检查：

- 候选人的 `matched_skills` 是否包含 `Java`、`Spring Cloud`、`微服务` 等相关词。
- `should_skills` 是否正确传入候选人查询节点。
- SQL 中 `unnest(c.matched_skills)` 是否正常工作。

#### 3. 不命中 `Spring Boot` 的候选人出现在结果中

检查：

- WHERE 条件是否仍为 `c.matched_skills && q.must_skills`。
- 是否误把 `should_skills` 也放入硬性条件或替代了 `must_skills`。

#### 4. 参数化 SQL 报错

检查：

- `$1` 和 `$2` 是否都是数组。
- `$3` 是否为数字。
- n8n PostgreSQL 节点参数配置是否按顺序传递。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. Springboot + 微服务测试结果：
4. Spring Boot 基础查询测试结果：
5. Java 查询测试结果：
6. 无法识别技能测试结果：
7. should_skills 生成结果：
8. score 排序检查结果：
9. 是否包含 full_text：
10. 是否包含 experience_if：
11. 是否调用 LLM：
12. 遗留问题：
```

---

### 风险与注意事项

- 相关词只用于加分，不应扩大硬性过滤条件，否则可能改变用户明确需求。
- 当前打分规则应保持简单透明，不要提前引入复杂权重。
- 如果 `related_terms` 维护不准确，会影响排序结果，但不应影响必须命中条件。
- 不要为了“最好懂微服务”在本阶段实现复杂自然语言偏好解析；本阶段先使用字典相关词验证排序机制。
- 返回 `score` 是为了调试，后续面向 HR 的自然语言回答可隐藏或解释该分数。

---

### 下一步

通过本 Issue 后，再进入下一个 Epic：增加公司字典，先只解决“国内大厂”这一类公司标签问题。