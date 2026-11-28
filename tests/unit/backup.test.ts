import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "liteshop-backup-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function stub(name: string, body: string) {
  writeFileSync(join(dir, name), "#!/bin/sh\n" + body, { mode: 0o700 });
}

function run(script: string, args: string[], env: Record<string, string>) {
  return spawnSync("sh", [`ops/${script}.sh`, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, BACKUP_DIR: dir, ...env },
    timeout: 5000,
  });
}

it("恢复失败保留旧备份、清理临时库并报告失败", () => {
  writeFileSync(join(dir, "liteshop-old.dump"), "previous");
  stub("pg_dump", 'for file do :; done; echo archive > "$file"');
  stub("pg_restore", '[ "$1" = -l ]');
  stub("createdb", 'for db do :; done; echo "$db" > "$BACKUP_DIR/created"');
  stub("dropdb", 'for db do :; done; echo "$db" > "$BACKUP_DIR/dropped"');
  stub("psql", 'cat >/dev/null; echo archive > archive; touch dump-complete; echo "3|4|2" > counts');
  const result = run("backup", ["--once"], { FORCE_DRILL: "1", BACKUP_KEEP: "1" });
  expect(result.status).toBe(1);
  expect(JSON.parse(readFileSync(join(dir, "status.json"), "utf8")).result).toBe("fail");
  expect(readFileSync(join(dir, "dropped"), "utf8")).toBe(readFileSync(join(dir, "created"), "utf8"));
  expect(readdirSync(dir).filter(name => name.includes(".dump"))).toEqual(["liteshop-old.dump"]);
});

it.each(["upload", "empty"])("异地备份 %s 时保留旧文件", mode => {
  stub("rclone", `echo "$1" >> "$BACKUP_DIR/calls"
    case "$1" in
      copy) [ "$MODE" != upload ];;
      lsf) exit 0;;
      *) exit 1;;
    esac`);
  stub("sleep", '[ "$1" = 600 ]'); // 运行一轮守护进程，然后退出。
  const result = run("offsite", [], { MODE: mode, RCLONE_CONFIG_OFFSITE_TYPE: "local" });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("同步失败");
  const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
  expect(calls).toEqual(mode === "upload" ? ["copy"] : ["copy", "lsf"]);
});

it("同一秒的并行备份分别发布，旧备份按份数清理", async () => {
  writeFileSync(join(dir, "liteshop-20200101-000000.dump"), "old");
  stub("date", 'case "$1" in +%u) echo 1;; +%Y%m%d-%H%M%S) echo 20261128-120000;; *) exec /bin/date "$@";; esac');
  stub("pg_dump", 'for file do :; done; echo "$SAMPLE" > "$file"');
  stub("pg_restore", '[ "$1" = -l ]');
  await Promise.all(["first", "second"].map(SAMPLE =>
    promisify(execFile)("sh", ["ops/backup.sh", "--once"], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, BACKUP_DIR: dir, BACKUP_KEEP: "2", FORCE_DRILL: "0", SAMPLE },
    })
  ));
  const backups = readdirSync(dir).filter(name => name.endsWith(".dump"));
  expect(backups.map(name => readFileSync(join(dir, name), "utf8").trim()).sort()).toEqual(["first", "second"]);
  expect(JSON.parse(readFileSync(join(dir, "status.json"), "utf8")).result).toBe("ok");
});
