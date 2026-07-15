# HR 简历检索助手 MVP 实施计划

## 1. 背景与目标

当前简历数据存储在 PostgreSQL 表 `candidate_resumes` 中，数据结构相对扁平，核心字段包括：

- `user_id`
- `name`
- `birthdate`
- `gender`
- `aim_salary`
- `personal`
- `applied_at`
- `experience_if`

其中 `experience_if` 是一个 JSON 数组字符串，每个工作经历对象包含：

- `company`
- `title`
- `startDate`
- `endDate`
- `summary`

当前采用 text-to-SQL 的方式直接把自然语言问题转换为 SQL，但存在明显问题：

1. **上下文溢出**
   - SQL 查询结果可能返回大量简历原文。
   - 将完整结果直接传给 AI，容易超过上下文窗口。
   - 即使没有溢出，也会增加延迟和成本。

2. **语义理解能力弱**
   - 用户问“有 Spring Boot 经验的候选人”，系统无法自动扩展到 Java、Spring Cloud、微服务等相关技能。
   - 用户问“有国内大厂工作经验”，系统无法理解阿里巴巴、腾讯、百度、字节跳动、美团、京东等公司属于该类别。
   - 用户问“世界 500 强企业工作经验优先”，系统无法识别 Microsoft、Amazon、Google、IBM、Oracle、SAP、Siemens、Bosch 等公司标签。

3. **free text 检索不稳定**
   - 工作经历介绍是自然语言文本。
   - 直接依赖 SQL `LIKE` 或 LLM 生成 SQL，召回率和准确率都不稳定。

MVP 目标：

- 不追求生产级复杂架构。
- 在现有 PostgreSQL 和 n8n 基础上，搭建一个可验证的 HR 简历检索助手。
- 将自然语言查询拆解为结构化检索条件。
- 通过预处理索引表提升召回率。
- 控制返回给 AI 的上下文大小。
- 支持“技能同义词/相关词扩展”和“公司标签检索”。

---

## 2. 总体方案

MVP 不再让 AI 直接对原始简历表做 text-to-SQL，而是采用：

```text
用户自然语言问题
        ↓
LLM 解析查询意图
        ↓
结构化检索条件 JSON
        ↓
PostgreSQL 查询候选人索引表
        ↓
只返回 Top N 摘要结果
        ↓
LLM 生成 HR 可读回答
```

核心改造点：

1. **保留原始表 `candidate_resumes`**
   - 作为简历原始数据源。

2. **新增字典表**
   - `skill_dictionary`
   - `company_dictionary`

3. **新增检索索引表**
   - `candidate_search_index`

4. **通过离线脚本构建索引**
   - 已存在 `build_search_index.js`，可作为 MVP 基础。
   - 从原始简历中解析技能、公司、公司标签、最新职位、全文内容等。

5. **n8n 工作流只查询索引表**
   - 不直接把大量原始简历扔给 AI。
   - 先做数据库过滤和排序。
   - 只把少量候选人的摘要给 AI。

---

## 3. MVP 数据模型设计

### 3.1 原始简历表

已有表：`candidate_resumes`

