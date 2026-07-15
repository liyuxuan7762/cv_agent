const { Pool } = require('pg');

const DB_NAME = process.env.PGDATABASE || 'resume';

const adminPool = new Pool({
  host: process.env.PGHOST || '192.168.123.171',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGADMIN_DATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
});

const pool = new Pool({
  host: process.env.PGHOST || '192.168.123.171',
  port: Number(process.env.PGPORT || 5432),
  database: DB_NAME,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
});

async function ensureDatabaseExists() {
  const result = await adminPool.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [DB_NAME]
  );
  if (result.rowCount === 0) {
    console.log(`Database "${DB_NAME}" does not exist. Creating...`);
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(DB_NAME)};`);
    console.log(`Database "${DB_NAME}" created.`);
  } else {
    console.log(`Database "${DB_NAME}" already exists.`);
  }
  await adminPool.end();
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

const TABLE_NAME = 'candidate_resumes';
const TOTAL_RESUMES = 500;

// ── 姓名数据 ─────────────────────────────────────────────────────
const lastNames = [
  '张', '王', '李', '赵', '陈', '刘', '杨', '黄', '周', '吴',
  '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗',
  '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧'
];

const firstNames = [
  '伟', '强', '磊', '洋', '勇', '军', '杰', '涛', '明', '超',
  '秀英', '丽', '敏', '静', '强华', '建国', '晨', '浩', '宇',
  '佳', '俊', '博', '睿', '鑫', '凯', '鹏', '雪', '娜', '婷',
  '欣怡', '子涵', '梓轩', '雨桐', '思源', '嘉豪', '一凡'
];

const genders = ['男', '女'];

// ── 工作经历数据 ─────────────────────────────────────────────────
const companies = [
  '阿里巴巴', '腾讯', '百度', '字节跳动', '美团', '京东', '网易', '拼多多',
  '华为', '小米', '快手', '滴滴', '蚂蚁集团', '携程', 'B站', '新浪微博',
  '微软中国', 'Amazon', 'Google', 'IBM', 'Oracle', 'SAP', 'Siemens', 'Bosch',
  'ThoughtWorks', 'Accenture', 'Infosys', '中软国际', '软通动力', '东软集团',
  '平安科技', '招商银行信用卡中心', '工商银行软件开发中心', '蚂蚁金服',
  '用友网络', '金蝶软件', '浪潮集团', '海康威视', '大华股份', '科大讯飞',
  '商汤科技', '旷视科技', 'Momenta', '蔚来汽车', '理想汽车', '小鹏汽车',
  '宁德时代', '比亚迪', '携程旅行网', '同程旅行', '贝壳找房', '自如',
  '某互联网创业公司', '某金融科技公司', '某制造业数字化公司', '某跨境电商公司'
];

const titles = [
  'Java开发工程师', '高级Java开发工程师', '后端开发工程师', '高级后端开发工程师',
  '全栈开发工程师', '前端开发工程师', '高级前端开发工程师', 'Node.js开发工程师',
  'Python开发工程师', 'Go开发工程师', '大数据开发工程师', '数据工程师',
  '数据分析师', '算法工程师', '机器学习工程师', 'AI工程师',
  'DevOps工程师', '云计算工程师', '测试开发工程师', '软件测试工程师',
  '架构师', '技术经理', '研发负责人', '产品研发工程师',
  '嵌入式软件工程师', 'Android开发工程师', 'iOS开发工程师',
  '安全工程师', '运维开发工程师'
];

const skillGroups = [
  ['Java', 'Spring Boot', 'Spring Cloud', 'MyBatis', 'Redis', 'Kafka', 'MySQL', '微服务'],
  ['Java', 'Spring MVC', 'Dubbo', 'Zookeeper', 'RocketMQ', 'Oracle', '分布式系统'],
  ['Node.js', 'Express', 'NestJS', 'TypeScript', 'MongoDB', 'Redis', 'REST API'],
  ['Python', 'Django', 'Flask', 'FastAPI', 'PostgreSQL', 'Celery', 'Redis'],
  ['Go', 'Gin', 'gRPC', 'Etcd', 'Kafka', 'Kubernetes', 'Docker'],
  ['React', 'Vue', 'Angular', 'TypeScript', 'Webpack', 'Vite', '前端工程化'],
  ['Hadoop', 'Spark', 'Flink', 'Hive', 'HBase', 'Kafka', '数据仓库'],
  ['Python', 'TensorFlow', 'PyTorch', '机器学习', '深度学习', 'NLP', '推荐系统'],
  ['Docker', 'Kubernetes', 'Jenkins', 'GitLab CI', 'Prometheus', 'Grafana', 'DevOps'],
  ['Linux', 'Shell', 'Ansible', 'Nginx', 'MySQL', 'Redis', '高可用架构'],
  ['C++', 'Linux', '多线程', '网络编程', 'Qt', '嵌入式系统'],
  ['Android', 'Kotlin', 'Java', 'Jetpack', 'Gradle', '移动端开发'],
  ['iOS', 'Swift', 'Objective-C', 'UIKit', 'SwiftUI', '移动端开发'],
  ['网络安全', '渗透测试', '安全加固', '漏洞扫描', 'WAF', '等保合规']
];

const projectDomains = [
  '电商交易系统', '订单履约系统', '支付清结算平台', '用户增长平台',
  '推荐系统', '广告投放平台', '内容审核系统', '物流调度系统',
  '金融风控系统', '信贷审批系统', '数据中台', '实时数仓',
  'BI报表平台', '企业协同办公系统', 'CRM客户管理系统', 'ERP业务系统',
  'MES制造执行系统', '工业物联网平台', '云原生基础设施平台', '自动化测试平台',
  '监控告警平台', '移动端App', '小程序平台', '智能客服系统',
  '知识库检索系统', 'RAG问答系统', 'AI模型训练平台', '图像识别系统',
  '自然语言处理平台'
];

// ── 个人简介数据 ─────────────────────────────────────────────────
const personalTemplates = [
  '具备多年软件开发经验，熟悉计算机基础理论和主流开发框架，能够独立完成需求分析、系统设计、编码实现和上线运维工作。',
  '长期从事互联网系统研发，熟悉高并发、分布式、微服务架构，对系统稳定性、性能优化和工程质量有较强理解。',
  '拥有扎实的后端开发能力，熟悉数据库设计、缓存、消息队列和接口设计，具备良好的问题排查和团队协作能力。',
  '熟悉云原生技术栈，具备容器化部署、CI/CD流水线、监控告警和自动化运维经验，能够支持复杂业务系统稳定运行。',
  '具备较强的数据处理和分析能力，熟悉数据建模、ETL、实时计算和数据治理，能够支持业务数据化决策。',
  '有人工智能和机器学习相关项目经验，熟悉模型训练、特征工程、模型评估和线上推理服务建设。',
  '具备前端工程化和复杂交互系统开发经验，关注用户体验、性能优化和组件化设计。',
  '拥有大型企业信息化项目经验，熟悉业务流程梳理、系统集成、接口对接和项目交付管理。',
  '具备良好的代码规范意识和技术文档编写能力，能够推动团队工程效率提升。',
  '热爱技术，学习能力强，关注新技术在业务场景中的落地，具备较强的责任心和沟通能力。'
];

// ── 教育经历数据 ─────────────────────────────────────────────────
const universities = [
  '北京大学', '清华大学', '复旦大学', '上海交通大学', '浙江大学',
  '南京大学', '武汉大学', '华中科技大学', '西安交通大学', '哈尔滨工业大学',
  '中山大学', '同济大学', '北京航空航天大学', '北京理工大学', '东南大学',
  '厦门大学', '四川大学', '中南大学', '吉林大学', '山东大学',
  '电子科技大学', '北京邮电大学', '华南理工大学', '重庆大学', '天津大学',
  '大连理工大学', '南开大学', '苏州大学', '湖南大学', '西北工业大学',
  '某省重点大学', '某普通本科院校', '某高职技术学院'
];

const majors = [
  '计算机科学与技术', '软件工程', '信息与计算科学', '网络工程',
  '信息安全', '物联网工程', '人工智能', '数据科学与大数据技术',
  '电子信息工程', '通信工程', '自动化', '电气工程及其自动化',
  '数学与应用数学', '统计学', '信息管理与信息系统',
  '工业工程', '机械工程', '电子商务'
];

const degrees = ['专科', '本科', '硕士研究生', '博士研究生'];
const degreeWeights = [10, 55, 30, 5]; // 专科10% 本科55% 硕士30% 博士5%

// ── 工具函数 ─────────────────────────────────────────────────────
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function pickMany(arr, min, max) {
  const count = randomInt(min, max);
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function pad2(num) {
  return String(num).padStart(2, '0');
}

function randomDate(startYear, endYear) {
  const year = randomInt(startYear, endYear);
  const month = randomInt(1, 12);
  const day = randomInt(1, 28);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function addMonths(dateStr, months) {
  const date = new Date(dateStr);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function pickDegree() {
  const total = degreeWeights.reduce((a, b) => a + b, 0);
  let r = randomInt(1, total);
  for (let i = 0; i < degrees.length; i++) {
    r -= degreeWeights[i];
    if (r <= 0) return degrees[i];
  }
  return degrees[1];
}

function degreeDuration(degree) {
  if (degree === '专科') return 3;
  if (degree === '本科') return 4;
  if (degree === '硕士研究生') return 3;
  if (degree === '博士研究生') return 4;
  return 4;
}

// ── 数据生成函数 ─────────────────────────────────────────────────
function generateName() {
  return `${pickOne(lastNames)}${pickOne(firstNames)}`;
}

function generateBirthdate() {
  return randomDate(1978, 2001);
}

function generateAimSalary() {
  const salary = randomInt(12, 65) * 1000;
  return `${salary}元/月`;
}

function generateAppliedAt() {
  return `${randomDate(2024, 2026)} ${pad2(randomInt(0, 23))}:${pad2(randomInt(0, 59))}:${pad2(randomInt(0, 59))}`;
}

function generateSummary(title, company, skills, domain) {
  const skillText = skills.slice(0, randomInt(3, Math.min(6, skills.length))).join('、');
  const summaries = [
    `在${company}参与${domain}建设，担任${title}，主要负责核心模块设计、接口开发、数据库建模和性能优化，技术栈包括${skillText}。`,
    `负责${domain}的需求分析、系统设计和功能开发，使用${skillText}等技术完成服务拆分、接口联调、上线发布和问题排查。`,
    `参与公司核心业务系统研发，围绕${domain}进行架构优化和稳定性建设，熟悉${skillText}，能够处理高并发和复杂业务场景。`,
    `主导或参与${domain}相关项目，负责关键功能开发、代码评审和线上故障处理，使用${skillText}提升系统可维护性和交付效率。`,
    `在项目中承担${title}角色，参与${domain}从设计到上线的完整流程，熟悉${skillText}，具备良好的工程实践和团队协作经验。`,
    `负责业务系统后端服务、数据处理流程和第三方系统对接，项目方向为${domain}，主要技术包括${skillText}。`,
    `参与${domain}的重构和优化工作，针对慢查询、接口超时、消息堆积和服务稳定性问题进行持续改进，使用${skillText}。`,
    `负责相关业务模块的开发和维护，支持产品快速迭代，参与技术方案评审、数据库设计和自动化测试，技术栈包含${skillText}。`
  ];
  return pickOne(summaries);
}

function generateExperienceIf(birthdate) {
  const birthYear = Number(birthdate.slice(0, 4));
  const startWorkYear = randomInt(Math.max(birthYear + 22, 2002), 2022);
  const experienceCount = randomInt(1, 5);

  let currentStart = `${startWorkYear}-${pad2(randomInt(1, 12))}-01`;
  const experiences = [];

  for (let i = 0; i < experienceCount; i++) {
    const company = pickOne(companies);
    const title = pickOne(titles);
    const skills = pickOne(skillGroups);
    const domain = pickOne(projectDomains);

    const durationMonths = randomInt(12, 48);
    let endDate = addMonths(currentStart, durationMonths);
    const endYear = Number(endDate.slice(0, 4));

    if (i === experienceCount - 1 || endYear >= 2026) {
      endDate = Math.random() > 0.35 ? '至今' : randomDate(2024, 2026);
    }

    experiences.push({
      startDate: currentStart,
      endDate,
      company,
      title,
      summary: generateSummary(title, company, skills, domain)
    });

    if (endDate === '至今') break;

    currentStart = addMonths(endDate, randomInt(1, 5));
    if (Number(currentStart.slice(0, 4)) > 2026) break;
  }

  return JSON.stringify(experiences, null, 0);
}

function generateEducationDescription(degree, major, school) {
  const descriptions = [
    `就读于${school}${major}专业，系统学习数据结构、算法、操作系统、计算机网络、数据库等核心课程，毕业设计获良好评价。`,
    `在${school}完成${major}学业，参与多门专业课程学习，具备扎实的计算机基础理论知识，积极参与课外技术实践活动。`,
    `${school}${major}，期间参与实验室项目研究，掌握主流编程语言和开发工具，具备独立完成课程项目的能力。`,
    `完成${school}${major}阶段学习，主修方向涵盖软件开发、系统设计和工程实践，毕业论文方向为分布式系统或数据处理相关领域。`,
    `在${school}攻读${major}，课程涵盖编程基础、算法与数据结构、软件工程、数据库原理等，具备良好的工程思维和自学能力。`
  ];
  return pickOne(descriptions);
}

function generateEducation(birthdate) {
  const birthYear = Number(birthdate.slice(0, 4));
  const hasTwoStages = Math.random() < 0.3;
  const educations = [];

  // 第一段学历（入学年龄约18岁）
  const firstDegree = hasTwoStages ? '本科' : pickDegree();
  const firstEnrollYear = randomInt(birthYear + 17, birthYear + 19);
  const firstDuration = degreeDuration(firstDegree);
  const firstStartDate = `${firstEnrollYear}-09-01`;
  const firstEndDate = `${firstEnrollYear + firstDuration}-06-30`;
  const firstSchool = pickOne(universities);
  const firstMajor = pickOne(majors);

  educations.push({
    startDate: firstStartDate,
    endDate: firstEndDate,
    school: firstSchool,
    major: firstMajor,
    degree: firstDegree,
    description: generateEducationDescription(firstDegree, firstMajor, firstSchool)
  });

  // 第二段学历（30% 概率有研究生学历）
  if (hasTwoStages) {
    const secondDegree = Math.random() < 0.85 ? '硕士研究生' : '博士研究生';
    const secondDuration = degreeDuration(secondDegree);
    const secondEnrollYear = firstEnrollYear + firstDuration;
    const secondStartDate = `${secondEnrollYear}-09-01`;
    const secondEndDate = `${secondEnrollYear + secondDuration}-06-30`;
    const secondSchool = pickOne(universities);
    const secondMajor = pickOne(majors);

    educations.push({
      startDate: secondStartDate,
      endDate: secondEndDate,
      school: secondSchool,
      major: secondMajor,
      degree: secondDegree,
      description: generateEducationDescription(secondDegree, secondMajor, secondSchool)
    });
  }

  return JSON.stringify(educations, null, 0);
}

function generatePersonal() {
  const base = pickOne(personalTemplates);
  const skills = pickOne(skillGroups);
  const domains = pickMany(projectDomains, 1, 3);

  const extra = [
    `熟悉${skills.slice(0, randomInt(3, 6)).join('、')}等技术。`,
    `参与过${domains.join('、')}等项目。`,
    '具备良好的沟通能力、学习能力和问题分析能力。',
    '关注系统稳定性、可扩展性、代码质量和业务价值交付。'
  ].join('');

  return `${base}${extra}`;
}

// ── 数据库操作 ───────────────────────────────────────────────────
async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id BIGSERIAL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(64) NOT NULL,
      birthdate DATE NOT NULL,
      gender VARCHAR(10) NOT NULL,
      aim_salary VARCHAR(32) NOT NULL,
      personal TEXT,
      applied_at TIMESTAMP NOT NULL,
      experience_if TEXT NOT NULL,
      education TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_name ON ${TABLE_NAME}(name);
    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_gender ON ${TABLE_NAME}(gender);
    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_birthdate ON ${TABLE_NAME}(birthdate);
    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_applied_at ON ${TABLE_NAME}(applied_at);
  `;

  await pool.query(sql);
}

