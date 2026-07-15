# CONTINUE.md - HR 简历检索助手项目全局上下文

## 1. 项目定位

本项目位于：

```text
C:\Appl\cv_agent
```

项目目标是搭建一个基于 PostgreSQL、n8n 和 LLM 的 HR 简历检索助手。

当前不是生产级系统，目标是先完成可演示、可验证、可逐步优化的 MVP，然后逐步增强到：

```text
结构化检索
+ 字典归一化
+ 公司/技能/业务标签
+ 向量检索
+ 混合排序
+ Evidence-Based Answer
+ 评测和反馈闭环
```

项目核心原则：

1. 不继续走纯 text-to-SQL。
2. LLM 不直接生成 SQL。
3. LLM 主要负责：
   - 理解用户自然语言意图。
   - 输出结构化 JSON。
   - 基于已检索出的压缩候选人信息生成自然语言回答。
4. SQL 查询必须由系统固定模板和参数化查询完成。
5. 检索阶段必须控制上下文，不允许把大量完整简历直接传给 LLM。
6. 列表检索和详情查询必须分离。
7. 每一步都要能通过手工 SQL 和 n8n Webhook 测试。

---

## 2. 当前已有文件

项目当前关键文件包括：

```text
generate_resume_data.js
build_search_index.js
package.json
package-lock.json
doc/PLAN.md
.continue/rule/CONTINUE.md
```

### 2.1 generate_resume_data.js

用途：

- 创建测试数据库。
- 创建原始简历表 `candidate_resumes`。
- 生成 500 条模拟简历数据。

原始表核心字段：

```text
id
user_id
name
birthdate
gender
aim_salary
personal
applied_at
experience_if
created_at
```

其中：

```text
experience_if
```

是一个 JSON 数组字符串，每个元素类似：

```json
{
  "startDate": "2020-03-01",
  "endDate": "至今",
  "company": "阿里巴巴",
  "title": "高级Java开发工程师",
  "summary": "负责订单履约系统的需求分析、系统设计和功能开发..."
}
```

注意：`experience_if` 字段名目前就是这个名字，不要擅自改成 `experience_info`，除非同步修改所有脚本和 SQL。

### 2.2 build_search_index.js

用途：

- 创建候选人检索索引表 `candidate_search_index`。
- 从 `candidate_resumes` 读取原始简历。
- 解析 `experience_if`。
- 构造 `full_text`。
- 根据 `skill_dictionary` 生成 `matched_skills`。
- 根据 `company_dictionary` 生成：
  - `matched_companies`
  - `company_tags`
- 记录：
  - `latest_company`
  - `latest_title`
  - `experience_count`

当前 `candidate_search_index` 设计：

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

## 一句话总结

本项目要实现的是一个可解释、可控、可逐步优化的 HR 简历检索助手。正确路线是：

```text
先用字典和索引解决结构化召回，
再用 n8n 打通端到端测试，
再加入 LLM 做回答生成，
再用向量检索增强 free text 语义召回，
最后通过 evidence、评测集、反馈和 reranker 持续提高精度。
```