```sql
CREATE TABLE IF NOT EXISTS candidate_resumes (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  birthdate DATE NOT NULL,
  gender VARCHAR(10) NOT NULL,
  aim_salary VARCHAR(32) NOT NULL,
  personal TEXT,
  applied_at TIMESTAMP NOT NULL,
  experience_if TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

该表不建议在 MVP 阶段大改，避免影响种子数据和已有脚本。

---

### 3.2 技能字典表

建议新增：`skill_dictionary`

用途：

- 维护标准技能名。
- 维护别名。
- 维护相关技能。
- 支持“Spring Boot”扩展到“Java、Spring Cloud、微服务”等相关能力。

建议字段：

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

示例数据：

```sql
INSERT INTO skill_dictionary 
(skill_name, aliases, related_terms, category, weight)
VALUES
('Java', ARRAY['J2EE', 'Java后端'], ARRAY['Spring Boot', 'Spring Cloud', 'MyBatis', '微服务'], '后端开发', 5),
('Spring Boot', ARRAY['SpringBoot', 'springboot'], ARRAY['Java', 'Spring Cloud', '微服务'], '后端开发', 5),
('Spring Cloud', ARRAY['SpringCloud'], ARRAY['Java', 'Spring Boot', '微服务', '分布式系统'], '后端开发', 4),
('微服务', ARRAY['Microservices', 'microservice'], ARRAY['Java', 'Spring Boot', 'Spring Cloud', 'Docker', 'Kubernetes'], '架构', 4),
('Node.js', ARRAY['NodeJS', 'nodejs'], ARRAY['Express', 'NestJS', 'TypeScript'], '后端开发', 4),
('Python', ARRAY['py'], ARRAY['Django', 'Flask', 'FastAPI', '机器学习'], '后端/AI', 4),
('机器学习', ARRAY['ML'], ARRAY['Python', 'TensorFlow', 'PyTorch', '深度学习'], 'AI', 5),
('DevOps', ARRAY['运维开发'], ARRAY['Docker', 'Kubernetes', 'Jenkins', 'GitLab CI'], '平台工程', 4);
```

---

### 3.3 公司字典表

建议新增：`company_dictionary`

用途：

- 维护标准公司名。
- 维护公司别名。
- 维护公司标签。
- 支持“国内大厂”“世界 500 强”“外企”“互联网公司”“制造业”等自然语言条件。

建议字段：

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

示例数据：

```sql
INSERT INTO company_dictionary
(company_name, aliases, tags)
VALUES
('阿里巴巴', ARRAY['阿里', 'Alibaba'], ARRAY['国内大厂', '互联网大厂', '电商']),
('腾讯', ARRAY['Tencent'], ARRAY['国内大厂', '互联网大厂', '社交', '游戏']),
('百度', ARRAY['Baidu'], ARRAY['国内大厂', '互联网大厂', 'AI']),
('字节跳动', ARRAY['ByteDance', '抖音'], ARRAY['国内大厂', '互联网大厂', '内容平台']),
('美团', ARRAY['Meituan'], ARRAY['国内大厂', '互联网大厂', '本地生活']),
('京东', ARRAY['JD'], ARRAY['国内大厂', '互联网大厂', '电商', '物流']),
('华为', ARRAY['Huawei'], ARRAY['国内大厂', 'ICT', '制造业', '世界500强']),
('微软中国', ARRAY['Microsoft', '微软'], ARRAY['外企', '世界500强', '软件']),
('Amazon', ARRAY['亚马逊', 'AWS'], ARRAY['外企', '世界500强', '云计算', '互联网大厂']),
('Google', ARRAY['谷歌'], ARRAY['外企', '互联网大厂', 'AI']),
('IBM', ARRAY[], ARRAY['外企', '世界500强', '企业服务']),
('Oracle', ARRAY['甲骨文'], ARRAY['外企', '世界500强', '数据库']),
('SAP', ARRAY[], ARRAY['外企', '世界500强', '企业软件']),
('Siemens', ARRAY['西门子'], ARRAY['外企', '世界500强', '制造业', '工业软件']),
('Bosch', ARRAY['博世'], ARRAY['外企', '世界500强', '制造业']);
```

注意：公司标签需要根据实际业务标准维护。MVP 阶段可以先人工维护一小批常见公司和标签，后续再扩展。

---

### 3.4 候选人检索索引表

项目中已经存在 `build_search_index.js`，其中定义了 `candidate_search_index` 表，建议继续使用该方向。

当前索引表设计：

```sql
CREATE TABLE IF NOT EXISTS candidate_search_index (
  user_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  birthdate DATE NOT NULL,
  gender VARCHAR(10) NOT NULL,
  aim_salary VARCHAR(32),
  applied_at TIMESTAMP,
  full_text TEXT,
  matched_skills TEXT[] NOT NULL DEFAULT '{}',
  matched_companies TEXT[] NOT NULL DEFAULT '{}',
  company_tags TEXT[] NOT NULL DEFAULT '{}',
  latest_company VARCHAR(200),
  latest_title VARCHAR(200),
  experience_count INT DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

建议 MVP 阶段补充以下字段，但不是必须：

```sql
ALTER TABLE candidate_search_index
ADD COLUMN IF NOT EXISTS birth_year INT,
ADD COLUMN IF NOT EXISTS age INT,
ADD COLUMN IF NOT EXISTS total_experience_years NUMERIC(5, 1),
ADD COLUMN IF NOT EXISTS resume_summary TEXT;
```

字段说明：

- `birth_year`
  - 用于年龄范围检索。
- `age`
  - 可以按当前日期预计算，也可以查询时计算。
- `total_experience_years`
  - 粗略统计工作年限。
- `resume_summary`
  - 预生成简历短摘要，避免每次把完整 `full_text` 交给 AI。

MVP 阶段如需保持简单，可以先不加这些字段，只使用已有字段完成第一版验证。

---

## 4. 检索策略设计

### 4.1 不推荐继续使用纯 text-to-SQL

原因：

- LLM 生成 SQL 不稳定。
- 查询逻辑难以控制。
- 容易把大量原始数据返回给模型。
- 对同义词、行业知识、公司分类理解不足。
- 无法稳定处理优先级、排序、召回扩展。

MVP 建议改为：

```text
LLM 只负责“理解用户意图并输出 JSON”
SQL 由系统固定模板生成
```

---

### 4.2 LLM 输出结构化查询 JSON

用户输入示例：

```text
帮我找有 Spring Boot 经验，并且最好有国内大厂经历的 Java 后端候选人，年龄 30 岁以内，优先考虑最近投递的。
```

LLM 应输出：

```json
{
  "must": {
    "skills": ["Spring Boot"],
    "company_tags": [],
    "gender": null,
    "age_min": null,
    "age_max": 30
  },
  "should": {
    "skills": ["Java", "微服务"],
    "company_tags": ["国内大厂", "互联网大厂"]
  },
  "keywords": ["Java后端", "Spring Boot"],
  "sort": [
    {
      "field": "applied_at",
      "direction": "desc"
    }
  ],
  "limit": 10
}
```

规则：

- `must` 表示必须满足。
- `should` 表示加分项。
- `keywords` 用于全文兜底检索。
- `sort` 控制排序。
- `limit` 限制返回数量，默认建议 10，最大不超过 20。

---

### 4.3 技能扩展策略

不要完全依赖 LLM 自己想同义词，建议使用字典表扩展。

示例：

用户问：

```text
Springboot 经验
```

标准化后：

```json
{
  "canonical_skill": "Spring Boot",
  "aliases": ["SpringBoot", "springboot"],
  "related_terms": ["Java", "Spring Cloud", "微服务"]
}
```

检索逻辑：

- `must` 查询标准技能：`Spring Boot`
- `should` 查询相关技能：`Java`, `Spring Cloud`, `微服务`

SQL 逻辑：

```sql
matched_skills && ARRAY['Spring Boot']
```

加分逻辑：

```sql
cardinality(matched_skills & ARRAY['Java', 'Spring Cloud', '微服务'])
```

PostgreSQL 数组没有直接的 `&` 交集操作符，MVP 可以通过 `unnest` 实现打分。

---

### 4.4 公司标签扩展策略

用户问：

```text
国内大厂工作经验
```

不要让 SQL 去猜公司名，而是使用 `company_dictionary.tags`。

标准化为：

```json
{
  "company_tags": ["国内大厂", "互联网大厂"]
}
```

查询：

```sql
company_tags && ARRAY['国内大厂', '互联网大厂']
```

用户问：

```text
世界 500 强企业工作经验
```

标准化为：

```json
{
  "company_tags": ["世界500强"]
}
```

查询：

```sql
company_tags && ARRAY['世界500强']
```

---

### 4.5 控制上下文大小

查询阶段只返回：

- `user_id`
- `name`
- `gender`
- `birthdate`
- `age`
- `aim_salary`
- `latest_company`
- `latest_title`
- `matched_skills`
- `matched_companies`
- `company_tags`
- 命中原因
- 简短摘要

不要直接返回完整 `experience_if` 和完整 `full_text`。

建议分两步：

1. **第一步：检索候选人列表**
   - 返回 Top 10。
   - 每人只返回 300 字以内摘要。

2. **第二步：查看某个候选人详情**
   - 用户指定候选人 `user_id` 或姓名后，再查原始简历详情。
   - 此时才返回完整工作经历。

这样可以避免一次性把 500 条甚至更多简历传给 AI。

---

## 5. PostgreSQL MVP 查询示例

### 5.1 按技能和公司标签查询

示例条件：

- 必须有 `Spring Boot`
- 优先有 `Java` 或 `微服务`
- 优先有 `国内大厂`
- 最多返回 10 个

```sql
WITH query_params AS (
  SELECT
    ARRAY['Spring Boot']::text[] AS must_skills,
    ARRAY['Java', '微服务']::text[] AS should_skills,
    ARRAY['国内大厂', '互联网大厂']::text[] AS should_company_tags
),
scored AS (
  SELECT
    c.user_id,
    c.name,
    c.birthdate,
    c.gender,
    c.aim_salary,
    c.applied_at,
    c.latest_company,
    c.latest_title,
    c.matched_skills,
    c.matched_companies,
    c.company_tags,
    c.experience_count,
    (
      CASE WHEN c.matched_skills && q.must_skills THEN 100 ELSE 0 END
      +
      (
        SELECT COUNT(*) * 10
        FROM unnest(c.matched_skills) s
        WHERE s = ANY(q.should_skills)
      )
      +
      (
        SELECT COUNT(*) * 20
        FROM unnest(c.company_tags) t
        WHERE t = ANY(q.should_company_tags)
      )
    ) AS score
  FROM candidate_search_index c
  CROSS JOIN query_params q
  WHERE c.matched_skills && q.must_skills
)
SELECT *
FROM scored
ORDER BY score DESC, applied_at DESC
LIMIT 10;
```

---

### 5.2 按公司标签查询

示例条件：

- 有世界 500 强经历
- 优先最近投递

```sql
SELECT
  user_id,
  name,
  birthdate,
  gender,
  aim_salary,
  applied_at,
  latest_company,
  latest_title,
  matched_companies,
  company_tags
FROM candidate_search_index
WHERE company_tags && ARRAY['世界500强']::text[]
ORDER BY applied_at DESC
LIMIT 10;
```

---

### 5.3 全文兜底查询

对于不易结构化的表达，例如：

```text
做过高并发订单系统的人
```

MVP 可以先使用 `full_text` 兜底：

```sql
SELECT
  user_id,
  name,
  birthdate,
  gender,
  aim_salary,
  applied_at,
  latest_company,
  latest_title,
  matched_skills,
  matched_companies,
  company_tags,
  ts_rank(to_tsvector('simple', full_text), plainto_tsquery('simple', '高并发 订单 系统')) AS text_rank
FROM candidate_search_index
WHERE to_tsvector('simple', full_text) @@ plainto_tsquery('simple', '高并发 订单 系统')
ORDER BY text_rank DESC, applied_at DESC
LIMIT 10;
```

注意：PostgreSQL 内置全文检索对中文分词能力有限。MVP 可以先使用 `LIKE` 或 `simple` 配置验证流程，后续再考虑中文分词、向量检索或专用搜索引擎。

---

## 6. n8n 工作流设计

### 6.1 工作流节点建议

MVP 工作流可以设计为：

```text
Chat Trigger / Webhook
        ↓
LLM: Query Parser
        ↓
Code: Normalize Query JSON
        ↓
Postgres: Load Dictionary Expansion
        ↓
Code: Build SQL Params
        ↓
Postgres: Search candidate_search_index
        ↓
Code: Build Compact Candidate Context
        ↓
LLM: Generate HR Answer
        ↓
Return Response
```

---

### 6.2 节点 1：接收用户问题

输入：

```json
{
  "question": "帮我找有Springboot经验，并且有国内大厂经历的候选人"
}
```

---

### 6.3 节点 2：LLM 解析查询意图

Prompt 建议：

```text
你是一个 HR 简历检索查询解析器。你的任务不是回答问题，而是把用户自然语言转换为结构化 JSON。

只输出 JSON，不要输出 Markdown，不要解释。

字段结构如下：
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
  "sort": [
    {
      "field": "score",
      "direction": "desc"
    }
  ],
  "limit": 10
}

规则：
1. “必须”、“要求”、“需要”、“至少”对应 must。
2. “优先”、“最好”、“加分”、“更倾向”对应 should。
3. “国内大厂”映射为 company_tags: ["国内大厂", "互联网大厂"]。
4. “世界500强”、“世界 500 强”、“ Fortune 500”映射为 company_tags: ["世界500强"]。
5. “外企”映射为 company_tags: ["外企"]。
6. “Java后端”可以映射为 skills: ["Java"]，keywords 增加 ["后端"]。
7. “Springboot”、“spring boot”、“Spring Boot”统一为 "Spring Boot"。
8. 如果用户没有指定 limit，默认 10。
9. limit 最大 20。
10. 不确定的词放入 keywords。
```

---

### 6.4 节点 3：标准化 Query JSON

Code 节点职责：

- 确保 JSON 合法。
- 补充默认字段。
- 限制 `limit <= 20`。
- 清理空值。
- 将 `Springboot` 归一化为 `Spring Boot`。
- 将 `世界 500 强` 归一化为 `世界500强`。

示例伪代码：

```javascript
const query = $json;

query.must = query.must || {};
query.should = query.should || {};

query.must.skills = query.must.skills || [];
query.must.company_names = query.must.company_names || [];
query.must.company_tags = query.must.company_tags || [];

query.should.skills = query.should.skills || [];
query.should.company_names = query.should.company_names || [];
query.should.company_tags = query.should.company_tags || [];

query.keywords = query.keywords || [];
query.limit = Math.min(Number(query.limit || 10), 20);

function normalizeSkill(skill) {
  const map = {
    'Springboot': 'Spring Boot',
    'springboot': 'Spring Boot',
    'spring boot': 'Spring Boot',
    'SpringBoot': 'Spring Boot'
  };
  return map[skill] || skill;
}

query.must.skills = query.must.skills.map(normalizeSkill);
query.should.skills = query.should.skills.map(normalizeSkill);

return [{ json: query }];
```

---

### 6.5 节点 4：通过字典扩展技能和公司

可以在 n8n 中做两种实现：

#### 方案 A：简单实现

在 Code 节点中维护一小份硬编码字典。

优点：

- 快速。
- 不依赖额外 SQL。
- 适合第一天验证。

缺点：

- 后续维护困难。

#### 方案 B：推荐 MVP 实现

通过 PostgreSQL 查询 `skill_dictionary` 和 `company_dictionary`。

根据 `must.skills` 和 `should.skills` 查询：

```sql
SELECT skill_name, aliases, related_terms
FROM skill_dictionary
WHERE skill_name = ANY($1::text[])
   OR aliases && $1::text[];
```

根据公司名或标签查询：

```sql
SELECT company_name, aliases, tags
FROM company_dictionary
WHERE company_name = ANY($1::text[])
   OR aliases && $1::text[]
   OR tags && $2::text[];
```

然后在 Code 节点中合并出：

```json
{
  "must_skills": ["Spring Boot"],
  "should_skills": ["Java", "Spring Cloud", "微服务"],
  "must_company_tags": [],
  "should_company_tags": ["国内大厂", "互联网大厂"],
  "keywords": ["后端"],
  "limit": 10
}
```

---

### 6.6 节点 5：执行检索 SQL

建议使用参数化 SQL，避免直接拼接用户输入。

MVP 可根据条件组合固定 SQL。

简化版 SQL：

```sql
WITH query_params AS (
  SELECT
    $1::text[] AS must_skills,
    $2::text[] AS should_skills,
    $3::text[] AS must_company_tags,
    $4::text[] AS should_company_tags,
    $5::text[] AS keywords
),
scored AS (
  SELECT
    c.user_id,
    c.name,
    c.birthdate,
    c.gender,
    c.aim_salary,
    c.applied_at,
    c.latest_company,
    c.latest_title,
    c.matched_skills,
    c.matched_companies,
    c.company_tags,
    c.experience_count,
    LEFT(c.full_text, 500) AS short_text,
    (
      CASE
        WHEN cardinality(q.must_skills) = 0 THEN 0
        WHEN c.matched_skills && q.must_skills THEN 100
        ELSE -1000
      END
      +
      CASE
        WHEN cardinality(q.must_company_tags) = 0 THEN 0
        WHEN c.company_tags && q.must_company_tags THEN 100
        ELSE -1000
      END
      +
      (
        SELECT COUNT(*) * 10
        FROM unnest(c.matched_skills) s
        WHERE s = ANY(q.should_skills)
      )
      +
      (
        SELECT COUNT(*) * 20
        FROM unnest(c.company_tags) t
        WHERE t = ANY(q.should_company_tags)
      )
      +
      (
        SELECT COUNT(*) * 3
        FROM unnest(q.keywords) k
        WHERE c.full_text ILIKE '%' || k || '%'
      )
    ) AS score
  FROM candidate_search_index c
  CROSS JOIN query_params q
  WHERE
    (
      cardinality(q.must_skills) = 0
      OR c.matched_skills && q.must_skills
    )
    AND
    (
      cardinality(q.must_company_tags) = 0
      OR c.company_tags && q.must_company_tags
    )
)
SELECT *
FROM scored
WHERE score >= 0
ORDER BY score DESC, applied_at DESC
LIMIT $6;
```

参数：

1. `must_skills`
2. `should_skills`
3. `must_company_tags`
4. `should_company_tags`
5. `keywords`
6. `limit`

---

### 6.7 节点 6：构造紧凑上下文

不要把完整简历传给 LLM。

每个候选人建议压缩为：

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
  "score": 150,
  "reason": "命中 Spring Boot；具备 Java 和微服务经验；有国内互联网大厂经历"
}
```

最多返回 10 条。

---

### 6.8 节点 7：LLM 生成 HR 回答

Prompt 建议：

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

输出示例：

```text
找到 6 位较匹配的候选人，按匹配度和最近投递时间排序：

