# Epic 07：扩展公司标签体系

## Issue 02：加入最终 LLM 回答生成并限制其只总结压缩候选人结果

### 背景

当前系统已经完成了规则检索阶段的核心能力：

- 能基于技能条件查询候选人。
- 能基于公司标签查询候选人。
- 能组合技能条件和公司标签条件查询候选人。
- 能扩展公司标签，例如 `世界500强`。
- n8n 查询结果已经控制为结构化、压缩后的候选人列表。

本 Issue 对应 MVP 计划中的：

- Step 11：加入最终 LLM 回答生成，但只基于压缩结果

该阶段第一次引入 LLM，但 LLM 的职责必须严格限定为：

> 根据已经检索出来的压缩候选人结果，生成中文、简洁、可读、可操作的 HR 回答。

LLM 不允许直接查库，不允许生成 SQL，不允许读取完整简历，不允许基于未提供的信息编造候选人内容。

---

### 目标

在现有 n8n 检索工作流后增加 LLM 回答生成节点，使最终 Webhook 返回更适合 HR 阅读的中文回答。

核心目标：

1. 检索仍由规则解析和固定 SQL 完成。
2. LLM 只接收压缩后的候选人列表。
3. LLM 只基于输入数据生成回答。
4. 每个候选人说明命中原因。
5. 如果没有结果，LLM 明确说明没有匹配结果，并建议放宽条件。
6. 输出最多 10 个候选人。
7. 不输出完整简历原文。

---

### 范围

#### 包含

- 在已有 n8n 检索工作流后增加 LLM 节点。
- 在 LLM 前增加 Code 节点，生成压缩候选人列表。
- 为每个候选人生成或保留 `reason`。
- 构造受控 Prompt。
- 要求 LLM 使用中文输出 HR 可读回答。
- 处理有结果和无结果两类情况。
- 返回最终自然语言回答，同时可保留结构化调试信息。

#### 不包含

- 不让 LLM 直接访问 PostgreSQL。
- 不让 LLM 生成 SQL。
- 不让 LLM 修改查询条件。
- 不让 LLM 读取 `candidate_resumes` 原始表。
- 不向 LLM 传递 `experience_if`。
- 不向 LLM 传递 `full_text`。
- 不向 LLM 传递完整工作经历原文。
- 不实现详情查询。
- 不引入 LLM Query Parser。
- 不替换现有规则解析逻辑。

---

### 前置条件

- Epic 06 / Issue 01 已完成：技能与公司标签组合查询可用。
- Epic 07 / Issue 01 已完成：`世界500强` 标签扩展可用。
- n8n 中至少已有一个可稳定返回压缩候选人结果的检索工作流。
- 返回候选人字段已严格限制，不包含：
  - `full_text`
  - `experience_if`
  - `personal`
  - 完整工作经历文本
- n8n 已配置可用的 LLM 节点或模型凭据。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Code: 规则解析和归一化
  ↓
Postgres: 查询 candidate_search_index
  ↓
Code: 压缩候选人列表 + 生成命中原因
  ↓
LLM: 生成 HR 可读中文回答
  ↓
