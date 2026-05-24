#!/usr/bin/env node
/**
 * build_middle_curriculum.mjs
 *
 * CSV → unit_classification_middle.json
 *
 * 입력: studio/inputs/시험지 제작/curriculum_2022.csv
 * 출력: .claude/data/unit_classification_middle.json
 *
 * 변환 규칙:
 *   - 교육과정 = 중등1/2/3 행만 추출 (나머지 고등 라인 skip)
 *   - 대단원코드 기준 그룹화. 코드가 비어있는 경우 대단원명을 키로 사용.
 *   - 같은 대단원코드라도 대단원명이 다르면 별도 unit으로 처리.
 *   - 중단원번호 오름차순으로 topics 정렬 (결정론적)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// ── 경로 설정 ───────────────────────────────────────────────────────────────
const CSV_PATH = resolve(
  REPO_ROOT,
  "studio",
  "inputs",
  "시험지 제작",
  "curriculum_2022.csv"
);
const OUT_PATH = resolve(REPO_ROOT, ".claude", "data", "unit_classification_middle.json");

// ── CSV 파서 (RFC4180 최소 구현 — 따옴표 escape 처리 포함) ──────────────────
function parseCSV(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const fields = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        // quoted field
        let val = "";
        i++; // skip opening quote
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else if (line[i] === '"') {
            i++; // skip closing quote
            break;
          } else {
            val += line[i++];
          }
        }
        fields.push(val);
        if (line[i] === ",") i++; // skip comma after field
      } else {
        // unquoted field
        const end = line.indexOf(",", i);
        if (end === -1) {
          fields.push(line.slice(i));
          break;
        } else {
          fields.push(line.slice(i, end));
          i = end + 1;
        }
      }
    }
    rows.push(fields);
  }
  return rows;
}

// ── 메인 변환 ────────────────────────────────────────────────────────────────
const csvText = readFileSync(CSV_PATH, { encoding: "utf-8" });
const rows = parseCSV(csvText);
const [, ...dataRows] = rows;

// 컬럼 인덱스 (헤더: 교육과정,대단원코드,대단원명,중단원번호,중단원명)
const COL_GRADE = 0;
const COL_UNIT_CODE = 1;
const COL_UNIT_NAME = 2;
const COL_TOPIC_NUM = 3;
const COL_TOPIC_NAME = 4;

// 중등 학년 매핑
const MIDDLE_GRADE_MAP = { 중등1: 1, 중등2: 2, 중등3: 3 };

// 학년별 단원 맵: grade → Map<key, {code, name, topics: [{num, name}]}>
const gradeData = {}; // grade (1/2/3) → Map

let middleRowCount = 0;

for (const row of dataRows) {
  if (row.length < 5) continue;

  const gradeKey = row[COL_GRADE].trim();
  if (!(gradeKey in MIDDLE_GRADE_MAP)) continue; // skip 고등

  const grade = MIDDLE_GRADE_MAP[gradeKey];
  const unitCode = row[COL_UNIT_CODE].trim(); // 중등3은 빈 문자열
  const unitName = row[COL_UNIT_NAME].trim();
  const topicNumStr = row[COL_TOPIC_NUM].trim();
  const topicName = row[COL_TOPIC_NAME].trim();

  // 그룹화 키: 코드가 있으면 "code:name", 없으면 "name:name" (중등3)
  // 같은 코드라도 name이 다르면 별도 unit (중등2 M 케이스)
  const unitKey = unitCode ? `${unitCode}:${unitName}` : `_name:${unitName}`;

  if (!gradeData[grade]) gradeData[grade] = new Map();

  if (!gradeData[grade].has(unitKey)) {
    gradeData[grade].set(unitKey, {
      code: unitCode || unitName, // 코드 없으면 대단원명 사용
      name: unitName,
      topics: [],
    });
  }

  gradeData[grade].get(unitKey).topics.push({
    num: parseInt(topicNumStr, 10),
    name: topicName,
  });

  middleRowCount++;
}

// topics 내 중단원번호 오름차순 정렬
for (const unitMap of Object.values(gradeData)) {
  for (const unit of unitMap.values()) {
    unit.topics.sort((a, b) => a.num - b.num);
  }
}

// 출력 JSON 조립
const gradeNameMap = { 1: "중학교 1학년", 2: "중학교 2학년", 3: "중학교 3학년" };
const gradeCodeMap = { 1: "중1", 2: "중2", 3: "중3" };

const subjects = Object.keys(gradeData)
  .map(Number)
  .sort((a, b) => a - b) // 학년 오름차순
  .map((grade) => ({
    code: gradeCodeMap[grade],
    name: gradeNameMap[grade],
    grade,
    units: Array.from(gradeData[grade].values()).map((u) => ({
      code: u.code,
      name: u.name,
      topics: u.topics.map((t) => t.name),
    })),
  }));

const output = {
  version: "2022 개정교육과정 (중학교)",
  source:
    "studio/inputs/시험지 제작/curriculum_2022.csv (교육과정=중등1/중등2/중등3)",
  note: "중단원명은 이 표의 topics 값을 그대로 사용해야 한다. 임의로 변형하지 않는다.",
  subjects,
};

// topics 총합 계산
const totalTopics = subjects.reduce(
  (sum, s) => sum + s.units.reduce((n, u) => n + u.topics.length, 0),
  0
);

// 출력 디렉터리 보장
mkdirSync(dirname(OUT_PATH), { recursive: true });

writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n", {
  encoding: "utf-8",
});

// 검증 stderr 출력
process.stderr.write(
  `[build_middle_curriculum] CSV 중등 행 수: ${middleRowCount}, JSON topics 합계: ${totalTopics}\n`
);

if (middleRowCount !== totalTopics) {
  process.stderr.write(
    `[build_middle_curriculum] ⚠ 불일치: CSV 중등 행 ${middleRowCount} ≠ JSON topics ${totalTopics}\n`
  );
  process.exit(1);
} else {
  process.stderr.write(
    `[build_middle_curriculum] ✓ 일치: ${totalTopics} topics\n`
  );
  process.stderr.write(`[build_middle_curriculum] 출력: ${OUT_PATH}\n`);
}
