# Epic 09：LLM Query Parser 与规则兜底

## Issue 01：引入 LLM Query Parser 输出结构化 JSON，并保留规则解析兜底

### 背景

当前系统已经完成从基础数据、技能字典、公司字典、规则检索、组合查询、LLM 结果总结到单人详情查询的渐进式 MVP 链路。

到目前为止，系统的查询解析主要依赖 n8n Code 节点中的显式规则，例如：

- `Springboot` / `spring boot` / `Spring Boot` → `Spring Boot`
- `国内大厂` / `互联网大厂` → 公司标签
- `世界500强` / `fortune 500` → 公司标签
- `U000123` + 详情关键词 → 单人详情查询

本 Issue 对应 MVP 计划中的：

- Step 13：最后再引入 LLM Query Parser 替换部分规则

该阶段可以引入 LLM 解析更复杂的自然语言，但必须严格限制 LLM 的职责：

> LLM 只输出结构化 JSON 查询意图，不允许生成 SQL，不允许直接查询数据库，不允许决定最终 SQL 模板。

LLM Parser 的输出仍需经过 Code 节点校验、清洗、归一化和安全限制，然后再进入固定 SQL 模板。

---

### 目标

在现有规则解析稳定可用的基础上，引入 LLM Query Parser，使系统能够将更复杂的用户自然语言查询转换为受控结构化 JSON。

核心目标：

1. LLM Parser 只负责解析用户问题。
2. LLM Parser 输出固定 JSON 结构。
3. Code 节点校验和归一化 LLM 输出。
4. 保留现有规则解析作为兜底。
5. SQL 仍使用固定模板和参数化查询。
6. 不允许 LLM 生成 SQL。
7. 不允许 LLM 直接访问数据库。
8. 限制 `limit <= 20`。
9. 对未知字段、非法字段、空值进行清理。

---

### 范围

#### 包含

- 在 n8n 中增加 LLM Query Parser 节点。
- 设计固定 JSON 输出格式。
- 增加 Code 节点校验 LLM 输出。
- 对技能、公司标签、公司名等字段进行归一化。
- 合并 LLM Parser 输出与规则解析结果。
- 保留规则解析兜底逻辑。
- 限制查询字段白名单。
- 限制 `limit` 最大值为 `20`。
- 使用固定 SQL 模板执行查询。
- 增加解析结果调试输出。

#### 不包含

- 不让 LLM 生成 SQL。
- 不让 LLM 直接访问 PostgreSQL。
- 不让 LLM 决定查询表名或字段名。
- 不实现任意复杂布尔逻辑。
- 不实现自由文本 SQL 搜索。
- 不实现权限系统。
- 不替换详情查询分支。
- 不让 LLM 读取完整简历。
- 不把 `full_text`、`experience_if` 或完整简历传给 Query Parser。

---

### 前置条件

- Epic 03 / Issue 02 已完成：规则技能解析可用。
- Epic 05 / Issue 02 已完成：规则公司标签解析可用。
- Epic 06 / Issue 01 已完成：组合查询可用。
- Epic 07 / Issue 02 已完成：LLM 结果总结可用。
- Epic 08 / Issue 01 已完成：详情查询分支可用。
- n8n 已配置可用 LLM 节点或模型凭据。
- 固定 SQL 查询模板已稳定可用。

---

### LLM Parser 输出格式

LLM 必须输出如下 JSON：

```json
{
  "must": {
    "skills": [],
    "company_names": [],
    "company_tags": [],
    "gender": null,
    "age_min": null,
    "age_max": null
  },
  "should": {
    "skills": [],
    "company_names": [],
    "company_tags": []
  },
  "keywords": [],
  "limit": 10
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `must.skills` | 用户明确要求必须具备的技能 |
| `must.company_names` | 用户明确要求必须有经历的公司名称 |
| `must.company_tags` | 用户明确要求必须具备的公司标签 |
| `must.gender` | 用户明确要求的性别；无要求时为 `null` |
| `must.age_min` | 年龄下限；无要求时为 `null` |
| `must.age_max` | 年龄上限；无要求时为 `null` |
| `should.skills` | 用户表达“最好、优先、加分”的技能 |
| `should.company_names` | 用户表达“最好、优先、加分”的公司名称 |
| `should.company_tags` | 用户表达“最好、优先、加分”的公司标签 |
| `keywords` | 其他无法结构化但可用于后续调试的关键词 |
| `limit` | 返回数量，后续 Code 节点必须限制最大值 |

---

### LLM Parser Prompt

建议 Prompt：

```text
你是招聘检索 Query Parser。请把用户的中文招聘检索问题解析为严格 JSON。

