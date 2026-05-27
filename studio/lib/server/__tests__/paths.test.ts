import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getDataRoot, getJobsDir } from "../paths";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.EXAM_STUDIO_ROOT;
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
  );
});

async function makeTemp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paths-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("getDataRoot", () => {
  it("EXAM_STUDIO_ROOT 가 설정되면 marker 유무와 무관하게 최우선 사용", async () => {
    const root = await makeTemp();
    process.env.EXAM_STUDIO_ROOT = root;
    const sub = path.join(root, "studio");
    await mkdir(sub, { recursive: true });
    expect(getDataRoot(sub)).toBe(path.resolve(root));
  });

  it("assemble.py 를 가진 가장 가까운 상위 디렉터리를 데이터 루트로 찾는다", async () => {
    const root = await makeTemp();
    await writeFile(path.join(root, "assemble.py"), "# marker", "utf-8");
    const deep = path.join(root, "studio", "app", "api", "file");
    await mkdir(deep, { recursive: true });
    expect(getDataRoot(deep)).toBe(path.resolve(root));
  });

  it("marker 가 없으면 cwd 의 부모로 fallback (레거시 동작 보존)", async () => {
    const root = await makeTemp();
    const app = path.join(root, "studio");
    await mkdir(app, { recursive: true });
    expect(getDataRoot(app)).toBe(path.resolve(root));
  });
});

describe("getJobsDir", () => {
  it("next.config.ts 를 가진 앱 루트의 data/jobs 를 반환", async () => {
    const root = await makeTemp();
    const app = path.join(root, "studio");
    await mkdir(app, { recursive: true });
    await writeFile(path.join(app, "next.config.ts"), "export default {};", "utf-8");
    const deep = path.join(app, "app", "api", "jobs");
    await mkdir(deep, { recursive: true });
    expect(getJobsDir(deep)).toBe(path.join(path.resolve(app), "data", "jobs"));
  });

  it("marker 가 없으면 cwd 의 data/jobs 로 fallback", async () => {
    const root = await makeTemp();
    expect(getJobsDir(root)).toBe(path.join(path.resolve(root), "data", "jobs"));
  });
});
