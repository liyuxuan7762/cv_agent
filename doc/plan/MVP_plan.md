本项目建议采用渐进式 MVP 方法，不要等所有能力都开发完成后再接入 n8n。每完成一个最小能力，就立刻通过手工 SQL 和 n8n Webhook 做端到端验证。

推荐原则：

1. **先不用 LLM，也能查到结果**
   - 先用固定参数验证索引表和 SQL 是否可靠。

2. **先查少量字段，不返回完整简历**
   - 从第一步开始就控制上下文，避免形成“查出大量原文再交给 AI”的坏模式。

3. **每一步都有可运行产物**
   - 每个阶段都应该能通过 n8n Webhook 调用一次，并看到可解释的结果。

4. **先规则，后 LLM**
   - 技能归一化、公司标签归一化优先用字典和规则实现。
   - LLM 只在后续用于解析复杂自然语言和生成最终回答。

---

### Step 0：确认基础数据可用

目标：确认原始简历表有数据，并且测试数据结构符合预期。

执行：

```bash
node generate_resume_data.js
```

手工检查：

```sql
SELECT COUNT(*) FROM candidate_resumes;
```

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

验收标准：

- `candidate_resumes` 中有 500 条数据。
- `experience_if` 是合法 JSON 数组字符串。
- 能看到公司、职位、工作经历介绍等内容。

此阶段暂不接入 n8n。

---

### Step 1：先做最简单的 n8n Webhook 查询原始表

目标：先打通 n8n 到 PostgreSQL 的连接，不做智能检索。

n8n 工作流：

```text
Webhook
  ↓
Postgres: SELECT 原始表前 5 条
  ↓
Respond to Webhook
```

测试 SQL：

```sql
SELECT
  user_id,
  name,
  gender,
  birthdate,
  aim_salary,
  applied_at
FROM candidate_resumes
ORDER BY applied_at DESC
LIMIT 5;
```

Webhook 测试输入：

```json
{
  "question": "最近投递的候选人"
}
```

验收标准：

- n8n Webhook 能返回 5 条候选人基础信息。
- 不返回 `experience_if`。
- 不调用 LLM。

为什么先做这一步：

- 先排除 n8n 数据库连接、权限、网络、凭据配置问题。
- 确认端到端调用链路是通的。

---

### Step 2：创建最小技能字典，只解决一个问题：Springboot 归一化

目标：先不要一次性维护完整字典，只解决一个高频测试问题。

新增脚本：

```text
seed_dictionaries.js
```

第一版只需要创建 `skill_dictionary`，并插入少量技能：

