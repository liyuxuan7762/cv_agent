# Epic 08：详情查询分支与上下文隔离

## Issue 01：增加单人详细简历查询分支

### 背景

当前系统已经支持列表检索，并且已经在列表检索结果后接入 LLM 生成 HR 可读回答。列表检索阶段始终只返回压缩后的候选人信息，不返回完整简历原文。

本 Issue 对应 MVP 计划中的：

- Step 12：增加详情查询分支

该阶段的目标是将“候选人列表检索”和“单个候选人详情查看”明确分离。只有当用户明确请求查看某个候选人的详细简历时，才允许查询 `candidate_resumes.experience_if` 等完整字段，并且一次只查询一个候选人。

---

### 目标

在 n8n 工作流中增加详情查询分支，使系统能够：

1. 识别用户是否在请求某个候选人的详细简历。
2. 从用户问题中提取 `user_id`。
3. 只在详情查询分支中查询 `candidate_resumes` 原始表。
4. 一次只查询一个候选人的详细信息。
5. 使用 LLM 对单个候选人的详细简历进行中文总结。
6. 不在列表检索阶段返回完整工作经历。
7. 保持列表检索和详情查看的上下文隔离。

---

### 范围

#### 包含

- 在 n8n Code 节点中识别详情查询意图。
- 支持从用户问题中提取 `user_id`，例如 `U000123`。
- 增加 IF 分支：
  - 是详情查询：查询 `candidate_resumes` 单人详情。
  - 不是详情查询：继续走已有候选人检索流程。
- 使用参数化 SQL 查询单个候选人详情。
- 将单人详情传给 LLM 做中文总结。
- 控制详情查询一次只返回一个候选人。
- 对找不到候选人的情况返回可解释提示。

#### 不包含

- 不在列表检索流程中查询 `experience_if`。
- 不批量查询多个候选人的完整简历。
- 不让 LLM 生成 SQL。
- 不让 LLM 决定查询哪个表。
- 不让 LLM 绕过 `user_id` 校验。
- 不实现复杂多轮上下文记忆。
- 不实现候选人附件解析。
- 不实现简历下载。
- 不实现权限系统。
- 不引入 LLM Query Parser。

---

### 前置条件

- Epic 07 / Issue 02 已完成：LLM 已能基于压缩候选人结果生成回答。
- 已有列表检索流程稳定可用。
- `candidate_resumes` 表中存在候选人原始简历数据。
- `candidate_resumes.user_id` 可唯一定位候选人。
- n8n 已配置 PostgreSQL Credential。
- n8n 已配置可用 LLM 节点或模型凭据。

---

### 推荐 n8n 工作流

```text
Webhook
  ↓
Code: 判断是否为详情查询并提取 user_id
  ↓
IF: is_detail_query?
  ├─ 是：Postgres 查询 candidate_resumes 单人详情
  │      ↓
  │    Code: 压缩并组织单人详情输入
  │      ↓
  │    LLM: 总结单人详细简历
  │      ↓
  │    Respond to Webhook
  │
  └─ 否：走已有候选人检索流程
         ↓
       Postgres 查询 candidate_search_index
         ↓
       Code: 压缩候选人列表
         ↓
       LLM: 生成 HR 列表回答
         ↓
       Respond to Webhook
```

---

### 详情查询触发条件

支持以下用户输入示例：

```text
查看 U000123 的详细简历
```

```text
U000123 的完整经历是什么？
```

```text
帮我看一下 U000123 的详细工作经历
```

```text
候选人 U000123 的详情
```

第一版触发规则可以保持简单：

1. 问题中包含符合格式的 `user_id`。
2. 问题中包含详情相关关键词之一：
   - `详细`
   - `详情`
   - `完整经历`
   - `完整简历`
   - `工作经历`
   - `经历是什么`

---

### 实施步骤

#### 1. 增加详情意图识别 Code 节点

节点名称建议：

```text
Detect Detail Query
```

Code 示例：

```javascript
const question = $json.body?.question || $json.question || '';

const userIdMatch = question.match(/\bU\d{6}\b/i);
const userId = userIdMatch ? userIdMatch[0].toUpperCase() : null;

const detailKeywords = [
  '详细',
  '详情',
  '完整经历',
  '完整简历',
  '工作经历',
  '经历是什么'
];

const isDetailQuery = Boolean(
  userId &&
  detailKeywords.some(keyword => question.includes(keyword))
);

return [{
  json: {
    question,
    is_detail_query: isDetailQuery,
    user_id: userId
  }
}];
```