1. 张伟，男，期望薪资 30000元/月
   - 最近经历：阿里巴巴，高级Java开发工程师
   - 命中原因：匹配 Spring Boot；同时具备 Java、微服务经验；有国内互联网大厂经历
   - 候选人ID：U000123

2. 李娜，女，期望薪资 28000元/月
   - 最近经历：京东，后端开发工程师
   - 命中原因：匹配 Spring Boot；有国内大厂和电商业务经验
   - 候选人ID：U000245
```

---

## 7. 分步实施计划：从简单到复杂，边做边测

本项目建议采用渐进式 MVP 方法，不要等所有能力都开发完成后再接入 n8n。每完成一个最小能力，就立刻通过手工 SQL 和 n8n Webhook 做端到端验证。具体内容参见 [MVP_Plan](MVP_plan.md)


## 8. MVP 验收用例

### 用例 1：技能同义词

用户：

```text
找有 Springboot 经验的候选人
```

期望：

- 能识别 `Springboot` 为 `Spring Boot`。
- 能返回 `matched_skills` 包含 `Spring Boot` 的候选人。
- 排名中可优先展示同时具备 `Java`、`微服务` 的候选人。

---

### 用例 2：相关技能扩展

用户：

```text
找 Java 后端候选人，最好有微服务经验
```

期望：

- `must.skills` 包含 `Java`。
- `should.skills` 包含 `微服务`、`Spring Boot`、`Spring Cloud`。
- 返回 Java 相关候选人，并按微服务相关经验加分。

---

### 用例 3：国内大厂

用户：

```text
找有国内大厂工作经验的后端工程师
```

期望：

- `company_tags` 包含 `国内大厂` 或 `互联网大厂`。
- 能召回阿里巴巴、腾讯、百度、字节跳动、美团、京东、华为等经历的候选人。
- 不要求用户明确写出公司名。

---

### 用例 4：世界 500 强

用户：

```text
优先考虑有世界500强企业工作经验的候选人
```

期望：

- `should.company_tags` 包含 `世界500强`。
- 能优先展示 Microsoft、Amazon、IBM、Oracle、SAP、Siemens、Bosch、华为等经历候选人。
- 如果没有其他 must 条件，则可以作为主要排序因素。

---

### 用例 5：控制上下文

用户：

```text
帮我找 20 个有 Java 和 Spring Boot 经验的人
```

期望：

- 数据库最多返回 20 条。
- 传给最终 LLM 的字段是压缩后的摘要字段。
- 不传完整 `experience_if`。
- 不传完整 `full_text`。

---

### 用例 6：详情查询

用户：

```text
查看 U000123 的详细经历
```

期望：

- 只查询该候选人的原始简历。
- 返回完整工作经历总结。
- 不把所有候选人详情传给 LLM。

---

## 9. 后续优化方向：向量检索、混合检索和画像增强

前面的 MVP 主要解决结构化条件检索，例如：

- 技能：`Spring Boot`、`Java`、`微服务`
- 公司标签：`国内大厂`、`世界500强`
- 基础字段：性别、年龄、投递时间、期望薪资

但 HR 的真实问题经常包含更模糊的语义，例如：

```text
找做过高并发订单系统的人
```

```text
找有复杂分布式系统治理经验的人
```

```text
找做过工业互联网平台或者 MES 系统的人
```

```text
找项目经历和我们这个岗位最接近的人
```

这些问题只靠 `matched_skills`、`company_tags` 和 SQL `LIKE` 很难稳定解决。因此后续优化建议引入向量检索，并逐步升级为“结构化过滤 + 向量召回 + 规则/LLM 重排序”的混合检索方案。

---

### 9.1 向量检索要解决什么问题

向量检索主要解决 free text 的语义召回问题。

当前简历中最有价值的非结构化信息是：

- `personal`
- `experience_if[].summary`
- `experience_if[].title`
- `experience_if[].company`
- `experience_if[].startDate`
- `experience_if[].endDate`

例如候选人经历中写的是：

```text
参与订单履约系统重构，针对慢查询、接口超时、消息堆积和服务稳定性问题进行持续改进。
```

用户可能问：

```text
找有高并发订单系统稳定性治理经验的人
```

这两个文本不一定有完全相同的关键词，但语义非常接近。向量检索可以提高这类查询的召回率。

---

### 9.2 向量检索不要替代现有索引，而是补充现有索引

不建议把前面做的 `candidate_search_index` 推倒重来。

推荐最终架构：

```text
用户问题
  ↓