要求：
1. 只输出 JSON，不要输出解释。
2. 不要生成 SQL。
3. 不要添加 JSON 以外的 Markdown。
4. 不要编造用户没有提出的硬性条件。
5. “必须”“需要”“找有”“并且有”等表达放入 must。
6. “最好”“优先”“加分”“可以考虑”等表达放入 should。
7. 如果不确定某个条件，不要放入 must，可放入 keywords。
8. limit 默认 10。
9. 如果用户要求数量超过 20，也只输出 20。
10. 字段必须完整，缺失值用空数组或 null。

输出 JSON 格式：
{
  "must": {
    "skills": [],
    "company_names": [],
    "company_tags": [],
    "gender": null,
    "age_min": null,
    "age_max": null
  },
  "should": {
    "skills": [],
    "company_names": [],
    "company_tags": []
  },
  "keywords": [],
  "limit": 10
}

用户问题：
{{ question }}
```

---

### 期望解析示例

用户请求：

```json
{
  "question": "帮我找有 Spring Boot 经验，并且最好有国内大厂经历的 Java 后端候选人，优先最近投递"
}
```

期望 LLM Parser 输出：

```json
{
  "must": {
    "skills": ["Spring Boot", "Java"],
    "company_names": [],
    "company_tags": [],
    "gender": null,
    "age_min": null,
    "age_max": null
  },
  "should": {
    "skills": ["微服务"],
    "company_names": [],
    "company_tags": ["国内大厂", "互联网大厂"]
  },
  "keywords": ["后端", "最近投递"],
  "limit": 10
}
```

说明：

- `Spring Boot` 和 `Java` 是明确技能条件。
- `国内大厂` 因为有“最好”，进入 `should.company_tags`。
- `后端` 暂时作为关键词保留。
- “最近投递”可以作为排序提示，但当前 SQL 默认已按 `applied_at DESC` 排序。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Code: 详情查询识别
  ├─ 是详情查询：走详情分支
  └─ 否：继续
       ↓
     Code: 规则解析兜底
       ↓
     LLM: Query Parser 输出 JSON
       ↓
     Code: 校验、清洗、归一化、合并规则结果
       ↓
     Postgres: 使用固定 SQL 模板参数化查询
       ↓
     Code: 压缩候选人结果 + 生成 reason
       ↓
     LLM: 结果总结
       ↓
     Respond to Webhook
```

注意：

- 详情查询分支优先于 Query Parser。
- Query Parser 不处理详情查询。
- Query Parser 只处理列表检索意图。

---

### 实施步骤

#### 1. 保留现有规则解析节点

不要删除现有规则解析逻辑。

规则解析仍用于：

- LLM Parser 出错时兜底。
- 明确高频条件的稳定识别。
- 对 LLM 输出进行交叉校验。

规则解析输出建议：

```json
{
  "rule_parse": {
    "must_skills": ["Spring Boot"],
    "must_company_tags": ["国内大厂", "互联网大厂"],
    "limit": 10
  }
}
```

---

#### 2. 增加 LLM Query Parser 节点

节点名称建议：

```text
LLM Query Parser
```

输入：

```json
{
  "question": "帮我找有 Spring Boot 经验，并且最好有国内大厂经历的 Java 后端候选人，优先最近投递"
}
```

输出必须是 JSON 字符串或 JSON 对象。

要求：

- 不接收候选人简历内容。
- 不接收 `full_text`。
- 不接收 `experience_if`。
- 不接收候选人列表。
- 只接收用户问题和少量解析规则说明。

---

#### 3. 增加 Parser 输出校验 Code 节点

节点名称建议：

```text
Validate And Normalize Parsed Query
```

该节点职责：

1. 解析 LLM 输出 JSON。
2. 如果 JSON 解析失败，标记 `parser_valid = false`。
3. 校验字段结构。
4. 删除未知字段。
5. 确保数组字段一定是数组。
6. 确保 `gender` 只能为允许值或 `null`。
7. 确保 `age_min`、`age_max` 是数字或 `null`。
8. 限制 `limit <= 20`。
9. 对技能和公司标签做归一化。
10. 合并规则解析结果作为兜底。

---

### 字段白名单

校验后的结构只能包含：

```text
must.skills
must.company_names
must.company_tags
must.gender
must.age_min
must.age_max
should.skills
should.company_names
should.company_tags
keywords
limit
```

任何其他字段都必须丢弃。

---

### 归一化规则

#### 技能归一化

至少支持：

| 输入 | 标准值 |
|---|---|
| `Springboot` | `Spring Boot` |
| `springboot` | `Spring Boot` |
| `spring boot` | `Spring Boot` |
| `Spring Boot` | `Spring Boot` |
| `Java后端` | `Java` |
| `java后端` | `Java` |
| `Java` | `Java` |

#### 公司标签归一化

至少支持：