```sql
CREATE TABLE IF NOT EXISTS skill_dictionary (
  id BIGSERIAL PRIMARY KEY,
  skill_name VARCHAR(100) NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  related_terms TEXT[] NOT NULL DEFAULT '{}',
  category VARCHAR(100),
  weight INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

第一批数据：

```sql
INSERT INTO skill_dictionary
(skill_name, aliases, related_terms, category, weight)
VALUES
('Java', ARRAY['J2EE', 'Java后端'], ARRAY['Spring Boot', 'Spring Cloud', 'MyBatis', '微服务'], '后端开发', 5),
('Spring Boot', ARRAY['SpringBoot', 'springboot', 'spring boot'], ARRAY['Java', 'Spring Cloud', '微服务'], '后端开发', 5),
('微服务', ARRAY['Microservices', 'microservice'], ARRAY['Java', 'Spring Boot', 'Spring Cloud'], '架构', 4)
ON CONFLICT (skill_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  related_terms = EXCLUDED.related_terms,
  category = EXCLUDED.category,
  weight = EXCLUDED.weight,
  updated_at = NOW();
```

验收 SQL：

```sql
SELECT *
FROM skill_dictionary
WHERE skill_name = 'Spring Boot';
```

验收标准：

- 能查到 `Spring Boot`。
- `aliases` 包含 `SpringBoot`、`springboot`、`spring boot`。
- `related_terms` 包含 `Java`、`Spring Cloud`、`微服务`。

此阶段仍不需要 LLM。

---

### Step 3：构建第一版归一化索引，只验证技能召回

目标：创建 `candidate_search_index`，先只关注：

- `full_text`
- `matched_skills`
- `latest_company`
- `latest_title`

已有脚本：

```text
build_search_index.js
```

执行：

```bash
node seed_dictionaries.js
node build_search_index.js
```

手工验证：

```sql
SELECT
  user_id,
  name,
  latest_company,
  latest_title,
  matched_skills
FROM candidate_search_index
WHERE matched_skills && ARRAY['Spring Boot']::text[]
LIMIT 10;
```

再验证相关技能：

```sql
SELECT
  user_id,
  name,
  latest_company,
  latest_title,
  matched_skills
FROM candidate_search_index
WHERE matched_skills && ARRAY['Java']::text[]
LIMIT 10;
```

验收标准：

- `candidate_search_index` 有数据。
- 能查询到 `matched_skills` 包含 `Spring Boot` 的候选人。
- 能查询到 `matched_skills` 包含 `Java` 的候选人。

注意：此阶段不要急着解决“国内大厂”“世界 500 强”，先确认技能索引工作正常。

---

### Step 4：把技能索引查询接入 n8n Webhook，不使用 LLM

目标：让 n8n 能调用索引表完成一次固定技能查询。

n8n 工作流：

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

Postgres SQL：

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

Webhook 测试输入：

```json
{
  "question": "找有 Springboot 经验的候选人"
}
```

注意：这一阶段可以暂时忽略 `question` 内容，固定查 `Spring Boot`。

验收标准：

- Webhook 能返回 Top 10 候选人。
- 返回字段不包含完整 `full_text`。
- 返回字段不包含完整 `experience_if`。
- 用户虽然输入 `Springboot`，但当前阶段通过固定参数验证索引查询链路。

---

### Step 5：在 n8n Code 节点中加入最小归一化规则

目标：让 n8n 根据用户问题识别 `Springboot`、`spring boot`、`Spring Boot`，并统一查询 `Spring Boot`。

n8n 工作流：

```text
Webhook
  ↓
Code: 从 question 中识别技能并归一化
  ↓
Postgres: 按 must_skills 查询索引表
  ↓
Code: 压缩返回字段
  ↓
Respond to Webhook
```

Code 节点示例：

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

if (question.includes('Java') || question.includes('java后端') || question.includes('Java后端')) {
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

Postgres 查询改为参数化：

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

Webhook 测试用例：

```json
{
  "question": "找有 Springboot 经验的候选人"
}
```

```json
{
  "question": "找有 spring boot 经验的候选人"
}
```

```json
{
  "question": "找 Java 后端候选人"
}
```

验收标准：

- 三种 Spring Boot 写法都能查到同一类候选人。
- Java 查询能返回 Java 候选人。
- 整个链路仍不依赖 LLM。

---

### Step 6：加入技能相关词扩展和简单打分

目标：解决“有 Spring Boot 经验的人，优先 Java / 微服务经验”的排序问题。

逻辑：

- 用户明确要求的技能进入 `must_skills`。
- 字典中的 `related_terms` 进入 `should_skills`。
- 命中 `must_skills` 是基础条件。
- 命中 `should_skills` 用于加分排序。

可先在 n8n 中查询字典：

```sql
SELECT skill_name, aliases, related_terms
FROM skill_dictionary
WHERE skill_name = ANY($1::text[])
   OR aliases && $1::text[];
```

生成参数示例：

```json
{
  "must_skills": ["Spring Boot"],
  "should_skills": ["Java", "Spring Cloud", "微服务"],
  "limit": 10
}
```

检索 SQL：

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

n8n Webhook 测试：

```json
{
  "question": "找有 Springboot 经验的候选人，最好懂微服务"
}
```

验收标准：

- 返回结果必须命中 `Spring Boot`。
- 同时命中 `Java`、`Spring Cloud`、`微服务` 的候选人排序更靠前。
- 返回结果包含 `score`，便于调试。

---

### Step 7：增加公司字典，只解决“国内大厂”

目标：先只解决一个公司标签问题，不一次性覆盖所有公司分类。

创建 `company_dictionary`：

```sql
CREATE TABLE IF NOT EXISTS company_dictionary (
  id BIGSERIAL PRIMARY KEY,
  company_name VARCHAR(200) NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

第一批公司数据：

```sql
INSERT INTO company_dictionary
(company_name, aliases, tags)
VALUES
('阿里巴巴', ARRAY['阿里', 'Alibaba'], ARRAY['国内大厂', '互联网大厂', '电商']),
('腾讯', ARRAY['Tencent'], ARRAY['国内大厂', '互联网大厂', '社交', '游戏']),
('百度', ARRAY['Baidu'], ARRAY['国内大厂', '互联网大厂', 'AI']),
('字节跳动', ARRAY['ByteDance', '抖音'], ARRAY['国内大厂', '互联网大厂', '内容平台']),
('美团', ARRAY['Meituan'], ARRAY['国内大厂', '互联网大厂', '本地生活']),
('京东', ARRAY['JD'], ARRAY['国内大厂', '互联网大厂', '电商']),
('华为', ARRAY['Huawei'], ARRAY['国内大厂', 'ICT', '制造业'])
ON CONFLICT (company_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  tags = EXCLUDED.tags,
  updated_at = NOW();
```

重建索引：

```bash
node seed_dictionaries.js
node build_search_index.js
```

手工验证：

```sql
SELECT
  user_id,
  name,
  matched_companies,
  company_tags
FROM candidate_search_index
WHERE company_tags && ARRAY['国内大厂']::text[]
LIMIT 10;
```

验收标准：

- 有候选人命中 `国内大厂`。
- `matched_companies` 能看到阿里巴巴、腾讯、百度、字节跳动、美团、京东、华为等公司之一。

---

### Step 8：把“国内大厂”接入 n8n Webhook

目标：用户输入“国内大厂”，n8n 能转换为 `company_tags` 查询。

n8n Code 节点增加规则：

```javascript
const question = $json.body?.question || $json.question || '';
const companyTags = [];

if (question.includes('国内大厂') || question.includes('互联网大厂')) {
  companyTags.push('国内大厂', '互联网大厂');
}

return [{
  json: {
    question,
    must_company_tags: [...new Set(companyTags)],
    limit: 10
  }
}];
```

Postgres SQL：

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

Webhook 测试：

```json
{
  "question": "找有国内大厂工作经验的候选人"
}
```

验收标准：

- Webhook 返回国内大厂候选人。
- 返回结果说明命中的公司和标签。
- 不需要用户输入具体公司名。

---

### Step 9：组合技能条件和公司标签条件

目标：支持第一个真正有业务价值的组合查询。

示例用户问题：

```text
找有 Springboot 经验，并且有国内大厂工作经验的候选人
```

n8n 工作流：

```text
Webhook
  ↓
Code: 规则解析 question，得到 must_skills / must_company_tags
  ↓
Postgres: 组合查询并打分
  ↓
Code: 生成命中原因
  ↓
Respond to Webhook
```

组合查询 SQL：

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

Webhook 测试：

```json
{
  "question": "找有 Springboot 经验，并且有国内大厂工作经验的候选人"
}
```

验收标准：

- 候选人必须同时命中 `Spring Boot` 和 `国内大厂`。
- 返回结果中能看到命中的技能、公司和标签。
- 返回数量有限制，默认 10。

---

### Step 10：加入“世界500强”公司标签

目标：在已有公司标签机制上扩展一个新标签，验证扩展成本是否足够低。

更新 `company_dictionary`，增加或更新：

```sql
INSERT INTO company_dictionary
(company_name, aliases, tags)
VALUES
('华为', ARRAY['Huawei'], ARRAY['国内大厂', 'ICT', '制造业', '世界500强']),
('微软中国', ARRAY['Microsoft', '微软'], ARRAY['外企', '世界500强', '软件']),
('Amazon', ARRAY['亚马逊', 'AWS'], ARRAY['外企', '世界500强', '云计算', '互联网大厂']),
('IBM', ARRAY[]::text[], ARRAY['外企', '世界500强', '企业服务']),
('Oracle', ARRAY['甲骨文'], ARRAY['外企', '世界500强', '数据库']),
('SAP', ARRAY[]::text[], ARRAY['外企', '世界500强', '企业软件']),
('Siemens', ARRAY['西门子'], ARRAY['外企', '世界500强', '制造业', '工业软件']),
('Bosch', ARRAY['博世'], ARRAY['外企', '世界500强', '制造业'])
ON CONFLICT (company_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  tags = EXCLUDED.tags,
  updated_at = NOW();
```

重建索引：

```bash
node seed_dictionaries.js
node build_search_index.js
```

n8n Code 节点增加规则：

```javascript
if (
  question.includes('世界500强') ||
  question.includes('世界 500 强') ||
  question.toLowerCase().includes('fortune 500')
) {
  companyTags.push('世界500强');
}
```

Webhook 测试：

```json
{
  "question": "优先考虑有世界500强企业工作经验的候选人"
}
```

验收标准：

- 能返回命中 `世界500强` 的候选人。
- 新标签扩展不需要修改主查询结构。
- 只需维护字典和少量规则。

---

### Step 11：加入最终 LLM 回答生成，但只基于压缩结果

目标：在检索稳定后，再让 LLM 做自然语言总结，而不是让 LLM 直接查库。

n8n 工作流：

```text
Webhook
  ↓
Code: 规则解析和归一化
  ↓
Postgres: 查询 candidate_search_index
  ↓
Code: 压缩候选人列表 + 生成命中原因
  ↓
LLM: 生成 HR 可读回答
  ↓
Respond to Webhook
```

传给 LLM 的单个候选人结构：

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

LLM Prompt：

```text
你是 HR 简历检索助手。请根据候选人检索结果，用中文给出简洁、可读、可操作的回答。

要求：
1. 不要编造候选人信息。
2. 只基于提供的候选人列表回答。
3. 每个候选人说明命中原因。
4. 如果没有结果，说明可能原因，并建议放宽条件。
5. 输出最多 10 个候选人。
6. 不要输出完整简历原文。
```

验收标准：

- LLM 输出内容不包含未提供的信息。
- 每个候选人有命中原因。
- 回答简洁，不输出完整工作经历。
- 如果数据库返回 0 条，LLM 能明确说明没有匹配结果。

---

### Step 12：增加详情查询分支

目标：列表检索和详情查看分离，进一步控制上下文。

触发条件示例：

```text
查看 U000123 的详细简历
```

```text
U000123 的完整经历是什么？
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

n8n 工作流分支：

```text
Webhook
  ↓
Code: 判断是否为详情查询
  ├─ 是：Postgres 查询 candidate_resumes 单人详情 → LLM 总结详情 → 返回
  └─ 否：走候选人检索流程
```

验收标准：

- 只有用户明确请求某个候选人详情时，才查询 `experience_if`。
- 一次只查询一个候选人的详情。
- 不在列表检索阶段返回完整工作经历。

---

### Step 13：最后再引入 LLM Query Parser 替换部分规则

目标：当规则版流程稳定后，再用 LLM 解析更复杂的自然语言。

不要一开始就让 LLM 控制 SQL。LLM 只输出结构化 JSON。

LLM 输出格式：

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

推荐做法：

1. 保留现有规则解析作为兜底。
2. LLM Parser 输出 JSON 后，仍然经过 Code 节点校验和归一化。
3. SQL 仍然使用固定模板和参数化查询。
4. 不允许 LLM 直接生成 SQL。

验收测试：

```json
{
  "question": "帮我找有 Spring Boot 经验，并且最好有国内大厂经历的 Java 后端候选人，优先最近投递"
}
```

期望解析结果：

```json
{
  "must": {
    "skills": ["Spring Boot", "Java"],
    "company_tags": []
  },
  "should": {
    "skills": ["微服务"],
    "company_tags": ["国内大厂", "互联网大厂"]
  },
  "keywords": ["后端"],
  "limit": 10
}
```

验收标准：

- LLM Parser 即使出错，也不会直接影响数据库安全。
- Code 节点会限制字段、清理空值、限制 `limit <= 20`。
- 查询仍通过固定 SQL 模板执行。

---