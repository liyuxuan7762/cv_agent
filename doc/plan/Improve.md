## 精度优化路线：按优先级逐步增强

在完成基础 MVP、归一化索引、公司标签、向量检索和混合检索之后，如果要继续提高检索精度，建议进入“精度优化阶段”。

这一阶段的目标不是单纯增加更多技术组件，而是建立一个完整的质量闭环：

```text
更准确理解用户问题
  ↓
更稳定扩展查询条件
  ↓
更高质量召回候选人
  ↓
更可解释地排序
  ↓
更可靠地生成回答
  ↓
通过日志、评测和反馈持续优化
```

推荐按以下优先级实施。

---

### Priority 1：增加业务领域和系统类型词典

#### 目标

当前 `skill_dictionary` 解决的是“候选人会什么技术”，`company_dictionary` 解决的是“候选人在哪里做过”。

但 HR 经常真正关心的是：

```text
候选人做过什么业务系统？
```

例如：

- 订单系统
- 支付系统
- 风控系统
- 数据中台
- MES 制造执行系统
- 工业互联网平台
- RAG 问答系统

如果不把这些业务领域结构化，只靠向量检索，结果会有一定随机性；只靠关键词，又容易漏召回。

---

#### 新增领域词典表

建议新增：

```sql
CREATE TABLE IF NOT EXISTS domain_dictionary (
  id BIGSERIAL PRIMARY KEY,
  tag_name VARCHAR(100) NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  parent_tag VARCHAR(100),
  category VARCHAR(100),
  weight INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

示例数据：

```sql
INSERT INTO domain_dictionary
(tag_name, aliases, parent_tag, category, weight)
VALUES
('订单系统', ARRAY['订单履约', '交易系统', '电商交易', '下单链路', '订单状态流转'], '电商', 'system', 5),
('支付系统', ARRAY['支付清结算', '账务', '对账', '支付网关', '清结算平台'], '金融', 'system', 5),
('风控系统', ARRAY['金融风控', '信贷审批', '反欺诈', '风控模型'], '金融', 'system', 5),
('数据中台', ARRAY['实时数仓', '离线数仓', '数据仓库', 'BI报表平台'], '数据', 'system', 4),
('工业互联网', ARRAY['工业物联网', 'IIoT', '设备数据采集', '工厂数字化'], '制造业', 'domain', 5),
('MES', ARRAY['MES制造执行系统', '制造执行系统', '生产执行系统'], '制造业', 'system', 5),
('RAG问答系统', ARRAY['知识库检索', '智能问答', '企业知识库', '检索增强生成'], 'AI', 'system', 4)
ON CONFLICT (tag_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  parent_tag = EXCLUDED.parent_tag,
  category = EXCLUDED.category,
  weight = EXCLUDED.weight,
  updated_at = NOW();
```

---

#### 扩展候选人索引字段

建议给 `candidate_search_index` 增加：

```sql
ALTER TABLE candidate_search_index
ADD COLUMN IF NOT EXISTS domain_tags TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS system_tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_candidate_search_index_domain_tags
ON candidate_search_index USING GIN(domain_tags);

CREATE INDEX IF NOT EXISTS idx_candidate_search_index_system_tags
ON candidate_search_index USING GIN(system_tags);
```

---

#### 实施方式

第一版可以在 `build_search_index.js` 中基于规则抽取：

```text
如果 full_text 包含“订单履约 / 交易系统 / 下单链路”，则添加 system_tags = ['订单系统']
如果 full_text 包含“支付清结算 / 支付网关 / 对账”，则添加 system_tags = ['支付系统']
如果 full_text 包含“工业物联网 / MES / 制造执行系统”，则添加 domain_tags = ['工业互联网'] 或 system_tags = ['MES']
```

后续再考虑用 LLM 从每段经历中抽取标签，但必须限制在 `domain_dictionary` 的候选标签范围内。

---

#### n8n 测试用例

```json
{
  "question": "找做过订单系统的后端候选人"
}
```

```json
{
  "question": "找做过工业互联网平台或 MES 系统的人"
}
```

验收标准：

- 不依赖用户输入精确项目名称。
- 能通过 `system_tags` 或 `domain_tags` 召回候选人。
- 命中标签可以作为最终回答中的证据。

---

### Priority 2：增加 Evidence-Based Answer，所有推荐必须有证据

#### 目标

提高最终回答的可信度，减少 LLM 过度解释或编造。

最终给 LLM 的不应该只是候选人摘要，而应该包含结构化证据。

---

#### 推荐证据结构

```json
{
  "candidate": {
    "user_id": "U000123",
    "name": "张伟"
  },
  "evidence": [
    {
      "type": "skill",
      "value": "Spring Boot",
      "source": "matched_skills"
    },
    {
      "type": "company_tag",
      "value": "国内大厂",
      "source": "company_tags"
    },
    {
      "type": "system_tag",
      "value": "订单系统",
      "source": "system_tags"
    },
    {
      "type": "semantic_chunk",
      "value": "参与订单履约系统重构，针对慢查询、接口超时、消息堆积和服务稳定性问题进行持续改进。",
      "similarity": 0.82
    }
  ]
}
```

---

#### LLM Prompt 约束

```text
你是 HR 简历检索助手。请只根据提供的候选人 evidence 回答。

规则：
1. 每个推荐理由必须能在 evidence 中找到依据。
2. 不要使用 evidence 之外的信息。
3. 如果 evidence 不足，只能说“可能相关”或“弱相关”。
4. 不要把相似度分数解释为绝对能力水平。
5. 不要编造候选人的项目细节、管理经验或业务成果。
```

---

#### 验收标准

- 每条推荐理由都能追溯到 `matched_skills`、`company_tags`、`system_tags` 或 `matched_chunks`。
- LLM 不再凭空补充项目成果。
- 对证据较弱的候选人，回答中明确标注“弱相关”。

---

### Priority 3：Candidate-Level 聚合打分

#### 目标

向量检索返回的是 chunk，但 HR 需要的是候选人排序。

如果只取单个最高相似 chunk，可能出现偶然高分。更稳妥的方式是按候选人聚合多个 chunk 的表现。

---

#### 推荐聚合公式

```text
candidate_vector_score =
  max_similarity * 0.6
  + avg_top3_similarity * 0.3
  + log(1 + matched_chunk_count) * 0.1
```

含义：

- `max_similarity`：候选人最相关的一段经历。
- `avg_top3_similarity`：候选人前 3 个相关片段的平均相关度。
- `matched_chunk_count`：相关片段数量，避免只有一个偶然命中的片段排太高。

---

#### SQL 思路

```sql
WITH ranked_chunks AS (
  SELECT
    c.user_id,
    c.id AS chunk_id,
    1 - (c.embedding <=> $1::vector) AS similarity,
    ROW_NUMBER() OVER (
      PARTITION BY c.user_id
      ORDER BY c.embedding <=> $1::vector
    ) AS rn
  FROM candidate_resume_chunks c
  WHERE c.embedding IS NOT NULL
),
agg AS (
  SELECT
    user_id,
    MAX(similarity) AS max_similarity,
    AVG(similarity) FILTER (WHERE rn <= 3) AS avg_top3_similarity,
    COUNT(*) FILTER (WHERE similarity >= 0.55) AS matched_chunk_count
  FROM ranked_chunks
  WHERE rn <= 10
  GROUP BY user_id
)
SELECT
  user_id,
  max_similarity,
  avg_top3_similarity,
  matched_chunk_count,
  (
    max_similarity * 0.6
    + avg_top3_similarity * 0.3
    + LN(1 + matched_chunk_count) * 0.1
  ) AS candidate_vector_score
FROM agg
ORDER BY candidate_vector_score DESC
LIMIT 50;
```

---

#### 验收标准

- 有多个相关经历片段的候选人排序更稳定。
- 单个 chunk 偶然高分不会直接决定最终排名。
- 返回结果中保留 Top 2 到 3 个 evidence chunks。

---

### Priority 4：增加时间衰减，最近经历更重要

#### 目标

候选人 8 年前做过某技术，和最近一家公司正在做该技术，价值不同。

需要让最近经历获得更高权重。

---

#### 扩展 chunk 表

```sql
ALTER TABLE candidate_resume_chunks
ADD COLUMN IF NOT EXISTS experience_recency_weight NUMERIC(5, 2) DEFAULT 1.0;
```

---

#### 推荐规则

```text
至今 / 最近 2 年：1.0
2 到 5 年：0.8
5 年以上：0.5
无法判断时间：0.7
```

chunk 最终相似度：

```text
weighted_chunk_score = similarity * experience_recency_weight
```

---

#### 实施方式

在 `build_resume_chunks.js` 中根据 `endDate` 计算：

- `endDate = 至今`：`1.0`
- `endDate` 距当前日期小于 2 年：`1.0`
- `endDate` 距当前日期 2 到 5 年：`0.8`
- `endDate` 距当前日期超过 5 年：`0.5`
- 无法解析：`0.7`

---

#### 验收标准

- 最近经历命中 query 的候选人排序更靠前。
- 很久以前的经历仍可召回，但排序降低。
- 最终回答可以说明“相关经历发生在最近一段工作中”。

---

### Priority 5：增加 Query Rewrite，提高召回率

#### 目标

用户问题经常很短，例如：

```text
找订单系统的人
```

直接向量化这个 query，语义信息可能不足。可以将其改写为更适合检索的 query。

---

#### 改写示例

用户问题：

```text
找订单系统的人
```

改写为：

```text
订单系统 订单履约 交易系统 下单链路 订单状态流转 库存扣减 支付回调 物流履约
```

用户问题：

```text
找工业互联网背景
```

改写为：

```text
工业互联网 工业物联网 MES 制造执行系统 设备数据采集 产线数据 工厂数字化
```

---

#### 推荐实现顺序

1. 第一版：基于 `domain_dictionary`、`skill_dictionary`、`company_dictionary` 做规则扩展。
2. 第二版：使用 LLM 生成扩展 query，但要求输出词必须来自已有词典或用户原文。
3. 第三版：根据历史点击和反馈优化扩展词。

---

#### n8n 节点建议

```text
Webhook
  ↓
Query Parser / Code
  ↓
Dictionary Expansion
  ↓
Code: Build semantic_query
  ↓
Embedding: 对 semantic_query 生成向量
```

---

#### 验收标准

- 短 query 的召回率明显提升。
- 改写后的 `semantic_query` 会记录到 `search_logs`。
- 如果改写结果过宽，能通过日志和评测回调调整。

---

### Priority 6：增加动态阈值，避免低质量结果硬返回

#### 目标

如果没有高度相关候选人，系统不应该硬凑 10 个结果。

---

#### 推荐分层

```text
高匹配：final_score >= 80
中匹配：60 <= final_score < 80
弱匹配：40 <= final_score < 60
不展示：final_score < 40
```

对于纯向量查询，可增加：

```text
如果 best_similarity < 0.55 且没有任何 must 条件命中：
  返回“未找到高置信度候选人”
```

---

#### 回答策略

如果只有弱匹配：

```text
没有找到高匹配候选人，以下是弱相关候选人，建议放宽或调整条件。
```

如果完全无结果：

```text
没有找到符合条件的候选人。可能原因是技能条件过窄、公司标签限制过强，或简历中没有明确描述相关经历。
```

---

#### 验收标准

- 系统不会为了凑数量返回明显不相关候选人。
- 弱匹配会被明确标注。
- 用户对结果可信度更高。

---

### Priority 7：增加 Reranker 二阶段重排序

#### 目标

Embedding 适合召回，但最终排序不一定最准确。Reranker 可以显著提升 Top 10 排序质量。

---

#### 推荐流程

```text
第一阶段：SQL + 向量召回 Top 50 候选人
  ↓
第二阶段：Reranker 对 query 和候选人 evidence chunk 做精排
  ↓
第三阶段：综合结构化分数，返回 Top 10
```

---

#### Reranker 输入示例

```json
{
  "query": "找有高并发订单系统稳定性治理经验的人",
  "candidate_chunk": "参与订单履约系统重构，针对慢查询、接口超时、消息堆积和服务稳定性问题进行持续改进。"
}
```

输出：

```json
{
  "relevance_score": 0.91
}
```

最终分数：

```text
final_score =
  rerank_score * 100
  + skill_score
  + company_score
  + recency_score
```

---

#### n8n 实施建议

第一版可以在 Code 节点中只对 Top 30 chunk 调用 reranker，避免成本过高。

```text
Postgres: 混合召回 Top 50
  ↓
Code: 提取每个候选人的 Top 1-3 chunks
  ↓
HTTP Request / Model Node: Reranker
  ↓
Code: 合并 rerank_score
  ↓
排序后返回 Top 10
```

---

#### 验收标准

- Top 10 排序比单纯向量相似度更符合人工判断。
- 对“语义接近但实际不相关”的 chunk 能降低排名。
- Reranker 输入和输出写入日志，便于分析。

---

### Priority 8：增加离线评测集

#### 目标

没有评测集，就很难判断每次优化到底变好还是变差。

建议维护一个小型评测集，即使一开始只有 20 条 query 也有价值。

---

#### 评测集格式

建议新增文件：

```text
doc/evaluation_set.json
```

示例：

```json
[
  {
    "query": "找有 Spring Boot 和微服务经验的 Java 后端",
    "expected_positive_user_ids": ["U000001", "U000023"],
    "expected_negative_user_ids": ["U000120"],
    "notes": "必须命中 Spring Boot，微服务加分"
  },
  {
    "query": "找做过工业互联网平台或 MES 系统的人",
    "expected_positive_user_ids": ["U000045"],
    "expected_negative_user_ids": [],
    "notes": "应命中工业互联网、MES、制造执行系统相关经历"
  }
]
```

---

#### 推荐指标

```text
Recall@10：应该出现的人有没有进入前 10
Precision@10：前 10 里面有多少是真的相关
MRR：第一个高度相关候选人排第几
NDCG@10：排序质量
Zero-result rate：无结果比例
```

---

#### 推荐脚本

可以新增：

```text
run_search_evaluation.js
```

职责：

1. 读取 `doc/evaluation_set.json`。
2. 对每条 query 调用检索接口或本地检索函数。
3. 记录 Top 10 `user_id`。
4. 计算 Recall@10、Precision@10、MRR。
5. 输出报告。

---

#### 验收标准

- 每次调整字典、权重、embedding 模型或 reranker 后都能运行评测。
- 能发现“召回提升但排序下降”的情况。
- 能持续积累真实 HR query 作为评测样本。

---

### Priority 9：增加用户反馈闭环

#### 目标

让系统越用越准。

HR 在结果上可以标记：

- 相关
- 不相关
- 已查看
- 已联系
- 进入面试

---

#### 新增反馈表

```sql
CREATE TABLE IF NOT EXISTS search_feedback (
  id BIGSERIAL PRIMARY KEY,
  search_log_id BIGINT,
  user_id VARCHAR(64) NOT NULL,
  feedback VARCHAR(50) NOT NULL,
  comment TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

建议 `feedback` 使用固定枚举值：

```text
relevant
irrelevant
viewed
contacted
interview
```

---

#### n8n 反馈 Webhook

新增一个反馈接口：

```text
POST /resume-search-feedback
```

输入：

```json
{
  "search_log_id": 123,
  "user_id": "U000123",
  "feedback": "relevant",
  "comment": "这个候选人的订单系统经验比较匹配"
}
```

---

#### 后续用途

反馈数据可以用于：

- 调整字典别名。
- 调整标签。
- 调整打分权重。
- 优化 query rewrite。
- 构建 reranker 训练数据。
- 发现哪些查询经常没有满意结果。

---

#### 验收标准

- 每条搜索结果都能关联到 `search_log_id`。
- 用户反馈能写入数据库。
- 后续可以按 query 分析正负反馈。

---

### Priority 10：增加岗位画像 Job Profile

#### 目标

如果 HR 经常围绕固定岗位招聘，不建议每次都从自然语言临时解析条件。

岗位画像可以显著提高固定岗位检索的一致性。

---

#### 新增岗位画像表

```sql
CREATE TABLE IF NOT EXISTS job_profiles (
  id BIGSERIAL PRIMARY KEY,
  job_name VARCHAR(200) NOT NULL,
  must_skills TEXT[] NOT NULL DEFAULT '{}',
  should_skills TEXT[] NOT NULL DEFAULT '{}',
  must_company_tags TEXT[] NOT NULL DEFAULT '{}',
  should_company_tags TEXT[] NOT NULL DEFAULT '{}',
  domain_tags TEXT[] NOT NULL DEFAULT '{}',
  system_tags TEXT[] NOT NULL DEFAULT '{}',
  architecture_tags TEXT[] NOT NULL DEFAULT '{}',
  semantic_query TEXT,
  weight_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

示例画像：

```json
{
  "job_name": "高级 Java 后端工程师",
  "must_skills": ["Java", "Spring Boot"],
  "should_skills": ["Spring Cloud", "Redis", "Kafka", "微服务"],
  "should_company_tags": ["国内大厂", "互联网大厂"],
  "system_tags": ["订单系统", "支付系统", "交易系统"],
  "architecture_tags": ["高并发", "高可用", "分布式"],
  "semantic_query": "Java后端 微服务 高并发 订单系统 支付系统 分布式系统 稳定性治理"
}
```

---

#### 使用方式

用户可以问：

```text
按高级 Java 后端岗位找候选人
```

系统先加载岗位画像，再叠加用户的补充条件：

```text
按高级 Java 后端岗位找候选人，优先世界500强背景
```

---

#### 验收标准

- 同一个岗位多次检索结果稳定。
- HR 可以复用岗位条件。
- 用户临时补充条件可以和岗位画像合并。

---

### Priority 11：增强 Query Understanding，支持更细粒度解析

#### 目标

用户问题不应只解析为技能和公司标签，还应解析为：

- 系统类型
- 业务领域
- 架构经验
- 资深度
- 年限
- 正向条件
- 优先条件
- 负向条件

---

#### 推荐输出结构

```json
{
  "must": {
    "skills": ["Spring Boot"],
    "domains": [],
    "systems": ["订单系统"],
    "architecture_tags": [],
    "company_tags": [],
    "experience_years_min": null,
    "seniority_level": null
  },
  "should": {
    "skills": ["Java", "微服务", "Redis", "Kafka"],
    "company_tags": ["国内大厂"],
    "architecture_tags": ["高可用", "分布式", "稳定性治理"]
  },
  "negative": {
    "titles": [],
    "skills": [],
    "company_tags": [],
    "keywords": []
  },
  "semantic_query": "高并发订单系统 稳定性治理 接口超时 消息堆积 性能优化 分布式系统",
  "ranking_focus": ["semantic_relevance", "must_skill", "company_background"],
  "limit": 10
}
```

---

#### 验收标准

- “必须”和“优先”不会混淆。
- “岗位经验”和“技能经验”可以区分。
- 解析失败时仍可回退到规则版解析。

---

### Priority 12：增加负向条件识别

#### 目标

支持 HR 常见排除条件。

示例：

```text
不要测试岗位
```

```text
不考虑纯前端
```

```text
不要外包背景太重的
```

```text
不考虑最近经历是运维的
```

---

#### 推荐结构

```json
{
  "negative": {
    "titles": ["测试工程师", "软件测试工程师"],
    "skills": ["测试"],
    "company_tags": ["外包"],
    "keywords": ["外包", "驻场"]
  }
}
```

---

#### 实施建议

第一版不要全部强过滤，建议先扣分：

```text
negative_title_score = -50
negative_keyword_score = -30
```

对于非常明确的条件再强过滤，例如：

```sql
AND NOT (latest_title ILIKE '%测试%')
```

---

#### 验收标准

- “不要测试岗位”时，测试类候选人不进入 Top 结果，或明显降权。
- 负向条件在日志中可见，便于排查误伤。

---

### Priority 13：增加年限、资深度、管理和架构经验判断

#### 目标

支持更贴近 HR 的筛选方式，例如：

```text
找 5 年以上 Java 经验的人
```

```text
找高级后端，不要初级开发
```

```text
找有架构设计经验的人
```

---

#### 扩展索引字段

```sql
ALTER TABLE candidate_search_index
ADD COLUMN IF NOT EXISTS total_experience_years NUMERIC(5, 1),
ADD COLUMN IF NOT EXISTS seniority_level VARCHAR(50),
ADD COLUMN IF NOT EXISTS management_experience BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS architecture_experience BOOLEAN DEFAULT FALSE;
```

---

#### 第一版规则

```text
0-3 年：初级
3-5 年：中级
5-8 年：高级
8 年以上：资深
出现“架构师 / 技术经理 / 研发负责人”：高级或资深
出现“主导 / 架构设计 / 技术方案评审”：architecture_experience = true
出现“团队管理 / 研发负责人 / 技术经理”：management_experience = true
```

---

#### 验收标准

- “高级后端”不会只依赖 title 判断。
- “5 年以上经验”可以通过 `total_experience_years` 过滤。
- 架构经验和管理经验可解释。

---

### Priority 14：精度优化实施顺序总结

建议按照以下顺序追加到现有路线中：

| 优先级 | 优化项 | 主要提升 | 复杂度 |
|---:|---|---|---|
| 1 | 业务领域 / 系统类型词典 | 提升“做过什么系统”的准确度 | 中 |
| 2 | Evidence-Based Answer | 减少 LLM 编造和错误解释 | 低 |
| 3 | Candidate-Level 聚合打分 | 避免单 chunk 偶然高分 | 中 |
| 4 | 时间衰减 | 最近相关经验优先 | 中 |
| 5 | Query Rewrite | 提升短 query 召回率 | 中 |
| 6 | 动态阈值 | 避免低质量硬返回 | 低 |
| 7 | Reranker 二阶段重排序 | 明显提升 Top 10 排序质量 | 中高 |
| 8 | 离线评测集 | 长期稳定优化 | 中 |
| 9 | 用户反馈闭环 | 越用越准 | 中高 |
| 10 | 岗位画像 Job Profile | 固定岗位招聘更稳定 | 中 |
| 11 | 细粒度 Query Understanding | 更准确理解复杂需求 | 中 |
| 12 | 负向条件识别 | 减少明显不合适结果 | 中 |
| 13 | 年限 / 资深度 / 架构经验 | 更贴近 HR 筛选逻辑 | 中 |

推荐不要一次性全部实现。每完成一个优先级，都应至少做三类测试：

1. 手工 SQL 测试。
2. n8n Webhook 端到端测试。
3. 离线评测集回归测试。

---