Respond to Webhook
```

说明：

- LLM 节点必须放在数据库检索之后。
- LLM 输入必须来自压缩候选人列表。
- 不应让 LLM 参与 SQL 构造或数据库查询。

---

### LLM 输入数据结构

传给 LLM 的单个候选人结构应控制为：

```json
{
  "user_id": "U000123",
  "name": "张伟",
  "gender": "男",
  "birthdate": "1995-04-12",
  "aim_salary": "30000元/月",
  "latest_company": "阿里巴巴",
  "latest_title": "高级Java开发工程师",
  "matched_skills": ["Java", "Spring Boot", "微服务"],
  "matched_companies": ["阿里巴巴"],
  "company_tags": ["国内大厂", "互联网大厂", "电商"],
  "score": 200,
  "reason": "命中 Spring Boot；有国内大厂经历"
}
```

允许传给 LLM 的字段：

- `user_id`
- `name`
- `gender`
- `birthdate`
- `aim_salary`
- `latest_company`
- `latest_title`
- `matched_skills`
- `matched_companies`
- `company_tags`
- `score`
- `reason`

禁止传给 LLM 的字段：

- `full_text`
- `experience_if`
- `personal`
- `description`
- 完整项目经历
- 完整工作经历原文
- 未经压缩的大段简历文本

---

### 实施步骤

#### 1. 选择要接入 LLM 的检索工作流

建议优先在组合查询工作流中接入 LLM，例如：

```text
candidate-search-skill-company
```

原因：

- 组合查询最接近真实 HR 检索场景。
- 已包含 `matched_skills`、`matched_companies`、`company_tags` 和 `reason`。
- 适合作为最终回答生成的第一版验证入口。

---

#### 2. 在 LLM 前增加压缩结果 Code 节点

节点名称建议：

```text
Build LLM Candidate Summary Input
```

节点职责：

1. 接收 PostgreSQL 查询结果。
2. 只保留允许字段。
3. 限制候选人数量最多 10 个。
4. 为每个候选人生成或保留 `reason`。
5. 构造 LLM 输入对象。
6. 确保不包含禁止字段。

输出结构建议：

```json
{
  "question": "找有 Springboot 经验，并且有国内大厂工作经验的候选人",
  "query": {
    "must_skills": ["Spring Boot"],
    "must_company_tags": ["国内大厂", "互联网大厂"],
    "limit": 10
  },
  "candidate_count": 2,
  "candidates": [
    {
      "user_id": "U000123",
      "name": "张伟",
      "gender": "男",
      "birthdate": "1995-04-12",
      "aim_salary": "30000元/月",
      "latest_company": "阿里巴巴",
      "latest_title": "高级Java开发工程师",
      "matched_skills": ["Java", "Spring Boot", "微服务"],
      "matched_companies": ["阿里巴巴"],
      "company_tags": ["国内大厂", "互联网大厂", "电商"],
      "score": 200,
      "reason": "命中 Spring Boot；有国内大厂经历"
    }
  ]
}
```

---

#### 3. 增加字段安全检查

在压缩 Code 节点中增加显式过滤，禁止以下字段进入 LLM：

```text
full_text
experience_if
personal
description
experience_preview
personal_preview
```

建议检查方式：

- 不使用对象整体透传。
- 不使用 `...item.json` 展开全部字段。
- 手动逐字段构造候选人对象。

错误示例：

```javascript
const candidates = items.map(item => item.json);
```

正确思路：

```javascript
const candidates = items.slice(0, 10).map(item => ({
  user_id: item.json.user_id,
  name: item.json.name,
  gender: item.json.gender,
  birthdate: item.json.birthdate,
  aim_salary: item.json.aim_salary,
  latest_company: item.json.latest_company,
  latest_title: item.json.latest_title,
  matched_skills: item.json.matched_skills || [],
  matched_companies: item.json.matched_companies || [],
  company_tags: item.json.company_tags || [],
  score: item.json.score,
  reason: item.json.reason
}));
```

---

#### 4. 配置 LLM Prompt

LLM Prompt 建议：

```text
你是 HR 简历检索助手。请根据候选人检索结果，用中文给出简洁、可读、可操作的回答。

要求：
1. 不要编造候选人信息。
2. 只基于提供的候选人列表回答。
3. 每个候选人说明命中原因。
4. 如果没有结果，说明可能原因，并建议放宽条件。
5. 输出最多 10 个候选人。
6. 不要输出完整简历原文。
7. 不要声称你查看了未提供的简历详情。
8. 不要补充未提供的工作年限、学历、项目经历或离职原因。

用户问题：
{{ question }}

检索条件：
{{ query }}

候选人检索结果：
{{ candidates }}
```

说明：

- `question`、`query`、`candidates` 应来自上一 Code 节点的结构化输出。
- 如果 n8n LLM 节点支持系统消息和用户消息，建议将规则放入系统消息，将数据放入用户消息。

---

#### 5. 有结果时的输出格式

LLM 输出建议格式：

```text
根据当前检索条件，共找到 2 位匹配候选人：

1. 张伟（U000123）
   - 最近公司/职位：阿里巴巴 / 高级Java开发工程师
   - 期望薪资：30000元/月
   - 命中技能：Java、Spring Boot、微服务
   - 命中公司/标签：阿里巴巴；国内大厂、互联网大厂、电商
   - 推荐理由：命中 Spring Boot；有国内大厂经历

2. 李娜（U000234）
   - 最近公司/职位：腾讯 / 后端开发工程师
   - 期望薪资：28000元/月
   - 命中技能：Java、Spring Boot
   - 命中公司/标签：腾讯；国内大厂、互联网大厂、社交、游戏
   - 推荐理由：命中 Spring Boot；有国内大厂经历
```

要求：

- 不输出候选人未提供的信息。
- 不输出完整经历。
- 不扩展解释数据库中没有的内容。

---

#### 6. 无结果时的输出格式

如果 `candidates` 为空数组，LLM 应输出类似：

```text
未找到完全匹配当前条件的候选人。

可能原因：
- 当前技能条件和公司背景条件组合较严格。
- 候选人索引中可能缺少对应技能或公司标签。