输出示例：

```json
{
  "question": "查看 U000123 的详细简历",
  "is_detail_query": true,
  "user_id": "U000123"
}
```

---

#### 2. 增加 IF 分支

在详情识别节点后增加 IF 节点。

判断条件：

```text
is_detail_query == true
```

分支说明：

- `true` 分支：进入单人详情查询。
- `false` 分支：进入已有列表检索流程。

注意：

- 详情分支和列表检索分支应保持清晰隔离。
- 不要在 false 分支中查询 `candidate_resumes.experience_if`。

---

#### 3. 增加单人详情 PostgreSQL 查询节点

节点名称建议：

```text
Query Candidate Detail By User ID
```

详情查询 SQL：

```sql
SELECT
  user_id,
  name,
  birthdate,
  gender,
  aim_salary,
  personal,
  applied_at,
  experience_if
FROM candidate_resumes
WHERE user_id = $1
LIMIT 1;
```

参数示例：

```json
[
  "U000123"
]
```

注意：

- 必须使用参数化 SQL。
- 必须通过 `user_id` 查询。
- 必须 `LIMIT 1`。
- 不允许通过姓名模糊查询详情。
- 不允许一次查询多个候选人详情。

---

#### 4. 处理候选人不存在的情况

如果详情查询返回 0 条，应返回可解释响应。

推荐响应：

```json
{
  "success": false,
  "stage": "step_12_candidate_detail_query",
  "message": "未找到该候选人的详细简历，请确认 user_id 是否正确。",
  "query": {
    "user_id": "U000123"
  }
}
```

不要：

- 返回随机候选人。
- 改查列表检索。
- 让 LLM 猜测候选人信息。

---

#### 5. 增加详情输入压缩 Code 节点

节点名称建议：

```text
Build Candidate Detail LLM Input
```

该节点职责：

1. 接收单个候选人的详情记录。
2. 解析或保留 `experience_if`。
3. 将详情组织为受控结构。
4. 只传递当前候选人数据给 LLM。
5. 不混入列表检索结果。

建议传给 LLM 的结构：

```json
{
  "user_id": "U000123",
  "name": "张伟",
  "gender": "男",
  "birthdate": "1995-04-12",
  "aim_salary": "30000元/月",
  "applied_at": "2026-07-10T10:00:00.000Z",
  "personal": "候选人个人简介文本",
  "experience": [
    {
      "company": "阿里巴巴",
      "title": "高级Java开发工程师",
      "start_date": "2021-01",
      "end_date": "2024-06",
      "description": "工作经历描述"
    }
  ]
}
```

说明：

- 详情查询允许传递 `personal` 和 `experience_if` 解析后的单人经历。
- 但必须只针对一个 `user_id`。
- 如果 `experience_if` 字段过长，可以先限制或截断每段 `description` 的长度，避免上下文过大。

---

#### 6. 配置详情总结 LLM Prompt

建议 Prompt：

```text
你是 HR 简历详情总结助手。请根据提供的单个候选人详细简历信息，用中文进行简洁、结构化总结。

要求：
1. 只基于提供的候选人详情回答。
2. 不要编造未提供的信息。
3. 不要补充未提供的学历、工作年限、离职原因或项目成果。
4. 一次只总结当前一个候选人。
5. 可以总结个人简介、最近经历、主要公司、职位和技能线索。
6. 如果工作经历为空或字段缺失，请明确说明信息缺失。
7. 不要输出原始 JSON。
8. 不要逐字完整复述长段简历原文，应做摘要。

用户问题：
{{ question }}

候选人详情：
{{ candidate_detail }}
```

---

#### 7. 详情回答输出格式

建议 LLM 输出格式：

```text
候选人 U000123（张伟）详情摘要：

1. 基础信息
   - 性别：男
   - 出生日期：1995-04-12
   - 期望薪资：30000元/月
   - 投递时间：2026-07-10

2. 个人简介摘要
   - 候选人具备 Java 后端和 Spring Boot 相关经验。

3. 工作经历摘要
   - 阿里巴巴 / 高级Java开发工程师：主要参与后端系统开发和微服务相关工作。
   - 某科技公司 / Java开发工程师：参与业务系统开发。

4. HR 关注点
   - 可重点关注其最近公司、职位稳定性、技能匹配度和期望薪资是否符合岗位预算。
```

要求：

- 不逐字输出完整 `experience_if`。
- 不添加未提供信息。
- 不评价候选人“优秀”或“强烈推荐”，除非检索数据支持。
- 不输出多个候选人。