| 输入 | 标准值 |
|---|---|
| `国内大厂` | `国内大厂` |
| `互联网大厂` | `互联网大厂` |
| `世界500强` | `世界500强` |
| `世界 500 强` | `世界500强` |
| `fortune 500` | `世界500强` |
| `Fortune 500` | `世界500强` |

---

### 合并规则解析与 LLM Parser 输出

建议合并策略：

1. 规则解析得到的明确条件优先保留。
2. LLM Parser 的 `must` 条件经过校验后加入对应 `must`。
3. LLM Parser 的 `should` 条件经过校验后加入对应 `should`。
4. 去重。
5. 如果 LLM Parser 无效，则仅使用规则解析结果。
6. 如果规则解析和 LLM Parser 都没有可用条件，则返回可解释提示，不查询全量候选人。

输出结构示例：

```json
{
  "question": "帮我找有 Spring Boot 经验，并且最好有国内大厂经历的 Java 后端候选人，优先最近投递",
  "parser_valid": true,
  "query": {
    "must_skills": ["Spring Boot", "Java"],
    "must_company_names": [],
    "must_company_tags": [],
    "should_skills": ["微服务"],
    "should_company_names": [],
    "should_company_tags": ["国内大厂", "互联网大厂"],
    "keywords": ["后端", "最近投递"],
    "limit": 10
  }
}
```

---

### SQL 执行原则

即使引入 LLM Parser，SQL 仍必须满足：

- 使用固定 SQL 模板。
- 使用参数化查询。
- 不拼接用户原始问题。
- 不拼接 LLM 输出字符串。
- 不允许 LLM 指定表名。
- 不允许 LLM 指定字段名。
- 不允许 LLM 生成 WHERE 子句。

---

### 第一版查询模板建议

第一版可先支持以下条件：

- `must_skills`
- `must_company_tags`
- `should_skills`
- `should_company_tags`
- `limit`

暂不强制实现：

- `company_names`
- `gender`
- `age_min`
- `age_max`

如果暂未实现这些字段，需要在 Code 节点中保留但不进入 SQL，或记录到 `unsupported_filters`，避免误导用户。

示例 SQL：

```sql
WITH query_params AS (
  SELECT
    $1::text[] AS must_skills,
    $2::text[] AS must_company_tags,
    $3::text[] AS should_skills,
    $4::text[] AS should_company_tags
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
      CASE
        WHEN cardinality(q.must_skills) = 0 THEN 0
        WHEN c.matched_skills && q.must_skills THEN 100
        ELSE 0
      END +
      CASE
        WHEN cardinality(q.must_company_tags) = 0 THEN 0
        WHEN c.company_tags && q.must_company_tags THEN 100
        ELSE 0
      END +
      (
        SELECT COUNT(*) * 10
        FROM unnest(c.matched_skills) s
        WHERE s = ANY(q.should_skills)
      ) +
      (
        SELECT COUNT(*) * 10
        FROM unnest(c.company_tags) t
        WHERE t = ANY(q.should_company_tags)
      )
    ) AS score
  FROM candidate_search_index c
  CROSS JOIN query_params q
  WHERE
    (cardinality(q.must_skills) = 0 OR c.matched_skills && q.must_skills)
    AND
    (cardinality(q.must_company_tags) = 0 OR c.company_tags && q.must_company_tags)
    AND
    (
      cardinality(q.must_skills) > 0
      OR cardinality(q.must_company_tags) > 0
      OR cardinality(q.should_skills) > 0
      OR cardinality(q.should_company_tags) > 0
    )
)
SELECT *
FROM scored
ORDER BY score DESC, applied_at DESC
LIMIT $5;
```

参数示例：

```json
[
  ["Spring Boot", "Java"],
  [],
  ["微服务"],
  ["国内大厂", "互联网大厂"],
  10
]
```

注意：

- 该 SQL 仍是固定模板。
- `must` 作为硬性条件。
- `should` 只用于加分。
- 必须至少存在一个可用条件，否则不查询。

---

### 验收测试

#### 测试用例 1：复杂自然语言解析

请求：

```json
{
  "question": "帮我找有 Spring Boot 经验，并且最好有国内大厂经历的 Java 后端候选人，优先最近投递"
}
```

预期解析结果：

```json
{
  "must_skills": ["Spring Boot", "Java"],
  "should_company_tags": ["国内大厂", "互联网大厂"],
  "keywords": ["后端", "最近投递"],
  "limit": 10
}
```

预期查询行为：

- 候选人必须命中 `Spring Boot` 或 `Java` 中的技能条件，具体取决于当前 SQL 模板设计。
- `国内大厂` / `互联网大厂` 作为加分条件。
- 按 `score DESC, applied_at DESC` 排序。