Query Parser / 规则解析
  ↓
结构化条件
  - must_skills
  - should_skills
  - company_tags
  - age range
  - gender
  - salary
  ↓
语义查询文本
  - 用户原始问题
  - 经过改写后的检索 query
  ↓
混合检索
  - SQL 结构化过滤
  - pgvector 语义召回
  - skill/company 标签加分
  ↓
Top N 候选人摘要
  ↓
LLM 生成 HR 可读回答
```

也就是说：

- 精确条件继续走 SQL。
- 语义相似度走向量。
- 公司、技能、年龄等硬条件仍然由数据库控制。
- LLM 不直接生成 SQL，也不直接决定最终候选人全集。

---

### 9.3 向量检索分步实施计划

向量检索也建议按“从简单到复杂，边做边测”的方式推进。

---

#### Vector Step 1：先创建 chunk 表，不生成 embedding

目标：先把简历拆成可检索片段，验证 chunk 质量。

建议新增表：

```sql
CREATE TABLE IF NOT EXISTS candidate_resume_chunks (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  chunk_type VARCHAR(50) NOT NULL,
  chunk_index INT NOT NULL,
  company VARCHAR(200),
  title VARCHAR(200),
  start_date VARCHAR(20),
  end_date VARCHAR(20),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidate_resume_chunks_user_id
ON candidate_resume_chunks(user_id);

CREATE INDEX IF NOT EXISTS idx_candidate_resume_chunks_chunk_type
ON candidate_resume_chunks(chunk_type);
```

chunk 设计建议：

1. `personal` 作为一个 chunk。
2. 每一段工作经历作为一个 chunk。
3. chunk 内容中要包含公司、职位和工作介绍，方便向量表达更完整。

工作经历 chunk 示例：

```text
公司：阿里巴巴
职位：高级Java开发工程师
时间：2020-03-01 至今
经历：负责订单履约系统的需求分析、系统设计和功能开发，使用 Java、Spring Boot、Redis、Kafka 等技术完成服务拆分、接口联调、上线发布和问题排查。
```

建议新增脚本：

```text
build_resume_chunks.js
```

第一版脚本只做：

1. 读取 `candidate_resumes`。
2. 解析 `experience_if`。
3. 清空并重建 `candidate_resume_chunks`。
4. 每个候选人生成多个 chunk。
5. 不生成 embedding。

手工验收 SQL：

```sql
SELECT
  user_id,
  chunk_type,
  company,
  title,
  LEFT(content, 300) AS preview
FROM candidate_resume_chunks
ORDER BY user_id, chunk_index
LIMIT 20;
```

验收标准：

- 每个候选人至少有 1 个 chunk。
- 工作经历被拆成独立 chunk。
- `content` 可读，包含公司、职位、时间、经历介绍。

---

#### Vector Step 2：n8n Webhook 查询 chunk 表，不使用向量

目标：先把 chunk 表接入 n8n，验证新的数据链路。

n8n 工作流：

```text
Webhook
  ↓
Postgres: 查询 candidate_resume_chunks
  ↓
Respond to Webhook
```

测试 SQL：

```sql
SELECT
  user_id,
  chunk_type,
  company,
  title,
  LEFT(content, 300) AS preview
FROM candidate_resume_chunks
WHERE content ILIKE '%' || $1 || '%'
LIMIT 10;
```

Webhook 测试：

```json
{
  "keyword": "订单"
}
```

验收标准：

- n8n 能返回命中关键词的 chunk。
- 返回的是片段，不是完整简历。
- 仍然不调用 LLM。

---

#### Vector Step 3：启用 pgvector 扩展

目标：让 PostgreSQL 支持向量字段和相似度检索。

需要数据库支持 `pgvector` 扩展。

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

然后给 chunk 表增加 embedding 字段。

注意：维度取决于实际使用的 embedding 模型。例如：

- 如果模型输出 1536 维，则使用 `vector(1536)`。
- 如果模型输出 1024 维，则使用 `vector(1024)`。
- 如果模型输出 768 维，则使用 `vector(768)`。

示例：

```sql
ALTER TABLE candidate_resume_chunks
ADD COLUMN IF NOT EXISTS embedding vector(1536);
```

创建索引：

```sql
CREATE INDEX IF NOT EXISTS idx_candidate_resume_chunks_embedding
ON candidate_resume_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

说明：

- MVP 数据只有 500 份简历时，即使没有向量索引也能跑。
- 如果数据量较小，可以先不建 `ivfflat` 索引，直接验证功能。
- 数据量上来后再根据实际规模调优索引参数。

验收 SQL：

```sql
SELECT COUNT(*)
FROM candidate_resume_chunks
WHERE embedding IS NULL;
```

此时预期大部分或全部 embedding 仍然为空，因为下一步才生成向量。

---

#### Vector Step 4：生成 chunk embedding

目标：为每个 chunk 的 `content` 生成 embedding。

建议新增脚本：

```text
generate_chunk_embeddings.js
```

脚本职责：

1. 查询 `candidate_resume_chunks` 中 `embedding IS NULL` 的记录。
2. 调用 embedding 模型生成向量。
3. 将向量写回 `embedding` 字段。
4. 支持批处理，避免一次处理过多数据。
5. 支持失败重试或至少输出失败 ID。

伪流程：

```text
读取未向量化 chunks
  ↓
按批次调用 embedding API
  ↓
校验向量维度
  ↓
UPDATE candidate_resume_chunks SET embedding = $vector WHERE id = $id
  ↓
输出处理进度
```

建议批大小：

```text
20 - 100 chunks / batch
```

具体取决于 embedding 服务限制和 n8n / Node.js 运行环境。

验收 SQL：

```sql
SELECT
  COUNT(*) AS total_chunks,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_chunks,
  COUNT(*) FILTER (WHERE embedding IS NULL) AS missing_embeddings
FROM candidate_resume_chunks;
```

验收标准：

- `embedded_chunks` 等于 `total_chunks`。
- 失败数据可追踪。
- 重复执行脚本不会重复生成已有 embedding。

---

#### Vector Step 5：手工 SQL 验证向量相似度检索

目标：先不用 n8n，直接确认向量检索有效。

查询思路：

1. 用户问题也要先生成 query embedding。
2. 用 query embedding 和 chunk embedding 做相似度排序。
3. 返回最相似的 chunks。

向量查询 SQL 模板：

```sql
SELECT
  c.id,
  c.user_id,
  c.chunk_type,
  c.company,
  c.title,
  LEFT(c.content, 300) AS preview,
  1 - (c.embedding <=> $1::vector) AS similarity
FROM candidate_resume_chunks c
WHERE c.embedding IS NOT NULL
ORDER BY c.embedding <=> $1::vector
LIMIT 10;
```

测试 query：

```text
高并发订单系统稳定性治理
```

预期：

- 订单系统、履约系统、接口超时、消息堆积、稳定性优化等经历排得更靠前。
- 即使文本没有完全包含“高并发”这个词，也可能被召回。

验收标准：

- Top 10 chunk 内容和 query 语义相关。
- 能看到 `similarity` 分数。
- 能根据 `user_id` 关联回候选人。

---

#### Vector Step 6：n8n Webhook 接入向量检索

目标：通过 n8n 输入自然语言，返回语义相似的候选人片段。

n8n 工作流：

```text
Webhook
  ↓
Code: 读取 question
  ↓
Embedding Node / HTTP Request: 生成 query embedding
  ↓
Postgres: 查询 candidate_resume_chunks 相似 chunk
  ↓
Code: 按 user_id 聚合 chunk
  ↓
Respond to Webhook
```

Webhook 测试：

```json
{
  "question": "找有高并发订单系统稳定性治理经验的人"
}
```

返回结构建议：

```json
{
  "query": "找有高并发订单系统稳定性治理经验的人",
  "results": [
    {
      "user_id": "U000123",
      "best_similarity": 0.82,
      "matched_chunks": [
        {
          "company": "京东",
          "title": "高级Java开发工程师",
          "preview": "公司：京东\n职位：高级Java开发工程师\n经历：参与订单履约系统重构，针对慢查询、接口超时、消息堆积和服务稳定性问题进行持续改进。",
          "similarity": 0.82
        }
      ]
    }
  ]
}
```

验收标准：

- n8n 能根据自然语言 query 返回语义相关 chunk。
- 返回结果按候选人聚合。
- 每个候选人最多保留 2 到 3 个 matched chunks，控制上下文。

---

#### Vector Step 7：合并向量结果和结构化索引结果

目标：形成真正可用的混合检索。

推荐策略：

1. `candidate_search_index` 负责候选人级别结构化信息。
2. `candidate_resume_chunks` 负责经历片段级别语义召回。
3. 查询时先做向量召回，再关联候选人索引表。

混合查询 SQL 示例：

```sql
WITH vector_hits AS (
  SELECT
    c.user_id,
    MAX(1 - (c.embedding <=> $1::vector)) AS best_similarity,
    COUNT(*) AS matched_chunk_count
  FROM candidate_resume_chunks c
  WHERE c.embedding IS NOT NULL
  GROUP BY c.user_id
  ORDER BY MIN(c.embedding <=> $1::vector)
  LIMIT 50
),
scored AS (
  SELECT
    i.user_id,
    i.name,
    i.gender,
    i.birthdate,
    i.aim_salary,
    i.applied_at,
    i.latest_company,
    i.latest_title,
    i.matched_skills,
    i.matched_companies,
    i.company_tags,
    v.best_similarity,
    v.matched_chunk_count,
    (
      v.best_similarity * 100
      + CASE WHEN i.matched_skills && $2::text[] THEN 30 ELSE 0 END
      + CASE WHEN i.company_tags && $3::text[] THEN 30 ELSE 0 END
    ) AS final_score
  FROM vector_hits v
  JOIN candidate_search_index i ON i.user_id = v.user_id
  WHERE
    (
      cardinality($2::text[]) = 0
      OR i.matched_skills && $2::text[]
    )
    AND
    (
      cardinality($3::text[]) = 0
      OR i.company_tags && $3::text[]
    )
)
SELECT *
FROM scored
ORDER BY final_score DESC, applied_at DESC
LIMIT $4;
```

参数示例：

1. `query_embedding`
2. `must_skills`
3. `must_company_tags`
4. `limit`

示例问题：

```text
找有 Spring Boot 经验，并且做过高并发订单系统的人，最好有国内大厂经历
```

解析后：

```json
{
  "must_skills": ["Spring Boot"],
  "must_company_tags": [],
  "should_company_tags": ["国内大厂", "互联网大厂"],
  "semantic_query": "高并发订单系统 稳定性治理 订单履约 分布式系统",
  "limit": 10
}
```

验收标准：

- 必须条件仍然生效，例如必须命中 `Spring Boot`。
- 语义相似度高的候选人排序更靠前。
- 有国内大厂经历的候选人获得加分。
- 返回结果包含结构化命中原因和语义命中片段。

---

#### Vector Step 8：把 matched chunks 交给 LLM 生成解释

目标：让最终回答不仅说“命中了”，还说明为什么这个候选人语义相关。

传给 LLM 的上下文仍然要严格控制。

每个候选人建议结构：

```json
{
  "user_id": "U000123",
  "name": "张伟",
  "latest_company": "京东",
  "latest_title": "高级Java开发工程师",
  "matched_skills": ["Java", "Spring Boot", "微服务"],
  "company_tags": ["国内大厂", "互联网大厂", "电商"],
  "best_similarity": 0.82,
  "matched_chunks": [
    {
      "company": "京东",
      "title": "高级Java开发工程师",
      "preview": "参与订单履约系统重构，针对慢查询、接口超时、消息堆积和服务稳定性问题进行持续改进。"
    }
  ],
  "reason": "技能命中 Spring Boot；语义片段显示其参与过订单履约系统稳定性优化；公司标签命中国内大厂。"
}
```

LLM 回答要求：

```text
请只根据给定候选人信息回答，不要编造。
每个候选人必须说明：
1. 命中的结构化条件。
2. 命中的语义经历片段。
3. 为什么推荐。
如果 matched_chunks 不足以支持结论，要明确说“仅弱相关”。
```

验收标准：

- LLM 能解释语义命中依据。
- 不把完整简历传给 LLM。
- 每个候选人最多传 2 到 3 个 chunk。

---

### 9.4 混合检索的推荐打分方式

建议最终采用可解释的加权打分，不要只按向量相似度排序。

示例：

```text
final_score =
  vector_similarity * 100
  + must_skill_score
  + should_skill_score
  + company_tag_score
  + recency_score
```

建议初始权重：

| 因素 | 分值建议 | 说明 |
|---|---:|---|
| 向量相似度 | `similarity * 100` | free text 语义相关度 |
| must 技能命中 | `+50` | 例如必须有 Spring Boot |
| should 技能命中 | 每个 `+10` | 例如 Java、微服务、Spring Cloud |
| must 公司标签命中 | `+50` | 例如必须有国内大厂 |
| should 公司标签命中 | 每个 `+15` | 例如世界500强、外企 |
| 最近投递 | `+0~10` | 按 `applied_at` 衰减加分 |

注意：

- must 条件更适合放在 `WHERE` 中过滤，而不是只加分。
- should 条件适合加分。
- 向量相似度适合召回和排序，但不适合替代硬条件。

---

### 9.5 向量检索的 n8n 最终工作流

推荐最终 n8n 工作流：

```text
Webhook / Chat Trigger
  ↓
Code: 判断是否为详情查询
  ├─ 是：查询 candidate_resumes 单人详情
  │      ↓
  │    LLM 总结单人详情
  │      ↓
  │    Respond
  │
  └─ 否：继续检索流程
         ↓
       Query Parser / 规则解析
         ↓
       Code: 标准化技能、公司标签、limit
         ↓
       Code: 生成 semantic_query
         ↓
       Embedding: 生成 query embedding
         ↓
       Postgres: 混合检索 candidate_resume_chunks + candidate_search_index
         ↓
       Code: 聚合候选人、保留 Top chunks、生成 reason
         ↓
       LLM: 生成 HR 可读回答
         ↓
       Respond
```

`semantic_query` 可以直接使用用户原始问题，也可以由 LLM 或规则改写。

示例：

用户原始问题：

```text
找有 Spring Boot 经验，并且做过高并发订单系统的人，最好有国内大厂经历
```

用于结构化过滤：

```json
{
  "must_skills": ["Spring Boot"],
  "should_company_tags": ["国内大厂", "互联网大厂"]
}
```

用于向量检索的 `semantic_query`：

```text
高并发订单系统 订单履约 分布式系统 稳定性治理 接口超时 消息堆积 性能优化
```

---

### 9.6 候选人画像结构化

向量检索解决“语义召回”，但对于 HR 常用筛选维度，仍建议进一步结构化。

可从 `experience_if.summary` 中抽取：

- 行业领域：电商、金融、制造、工业互联网、AI、新能源汽车
- 系统类型：订单系统、支付系统、风控系统、数据中台、MES、ERP、CRM、RAG 问答系统
- 技术角色：后端、前端、全栈、DevOps、测试、算法、数据工程
- 架构经验：微服务、分布式、高可用、高并发、云原生
- 职责层级：开发、核心开发、主导、架构设计、技术管理
- 管理经验：团队管理、项目管理、跨团队协作

可以新增画像字段到 `candidate_search_index`：

```sql
ALTER TABLE candidate_search_index
ADD COLUMN IF NOT EXISTS domain_tags TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS system_tags TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS role_tags TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS architecture_tags TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS seniority_tags TEXT[] NOT NULL DEFAULT '{}';
```

实施建议：

1. 第一版先用规则抽取，例如看到“订单”就加 `订单系统`。
2. 第二版再用 LLM 对每段经历抽取标签。
3. LLM 抽取结果必须限制在预定义标签集合内。
4. 抽取后仍要人工抽样检查，避免标签漂移。

---

### 9.7 中文全文检索和关键词检索

PostgreSQL 默认中文全文检索能力有限。MVP 阶段可以先用：

```sql
content ILIKE '%' || $1 || '%'
```

作为关键词兜底。

后续如果数据量变大，可以考虑：

- `pg_jieba`
- Elasticsearch / OpenSearch
- Meilisearch
- Typesense

推荐顺序：

1. 先做 pgvector，因为它直接解决语义召回。
2. 再根据性能和中文关键词需求，决定是否引入专用搜索引擎。
3. 不建议在 MVP 早期同时引入向量库、搜索引擎和复杂标签抽取，复杂度会过高。

---

### 9.8 查询日志和可观测性

向量检索上线后，更需要记录每次检索过程，方便调权重和排查问题。

建议新增查询日志表：

```sql
CREATE TABLE IF NOT EXISTS search_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(100),
  user_question TEXT NOT NULL,
  parsed_query JSONB,
  semantic_query TEXT,
  sql_params JSONB,
  result_count INT,
  top_user_ids TEXT[],
  clicked_user_id VARCHAR(64),
  feedback VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

建议记录：

- 用户原始问题
- 规则或 LLM 解析出的 JSON
- `semantic_query`
- SQL 参数
- Top 候选人 ID
- 用户是否查看详情
- 用户是否反馈“相关/不相关”

这些日志后续可以用于：

- 调整字典。
- 调整打分权重。
- 分析哪些 query 没有结果。
- 找出向量召回不准的场景。
- 构建小型评测集。

---

### 9.9 向量检索验收用例

建议新增以下验收用例。

#### 用例 A：高并发订单系统

用户：

```text
找有高并发订单系统稳定性治理经验的人
```

期望：

- 能召回订单系统、订单履约、交易系统相关经历。
- 能优先返回提到接口超时、慢查询、消息堆积、性能优化、稳定性建设的候选人。
- 回答中展示 matched chunk 作为依据。

---

#### 用例 B：工业互联网 / MES

用户：

```text
找做过工业互联网平台或 MES 制造执行系统的人
```

期望：

- 能召回 `工业物联网平台`、`MES制造执行系统`、制造业数字化相关经历。
- 如果候选人公司标签包含 `制造业`，排序加分。

---

#### 用例 C：复杂分布式系统治理

用户：

```text
找有复杂分布式系统治理经验的后端工程师
```

期望：

- 结构化条件可命中 `Java`、`Go`、`微服务`、`Spring Cloud`、`Kubernetes` 等。
- 向量检索召回稳定性、服务拆分、消息队列、限流降级、性能优化相关经历。

---

#### 用例 D：混合条件

用户：

```text
找有 Spring Boot 经验，做过支付或订单系统，最好有国内大厂背景的人
```

期望：

- `Spring Boot` 作为 must 技能。
- `支付系统`、`订单系统` 进入 `semantic_query`。
- `国内大厂` 作为 should 公司标签。
- 最终排序综合考虑技能、语义相似度和公司标签。

---

### 9.10 后续优化推荐路线

推荐路线如下：

1. **先完成当前 MVP**
   - 字典表。
   - 归一化索引。
   - n8n Webhook。
   - 组合查询。
   - LLM 回答生成。

2. **再做 chunk 表**
   - 先不生成 embedding。
   - 先验证 chunk 拆分是否合理。

3. **再生成 embedding**
   - 小批量生成。
   - 手工 SQL 验证向量相似度。

4. **再接入 n8n 向量检索 Webhook**
   - 先只返回 matched chunks。
   - 不急着和结构化索引合并。

5. **再做混合检索**
   - 结构化条件过滤。
   - 向量相似度召回。
   - 标签和技能加分。

6. **最后做画像和可观测性**
   - 抽取领域、系统、架构标签。
   - 记录查询日志。
   - 根据实际查询反馈调优。

---

## 10. MVP 推荐优先级

推荐采用“每一步都可测试”的优先级，而不是一次性完成所有模块。

### 第一优先级：打通链路

1. 生成测试数据。
2. n8n Webhook 查询原始表前 5 条。
3. 确认 n8n 到 PostgreSQL 的连接正常。

验收重点：链路通，不追求智能。

---

### 第二优先级：技能归一化索引

1. 创建最小 `skill_dictionary`。
2. 只维护 `Java`、`Spring Boot`、`微服务`。
3. 构建 `candidate_search_index`。
4. 手工 SQL 验证 `matched_skills`。
5. n8n Webhook 查询 `Spring Boot` 候选人。

验收重点：`Springboot` 能查到 `Spring Boot` 候选人。

---

### 第三优先级：技能扩展和排序

1. 从 `skill_dictionary.related_terms` 扩展 `should_skills`。
2. 查询时根据命中相关技能加分。
3. n8n Webhook 验证排序变化。

验收重点：有 `Java`、`微服务` 等相关经验的候选人排得更靠前。

---

### 第四优先级：公司标签

1. 创建最小 `company_dictionary`。
2. 先只维护 `国内大厂`。
3. 重建索引。
4. n8n Webhook 验证“国内大厂”查询。
5. 再扩展 `世界500强`。

验收重点：用户不输入公司名，也能通过公司标签召回候选人。

---

### 第五优先级：组合查询

1. 支持 `must_skills` + `must_company_tags`。
2. 支持 `should_skills` + `should_company_tags` 加分。
3. 返回 `score` 和命中原因。

验收重点：能回答“有 Springboot 经验，并且有国内大厂经历”。

---

### 第六优先级：LLM 回答生成

1. 只把 Top N 压缩结果传给 LLM。
2. LLM 只负责生成 HR 可读回答。
3. 不让 LLM 直接访问完整简历列表。

验收重点：回答自然，但不编造，不溢出上下文。

---

### 第七优先级：详情查询

1. 识别 `user_id`。
2. 单独查询一个候选人的原始简历。
3. LLM 总结单人详情。

验收重点：列表查询和详情查询分离。

---

### 第八优先级：LLM Query Parser

1. 在规则版稳定后再引入。
2. LLM 只输出 JSON，不生成 SQL。
3. Code 节点负责校验、归一化和兜底。

验收重点：复杂自然语言理解增强，但 SQL 查询仍稳定可控。

---

## 11. 精度优化路线：按优先级逐步增强

在完成基础 MVP、归一化索引、公司标签、向量检索和混合检索之后，如果要继续提高检索精度，建议进入“精度优化阶段”。
具体要求请查看 [Improve.md](Improve.md)

## 12. 关键结论

对于该 HR 简历检索助手，MVP 阶段不建议继续走纯 text-to-SQL。

更合适的方案是：

```text
LLM 负责理解用户意图
字典负责语义扩展
索引表负责结构化召回
SQL 模板负责稳定查询
LLM 负责最终自然语言总结
```

这样可以同时解决：

- 上下文溢出
- 技能同义词问题
- 相关技能扩展问题
- 国内大厂、世界 500 强等业务标签问题
- 查询稳定性问题
- MVP 可快速落地问题