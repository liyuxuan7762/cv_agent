# Epic 01：基础数据与端到端链路准备

## Issue 01：确认原始简历基础数据可用

### 背景

在接入 n8n、构建索引表或加入任何智能检索逻辑之前，必须先确认原始简历数据已经正确生成，并且核心字段结构符合后续检索需求。

本 Issue 对应 MVP 计划中的：

- Step 0：确认基础数据可用

该阶段不接入 n8n，不创建索引，不使用 LLM，只验证 `candidate_resumes` 原始表的数据可用性。

---

### 目标

确认测试数据能够正常生成，并且 `candidate_resumes` 表中存在符合预期结构的候选人简历数据。

---

### 范围

#### 包含

- 执行已有数据生成脚本。
- 检查 `candidate_resumes` 表数据量。
- 抽样检查候选人基础字段。
- 抽样检查 `experience_if` 字段是否为合法 JSON 数组字符串。
- 确认数据中包含公司、职位、工作经历介绍等内容。

#### 不包含

- 不接入 n8n。
- 不创建 `candidate_search_index`。
- 不创建技能字典或公司字典。
- 不调用 LLM。
- 不做自然语言解析。
- 不做候选人排序或打分。

---

### 前置条件

- PostgreSQL 数据库可用。
- 项目依赖已安装。
- 已存在数据生成脚本：

```bash
node generate_resume_data.js
```

- 数据库中应存在或可由脚本创建 `candidate_resumes` 表。

---

### 实施步骤

#### 1. 执行数据生成脚本

在项目根目录执行：

```bash
node generate_resume_data.js
```

执行完成后，确认脚本无报错。

---

#### 2. 检查候选人总数

执行 SQL：

```sql
SELECT COUNT(*) FROM candidate_resumes;
```

预期结果：

- 返回数量为 `500`。

---

#### 3. 抽样检查候选人基础信息

执行 SQL：

```sql
SELECT
  user_id,
  name,
  birthdate,
  gender,
  aim_salary,
  LEFT(personal, 100) AS personal_preview,
  LEFT(experience_if, 300) AS experience_preview
FROM candidate_resumes
LIMIT 5;
```

检查内容：

- `user_id` 不为空。
- `name` 不为空。
- `birthdate` 有有效日期。
- `gender` 有值。
- `aim_salary` 有值。
- `personal_preview` 能看到个人描述。
- `experience_preview` 能看到工作经历相关内容。

---

#### 4. 检查 `experience_if` 是否为 JSON 数组字符串

执行 SQL：

```sql
SELECT
  user_id,
  jsonb_typeof(experience_if::jsonb) AS experience_type
FROM candidate_resumes
LIMIT 10;
```

预期结果：

- `experience_type` 应为 `array`。

如果存在解析错误，说明 `experience_if` 不是合法 JSON，需要先修复数据生成脚本或已有数据。

---

#### 5. 抽样检查工作经历内容

执行 SQL：

```sql
SELECT
  user_id,
  name,
  experience_if::jsonb -> 0 ->> 'company' AS first_company,
  experience_if::jsonb -> 0 ->> 'title' AS first_title,
  LEFT(experience_if::jsonb -> 0 ->> 'description', 200) AS first_description_preview
FROM candidate_resumes
LIMIT 10;
```

检查内容：

- `first_company` 能看到公司名称。
- `first_title` 能看到职位名称。
- `first_description_preview` 能看到工作经历介绍。
- 至少部分候选人具备可用于后续技能和公司标签抽取的文本。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- `candidate_resumes` 表中有 `500` 条数据。
- `experience_if` 是合法 JSON 数组字符串。
- 抽样数据中能看到候选人基础信息。
- 抽样数据中能看到公司、职位、工作经历介绍等内容。
- 本阶段没有接入 n8n。
- 本阶段没有调用 LLM。
- 本阶段没有返回或处理完整简历给 AI。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. node generate_resume_data.js 执行结果：
2. SELECT COUNT(*) 结果：
3. experience_if JSON 校验结果：
4. 抽样检查结论：
5. 遗留问题：
```

---

### 风险与注意事项

- 如果 `COUNT(*)` 不是 `500`，需要确认脚本是否重复插入、清表逻辑是否正确，或数据生成是否中途中断。
- 如果 `experience_if::jsonb` 转换失败，后续索引构建将无法可靠解析工作经历。
- 如果工作经历中缺少公司或职位字段，后续 `latest_company`、`latest_title`、`matched_companies` 的构建会受到影响。
- 当前阶段只验证数据可用性，不应提前引入复杂检索逻辑。

---

### 下一步

通过本 Issue 后，再进入下一个 Issue：打通 n8n Webhook 到 PostgreSQL 的最小查询链路。