---

#### 测试用例 2：明确硬性公司标签

请求：

```json
{
  "question": "找有 Springboot 经验，并且必须有国内大厂工作经验的候选人"
}
```

预期：

- `must_skills` 包含 `Spring Boot`。
- `must_company_tags` 包含 `国内大厂` 和 `互联网大厂`。
- SQL 使用硬性公司标签过滤。

---

#### 测试用例 3：世界500强偏好条件

请求：

```json
{
  "question": "找 Java 后端候选人，优先有世界500强经验"
}
```

预期：

- `must_skills` 包含 `Java`。
- `should_company_tags` 包含 `世界500强`。
- 世界500强只加分，不作为硬性过滤。

---

#### 测试用例 4：超大 limit 限制

请求：

```json
{
  "question": "找 100 个有 Spring Boot 经验的候选人"
}
```

预期：

- LLM Parser 可能输出 `limit = 20` 或更大。
- Code 校验后最终 `limit <= 20`。
- SQL 参数中的 limit 不超过 `20`。

---

#### 测试用例 5：LLM Parser 输出非法 JSON

模拟 LLM 输出：

```text
这里是解析结果：Spring Boot, 国内大厂
```

预期：

- Code 节点标记 `parser_valid = false`。
- 使用规则解析兜底。
- 如果规则也无法识别条件，则返回提示，不查询全量候选人。

---

#### 测试用例 6：未知字段注入

模拟 LLM 输出：

```json
{
  "sql": "SELECT * FROM candidate_resumes",
  "table": "candidate_resumes",
  "must": {
    "skills": ["Spring Boot"],
    "company_names": [],
    "company_tags": [],
    "gender": null,
    "age_min": null,
    "age_max": null
  },
  "should": {
    "skills": [],
    "company_names": [],
    "company_tags": []
  },
  "keywords": [],
  "limit": 10
}
```

预期：

- `sql` 和 `table` 字段被丢弃。
- 最终 SQL 仍使用固定模板。
- 不执行 LLM 输出中的 SQL。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n 中存在 LLM Query Parser 节点。
- LLM Query Parser 只接收用户问题，不接收简历原文。
- LLM Query Parser 输出固定 JSON 结构。
- Code 节点能解析和校验 LLM 输出。
- 非法 JSON 不会导致工作流执行不安全查询。
- 未知字段会被丢弃。
- `limit` 被限制为不超过 `20`。
- 技能名称经过归一化。
- 公司标签经过归一化。
- 现有规则解析被保留作为兜底。
- SQL 仍使用固定模板。
- SQL 仍使用参数化查询。
- LLM 不生成 SQL。
- LLM 不直接查询数据库。
- 无有效条件时不查询全量候选人。
- 查询结果仍只返回压缩字段。
- 最终回答仍由结果总结 LLM 基于压缩候选人生成。

---

### 调试建议

#### 1. LLM Parser 输出格式不稳定

检查：

- Prompt 是否明确要求只输出 JSON。
- 是否开启了结构化输出能力。
- 是否在下游 Code 节点中做了 JSON 解析异常处理。

#### 2. Parser 把偏好条件放进 must

检查：

- Prompt 是否明确区分“必须”和“优先”。
- 是否需要在 Code 节点中根据原始问题关键词二次校正。
- 对高频规则可继续以规则解析结果覆盖 LLM 输出。

#### 3. 查询返回过多候选人

检查：

- 是否存在有效 `must` 或 `should` 条件。
- 无条件时是否被阻断。
- `limit` 是否被限制。

#### 4. SQL 安全风险

检查：

- 是否有任何节点使用 LLM 输出拼接 SQL。
- 是否允许 LLM 输出表名或字段名进入 SQL。
- 是否所有 SQL 仍使用 `$1`、`$2` 等参数。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. LLM Query Parser 节点名称：
4. 复杂自然语言解析测试结果：
5. 明确硬性公司标签测试结果：
6. 世界500强偏好条件测试结果：
7. limit 限制测试结果：
8. 非法 JSON 测试结果：
9. 未知字段注入测试结果：
10. 是否保留规则兜底：
11. 是否使用固定 SQL 模板：
12. 是否使用参数化 SQL：
13. 是否出现全量查询风险：
14. 遗留问题：
```

---

### 风险与注意事项

- LLM Parser 的输出不可信，必须经过 Code 节点校验后才能使用。
- 即使 Parser 解析正确，也不能让 LLM 参与 SQL 生成。
- 规则解析不应立即删除，应继续作为稳定兜底。
- 如果 Parser 和规则解析冲突，优先保证安全和可解释性。
- 对真实业务场景，应持续补充字典、规则和回归测试用例。
- 建议定期用最新业务样例交叉验证解析质量和查询结果。