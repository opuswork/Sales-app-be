/** 기준 상수 — Notion 「영업 방향·조직도·운영안(2026)」 기준 */
export const CHANNELS = [
  '급식·기업',
  '유통·외식',
  '특수채널·제휴',
  '상회·상권',
  '박람회·행사',
  '온라인',
] as const;

export const PRODUCTS = ['간장', '런(발효유)', '양재', '메리야스', '두부'] as const;

export const RANKS: Record<string, number> = {
  부장: 5,
  차장: 4,
  과장: 3,
  대리: 2,
  주임: 1,
  사원: 0.5,
};

export const PARTS = ['총괄', '필드영업', '마케팅', '영업지원'] as const;

export const GRADES: Record<
  string,
  { amount: number; target: number; visit: number; label: string }
> = {
  S: { amount: 500, target: 8, visit: 14, label: 'S급 Key Account' },
  A: { amount: 200, target: 12, visit: 30, label: 'A급' },
  B: { amount: 80, target: 25, visit: 45, label: 'B급' },
};

export const STAGES = [
  '접촉',
  '상담',
  '제안서 발송',
  '견적·단가 협의',
  '계약',
  '정기납품',
] as const;

export const VISIT_TYPES = ['방문', '전화', '미팅', '마케팅·행사', '관장님문의'] as const;
export const TRANSPORTS = ['자차', '대중교통', '동행', '비대면'] as const;

export const SIDOS = [
  '부산',
  '울산',
  '경남',
  '대구·경북',
  '서울',
  '경기',
  '인천',
  '충북·대전',
  '충남',
  '전북',
  '광주·전남',
  '강원',
  '제주',
  '전국·온라인',
] as const;

export const REGION_GROUP: Record<string, string> = {
  부산: '영남',
  울산: '영남',
  경남: '영남',
  '대구·경북': '영남',
  서울: '수도권',
  경기: '수도권',
  인천: '수도권',
  '충북·대전': '충청',
  충남: '충청',
  전북: '호남',
  '광주·전남': '호남',
  강원: '강원',
  제주: '제주',
  '전국·온라인': '전국',
};

export const EVAL_WEIGHTS = { contracts: 40, amount: 30, activity: 20, data: 10 };

export const DEFAULT_SETTINGS = {
  weights: { skill: 35, exp: 20, rank: 15, dist: 15, prod: 5, load: 10 },
  visitsPerDay: 4,
  workDays: 5,
};

/** 담당별 12개월 목표 배분안 (Notion) */
export const TARGETS: Record<
  string,
  { S: number; A: number; B: number; amount: number }
> = {
  김혜경: { S: 4, A: 2, B: 0, amount: 2400 },
  황은영: { S: 3, A: 5, B: 5, amount: 2900 },
  정미옥: { S: 1, A: 3, B: 12, amount: 2060 },
  박혜영: { S: 0, A: 2, B: 8, amount: 1040 },
};

export type Weights = typeof DEFAULT_SETTINGS.weights;
export type AppSettings = typeof DEFAULT_SETTINGS;