async function clearTable() {
  await pool.query(`TRUNCATE TABLE ${TABLE_NAME} RESTART IDENTITY;`);
}

async function insertResume(row) {
  const sql = `
    INSERT INTO ${TABLE_NAME} (
      user_id,
      name,
      birthdate,
      gender,
      aim_salary,
      personal,
      applied_at,
      experience_if,
      education
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
  `;

  const values = [
    row.user_id,
    row.name,
    row.birthdate,
    row.gender,
    row.aim_salary,
    row.personal,
    row.applied_at,
    row.experience_if,
    row.education
  ];

  await pool.query(sql, values);
}

// ── 主流程 ───────────────────────────────────────────────────────
async function main() {
  try {
    await ensureDatabaseExists();

    console.log(`Connecting to PostgreSQL database: ${pool.options.database}`);

    await createTable();
    console.log(`Table ${TABLE_NAME} is ready.`);

    await clearTable();
    console.log(`Old data cleared.`);

    for (let i = 1; i <= TOTAL_RESUMES; i++) {
      const birthdate = generateBirthdate();

      const row = {
        user_id: `U${String(i).padStart(6, '0')}`,
        name: generateName(),
        birthdate,
        gender: pickOne(genders),
        aim_salary: generateAimSalary(),
        personal: generatePersonal(),
        applied_at: generateAppliedAt(),
        experience_if: generateExperienceIf(birthdate),
        education: generateEducation(birthdate)
      };

      await insertResume(row);

      if (i % 50 === 0) {
        console.log(`Inserted ${i}/${TOTAL_RESUMES} resumes.`);
      }
    }

    console.log(`Done. Inserted ${TOTAL_RESUMES} computer-related resumes into table ${TABLE_NAME}.`);
  } catch (error) {
    console.error('Failed to generate resume data:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