建议可以尝试放宽条件，例如：
- 只查询 Spring Boot 经验；
- 或只查询国内大厂经验；
- 或将公司背景从必须条件改为优先条件。
```

注意：

- 不要编造候选人。
- 不要返回随机候选人。
- 不要暗示系统查询了未提供的完整简历。

---

#### 7. Respond to Webhook 返回结构

建议最终 Webhook 返回结构：

```json
{
  "success": true,
  "stage": "step_11_llm_answer_generation",
  "answer": "根据当前检索条件，共找到 2 位匹配候选人：...",
  "query": {
    "must_skills": ["Spring Boot"],
    "must_company_tags": ["国内大厂", "互联网大厂"],
    "limit": 10
  },
  "candidate_count": 2
}
```

调试阶段可以临时保留压缩候选人列表：

```json
{
  "debug_candidates": []
}
```

但应注意：

- `debug_candidates` 只能包含压缩字段。
- 不应包含 `full_text`、`experience_if`、`personal`。
- 如果用于演示或生产，应考虑关闭或隐藏调试字段。

---

### 验收测试

#### 测试用例 1：组合条件有结果

请求：

```json
{
  "question": "找有 Springboot 经验，并且有国内大厂工作经验的候选人"
}
```

预期：

- 数据库检索返回最多 10 条压缩候选人。
- LLM 输出中文回答。
- 每个候选人包含命中原因。
- 不输出完整简历原文。
- 不编造未提供的信息。

---

#### 测试用例 2：世界500强查询有结果

请求：

```json
{
  "question": "优先考虑有世界500强企业工作经验的候选人"
}
```

预期：

- 检索结果基于 `company_tags` 中的 `世界500强`。
- LLM 回答中说明候选人命中的公司和标签。
- 不补充未提供的公司背景解释。

---

#### 测试用例 3：无结果

请求：

```json
{
  "question": "找有 Spring Boot 经验，并且有世界500强和国内大厂双重背景的候选人"
}
```

如果检索结果为空，预期：

- LLM 明确说明未找到完全匹配结果。
- LLM 给出放宽条件建议。
- 不返回随机候选人。
- 不编造候选人。

---

#### 测试用例 4：字段安全检查

人工检查传给 LLM 的输入，确认不包含：

- `full_text`
- `experience_if`
- `personal`
- `description`
- 完整工作经历文本

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n 工作流中已增加 LLM 回答生成节点。
- LLM 节点位于数据库检索和压缩字段 Code 节点之后。
- LLM 输入只包含压缩候选人结果。
- LLM 输入不包含 `full_text`。
- LLM 输入不包含 `experience_if`。
- LLM 输入不包含 `personal`。
- LLM 输入不包含完整工作经历原文。
- LLM 不生成 SQL。
- LLM 不直接查询数据库。
- LLM 输出中文 HR 可读回答。
- 每个候选人都有命中原因。
- 输出最多 10 个候选人。
- 无结果时能明确说明无匹配，并建议放宽条件。
- LLM 不编造未提供的信息。
- Webhook 能返回最终 `answer`。

---

### 调试建议

#### 1. LLM 编造候选人信息

检查：

- Prompt 是否明确要求只基于候选人列表回答。
- 是否向 LLM 传入了空候选人列表但没有明确说明。
- 是否要求 LLM “推荐更多候选人”导致模型补全。
- 是否在 Prompt 中加入了示例候选人但未标明为示例。

#### 2. LLM 输出完整简历或长段经历

检查：

- LLM 输入是否包含 `full_text`、`experience_if` 或长文本字段。
- Prompt 是否明确要求不要输出完整简历原文。
- 压缩 Code 节点是否误用了 `...item.json`。

#### 3. LLM 回答和检索结果不一致

检查：

- `reason` 是否由结构化字段生成。
- LLM 输入中的 `matched_skills`、`matched_companies`、`company_tags` 是否正确。
- 是否传入了多个节点的混合数据导致上下文错乱。

#### 4. 无结果时仍然返回候选人

检查：

- 数据库查询结果是否确实为空。
- 是否有兜底逻辑查询了其他候选人。
- LLM Prompt 是否要求“即使没有结果也推荐候选人”。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. LLM 节点名称：
4. 组合条件有结果测试：
5. 世界500强查询测试：
6. 无结果测试：
7. LLM 输入字段检查结果：
8. 是否包含 full_text：
9. 是否包含 experience_if：
10. 是否包含 personal：
11. 是否输出完整简历原文：
12. 是否发现编造信息：
13. Webhook 最终 answer 检查：
14. 遗留问题：
```

---

### 风险与注意事项

- LLM 只能做表达层总结，不能参与数据库查询决策。
- LLM 输入字段越多，越容易产生过度总结或泄露上下文，因此必须坚持压缩结果输入。
- 不要把完整简历原文传给 LLM，否则会破坏前面 MVP 阶段建立的上下文控制原则。
- 如果需要查看完整简历，应在后续详情查询分支中单独实现，并且一次只查询一个候选人。
- Prompt 应定期根据实际输出效果调整，但不能放宽“不编造”和“不输出完整简历”的约束。

---

### 下一步

通过本 Issue 后，再进入下一个 Epic：增加详情查询分支，将列表检索和单人详细简历查看分离。