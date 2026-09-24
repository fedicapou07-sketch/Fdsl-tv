import { describe, expect, it } from "vitest";

import { analyzeCrashText, DEMO_REPORT } from "../lib/crash-analyzer";

describe("CrashScope analyzer", () => {
  it("detects Java method and missing class failures", () => {
    const report = analyzeCrashText(DEMO_REPORT, { packageName: "com.test.player" }, "demo");

    expect(report.crashType).toBe("Java/Kotlin");
    expect(report.packageName).toBe("com.test.player");
    expect(report.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(["method", "class"]));
    expect(report.location).toContain("PlayerActivity.initializePlayer");
  });

  it("detects ANR and native crashes", () => {
    const report = analyzeCrashText("ANR in com.test.app\nFatal signal 11 (SIGSEGV)\n", undefined, "imported");

    expect(report.crashType).toBe("ANR");
    expect(report.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(["anr", "native"]));
  });

  it("returns a useful result for an unknown log", () => {
    const report = analyzeCrashText("Package: com.test\nlast event: user tapped play", undefined, "imported");

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].id).toBe("unknown");
    expect(report.location).toContain("الموقع غير محدد");
  });
});