---

### 验收测试

#### 测试用例 1：查看详细简历

请求：

```json
{
  "question": "查看 U000123 的详细简历"
}
```

预期：

- `is_detail_query` 为 `true`。
- `user_id` 为 `U000123`。
- 查询 `candidate_resumes`。
- 只返回并总结一个候选人。
- 回答中包含基础信息和工作经历摘要。

---

#### 测试用例 2：完整经历提问

请求：

```json
{
  "question": "U000123 的完整经历是什么？"
}
```

预期：

- 进入详情查询分支。
- 查询 `candidate_resumes WHERE user_id = $1 LIMIT 1`。
- LLM 对该候选人经历进行摘要，而不是完整原文复述。

---

#### 测试用例 3：列表检索不进入详情分支

请求：

```json
{
  "question": "找有 Springboot 经验，并且有国内大厂工作经验的候选人"
}
```

预期：

- `is_detail_query` 为 `false`。
- 不查询 `candidate_resumes.experience_if`。
- 继续走已有列表检索流程。
- 列表回答仍只基于压缩候选人结果。

---

#### 测试用例 4：只有 user_id 但没有详情关键词

请求：

```json
{
  "question": "U000123"
}
```

预期：

- 第一版可以不进入详情查询分支。
- 返回提示或走默认流程。
- 不应直接返回完整简历。

---

#### 测试用例 5：候选人不存在

请求：

```json
{
  "question": "查看 U999999 的详细简历"
}
```

预期：

- 进入详情查询分支。
- 数据库返回 0 条。
- 返回“未找到该候选人”的可解释提示。
- 不调用 LLM 编造详情。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- n8n 能识别详情查询意图。
- n8n 能从问题中提取 `user_id`。
- 详情查询使用参数化 SQL。
- 详情查询 SQL 包含 `WHERE user_id = $1`。
- 详情查询 SQL 包含 `LIMIT 1`。
- 详情分支只查询一个候选人的 `candidate_resumes`。
- 只有详情分支允许查询 `experience_if`。
- 列表检索分支不查询 `experience_if`。
- 列表检索分支不返回完整简历。
- 详情分支能调用 LLM 总结单个候选人详情。
- LLM 不编造未提供的信息。
- LLM 不逐字复述完整简历原文。
- 候选人不存在时返回明确提示。
- 不允许 LLM 生成 SQL。
- 不允许批量详情查询。

---

### 调试建议

#### 1. 详情查询没有触发

检查：

- `user_id` 正则是否匹配当前数据格式。
- 用户问题中是否包含详情关键词。
- IF 节点是否判断 `is_detail_query == true`。
- `user_id` 是否被转换为大写。

#### 2. 误把列表查询当成详情查询

检查：

- 是否只根据 `user_id` 触发详情查询。
- 是否要求同时包含详情关键词。
- 列表检索问题中是否误带了类似 `U000123` 的文本。

#### 3. 返回了多个候选人的详情

检查：

- SQL 是否包含 `WHERE user_id = $1`。
- SQL 是否包含 `LIMIT 1`。
- 是否错误使用了 `WHERE user_id = ANY($1)`。
- 是否在 Code 节点中合并了多个候选人的详情。

#### 4. LLM 输出了完整原文

检查：

- Prompt 是否要求摘要而非逐字复述。
- `experience_if` 是否过长。
- 是否需要在 Code 节点中截断每段 `description`。
- 是否误将原始 JSON 直接展示给用户。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. n8n 工作流名称：
2. Webhook Path：
3. 详情查询识别测试结果：
4. user_id 提取结果：
5. 单人详情 SQL 测试结果：
6. 列表检索分支回归结果：
7. 候选人不存在测试结果：
8. 是否只查询一个候选人：
9. 列表分支是否包含 experience_if：
10. 详情分支 LLM 总结结果：
11. 是否发现编造信息：
12. 是否逐字输出完整简历：
13. 遗留问题：
```

---

### 风险与注意事项

- 详情查询会访问更完整的候选人信息，应严格限制触发条件。
- 一次只允许查询一个候选人，避免把大量完整简历传给 LLM。
- 列表检索和详情查看必须分离，不能为了方便在列表结果中附带完整经历。
- LLM 只能总结已查询到的单个候选人详情，不能补充数据库中没有的信息。
- 如果用于真实业务，应结合权限控制、审计日志和数据最小化原则。
- 当前阶段不实现 LLM Query Parser，复杂自然语言解析留到后续 Epic。